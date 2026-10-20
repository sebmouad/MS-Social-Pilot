/** Read-only migration evidence. No application singleton, writes, or provider calls. */
import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient, Prisma } from '../generated/client';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
import { legacyConfigCandidates } from '../src/server/config/legacy-import';
import { parseResourceScope } from '../src/modules/settings/mcp-access/resource-scope';
import { PAGES } from '../src/lib/product';

// Raw rows remain internal and are never serialized.
type Row = Record<string, any>;
export type Baseline = { version: 1; counts: Record<string, string>; rootKeys: string[] };
export type Check = { table: string; rule: string; failures: string };
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const tableSql = (name: string) => `public.${quote(name)}`;

/** Reject libpq/Prisma routing overrides as well as remote hosts. Never echo URLs. */
export function guardedUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('A guarded PostgreSQL URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/[A-Za-z0-9_]+_(preview|rehearsal)$/.test(url.pathname) ||
      [...url.searchParams.keys()].some(key => !['sslmode', 'connection_limit', 'connect_timeout', 'pool_timeout'].includes(key))) {
    throw new Error('Refusing database: require loopback and a database ending _preview or _rehearsal; routing overrides are forbidden.');
  }
  return url.toString();
}

export function compareCounts(actual: Record<string, string>, baseline: Baseline): Check[] {
  if (baseline.version !== 1 || !baseline.counts || !Array.isArray(baseline.rootKeys) ||
      Object.values(baseline.counts).some(n => typeof n !== 'string' || !/^\d+$/.test(n)) ||
      baseline.rootKeys.some(k => typeof k !== 'string')) throw new Error('Invalid baseline manifest.');
  return [...new Set([...Object.keys(actual), ...Object.keys(baseline.counts)])].sort().map(table => ({
    table, rule: 'source_row_count',
    failures: actual[table] === baseline.counts[table] || (baseline.counts[table] === undefined && actual[table] === '0') ? '0' : '1',
  }));
}

/** Refuse traversal and every symlink component, including links within the root. */
export async function filePresent(root: string, key: string): Promise<boolean> {
  if (!key || key.includes('\\') || key.includes('\0') || path.isAbsolute(key) || key.split('/').some(p => !p || p === '.' || p === '..')) return false;
  try {
    const canonical = await realpath(root);
    let current = canonical;
    for (const part of key.split('/')) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) return false;
    }
    return (await lstat(current)).isFile();
  } catch { return false; }
}

export function invalidMedia(value: unknown): boolean {
  return !Array.isArray(value) || value.some(item => !item || typeof item !== 'object' ||
    !['image', 'video'].includes(item.kind) || typeof item.url !== 'string' || !item.url.trim() ||
    (item.altText !== undefined && typeof item.altText !== 'string'));
}

export function configChecks(rows: Row[], requiredKeys: string[]): Check[] {
  const byKey = new Map(rows.map(row => [row.key, row]));
  const result: Check[] = [];
  const check = (rule: string, failed: boolean) => result.push({ table: 'app_settings', rule, failures: failed ? '1' : '0' });
  for (const key of requiredKeys) check(`imported:${key}`, !byKey.has(key));
  for (const row of rows) {
    const definition = CONFIG_BY_KEY.get(row.key);
    if (!definition) continue; // Legacy-only keys are retained, not Root settings.
    check(`valid:${row.key}`, definition.kind === 'secret'
      ? row.encrypted !== true || typeof row.value !== 'string' || !/^v1:[^:]+:[^:]+:[^:]+$/.test(row.value)
      : row.encrypted !== false || !definition.schema.safeParse(row.value).success);
  }
  // Reuse the importer's mapping, including environment-backed import requirements.
  // Opaque secrets are checked for presence/encrypted envelope, never decrypted or printed.
  try {
    for (const candidate of legacyConfigCandidates(rows as Array<{ key: string; value: unknown; encrypted: boolean }>, {
      appUrl: process.env.APP_URL, authPolicy: process.env.SECURITY_TWO_STEP,
      loginAttempts: process.env.LOGIN_ATTEMPTS, loginWindowMinutes: process.env.LOGIN_WINDOW_MINUTES,
      decrypt: value => value,
    })) {
      const row = byKey.get(candidate.key);
      check(`legacy_import:${candidate.key}`, !row || (!candidate.secret && JSON.stringify(row.value) !== JSON.stringify(candidate.value)));
    }
  } catch { check('legacy_import_shape', true); }
  return result;
}

/** One repeatable-read, server-enforced READ ONLY transaction for all DB reads. */
export async function inspectDatabase(url: string, options: { baseline?: Baseline; mediaRoot?: string; snapshot?: boolean }) {
  const db = new PrismaClient({ datasources: { db: { url: guardedUrl(url) } }, log: [] });
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
      const query = <T = Row>(sql: string) => tx.$queryRawUnsafe<T[]>(sql);
      const catalog = await query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')`);
      const columns = new Map<string, Set<string>>();
      for (const c of catalog) { if (!columns.has(c.table_name)) columns.set(c.table_name, new Set()); columns.get(c.table_name)!.add(c.column_name); }
      const counts: Record<string, string> = {};
      for (const table of [...columns.keys()].sort()) counts[table] = (await query<{ n: string }>(`SELECT count(*)::text AS n FROM ${tableSql(table)}`))[0].n;
      const settings = columns.has('app_settings') ? await query(`SELECT key, value, encrypted FROM public.app_settings`) : [];
      const rootKeys = settings.filter(row => CONFIG_BY_KEY.has(row.key)).map(row => row.key).sort();
      if (options.snapshot) return { version: 1 as const, counts, rootKeys };
      if (!options.baseline || !options.mediaRoot) throw new Error('Verification requires a source baseline and restored media root.');
      const checks = compareCounts(counts, options.baseline);
      const add = (table: string, rule: string, n: string | number) => checks.push({ table, rule, failures: String(n) });
      const count = async (table: string, rule: string, sql: string) => add(table, rule, (await query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`))[0].n);
      // The generated compatibility view defines required columns/enums/relations.
      // Raw SQL avoids Prisma decoding failures hiding invalid enum values.
      for (const model of Prisma.dmmf.datamodel.models) {
        const table = model.dbName ?? model.name;
        if (!columns.has(table)) { add(table, 'required_table', 1); continue; }
        for (const field of model.fields.filter(f => f.kind !== 'object')) {
          const column = field.dbName ?? field.name;
          if (!columns.get(table)!.has(column)) { add(table, `required_column:${column}`, 1); continue; }
          if (field.isRequired) await count(table, `required:${column}`, `${tableSql(table)} WHERE ${quote(column)} IS NULL`);
          if (field.kind === 'enum') {
            const values = Prisma.dmmf.datamodel.enums.find(e => e.name === field.type)!.values.map(v => `'${v.name.replaceAll("'", "''")}'`).join(',');
            await count(table, `enum:${column}`, `${tableSql(table)} WHERE ${quote(column)}::text NOT IN (${values})`);
          }
        }
      }
      // Declared relations are checked even if a restored copy lost its FK constraints.
      for (const model of Prisma.dmmf.datamodel.models) {
        const table = model.dbName ?? model.name;
        for (const field of model.fields.filter(f => f.kind === 'object' && f.relationFromFields?.length)) {
          const parent = Prisma.dmmf.datamodel.models.find(m => m.name === field.type)!;
          const parentTable = parent.dbName ?? parent.name;
          const childKeys = field.relationFromFields!.map(k => model.fields.find(f => f.name === k)!.dbName ?? k);
          const parentKeys = field.relationToFields!.map(k => parent.fields.find(f => f.name === k)!.dbName ?? k);
          if (!childKeys.every(k => columns.get(table)?.has(k)) || !parentKeys.every(k => columns.get(parentTable)?.has(k))) { add(table, `relation_shape:${field.name}`, 1); continue; }
          const join = childKeys.map((k, i) => `c.${quote(k)} = p.${quote(parentKeys[i])}`).join(' AND ');
          const present = childKeys.map(k => `c.${quote(k)} IS NOT NULL`).join(' AND ');
          await count(table, `relation:${field.name}`, `${tableSql(table)} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${tableSql(parentTable)} p WHERE ${join})`);
          if (columns.get(table)?.has('workspaceId') && columns.get(parentTable)?.has('workspaceId')) await count(table, `relation_workspace:${field.name}`, `${tableSql(table)} c JOIN ${tableSql(parentTable)} p ON ${join} WHERE c."workspaceId" IS DISTINCT FROM p."workspaceId"`);
        }
      }
      // All catalog FKs, including raw-SQL tables absent from the compatibility view.
      const fks = await query<{ child: string; parent: string; child_columns: string[]; parent_columns: string[]; name: string }>(`SELECT c.relname AS child, p.relname AS parent, con.conname AS name,
        ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY k.ord) AS child_columns,
        ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=k.num ORDER BY k.ord) AS parent_columns
        FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_class p ON p.oid=con.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace WHERE con.contype='f' AND ns.nspname='public' AND pn.nspname='public'`);
      for (const fk of fks) {
        const join = fk.child_columns.map((c, i) => `c.${quote(c)} = p.${quote(fk.parent_columns[i])}`).join(' AND ');
        const present = fk.child_columns.map(c => `c.${quote(c)} IS NOT NULL`).join(' AND ');
        await count(fk.child, `orphan:${fk.name}`, `${tableSql(fk.child)} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${tableSql(fk.parent)} p WHERE ${join})`);
        if (columns.get(fk.child)?.has('workspaceId') && columns.get(fk.parent)?.has('workspaceId')) {
          await count(fk.child, `workspace:${fk.name}`, `${tableSql(fk.child)} c JOIN ${tableSql(fk.parent)} p ON ${join} WHERE c."workspaceId" IS DISTINCT FROM p."workspaceId"`);
        }
      }
      // Join tables have no workspace column of their own.
      for (const [table, left, leftKey, right, rightKey] of [
        ['post_targets', 'posts', 'postId', 'targets', 'targetId'],
        ['member_page_access', 'memberships', 'membershipId', 'targets', 'targetId'],
      ]) {
        if (![table, left, right].every(t => columns.has(t))) { add(table, 'required_relationship', 1); continue; }
        await count(table, 'workspace_boundary', `${tableSql(table)} j LEFT JOIN ${tableSql(left)} l ON l.id=j.${quote(leftKey)} LEFT JOIN ${tableSql(right)} r ON r.id=j.${quote(rightKey)} WHERE l.id IS NULL OR r.id IS NULL OR l."workspaceId" IS DISTINCT FROM r."workspaceId"`);
      }
      const features = new Set(PAGES.map(p => p.id as string));
      const maxScope = settings.find(r => r.key === 'mcp.keys.maxResourceIds')?.value ?? CONFIG_BY_KEY.get('mcp.keys.maxResourceIds')!.defaultValue;
      if (columns.has('mcp_api_keys')) {
        for (const key of await query('SELECT "workspaceId", "createdById", "resourceScope", "readFeatures", "writeFeatures" FROM public.mcp_api_keys')) {
          try {
            const scope = parseResourceScope(key.resourceScope, maxScope);
            // Null is explicitly supported for legacy credentials (current authority still intersects it).
            if (scope?.mode === 'selected') for (const [table, ids] of [['targets', scope.ids], ['ad_accounts', scope.adAccountIds]] as const) {
              for (const id of ids) {
                const rows = await tx.$queryRawUnsafe<Row[]>(`SELECT id FROM ${tableSql(table)} WHERE id=$1 AND "workspaceId"=$2`, id, key.workspaceId);
                add('mcp_api_keys', 'resource_workspace', rows.length ? 0 : 1);
              }
            }
          } catch { add('mcp_api_keys', 'resource_scope_shape', 1); }
          add('mcp_api_keys', 'feature_scope', !Array.isArray(key.readFeatures) || !Array.isArray(key.writeFeatures) || [...key.readFeatures, ...key.writeFeatures].some(id => !features.has(id)) || key.writeFeatures.some((id: string) => !key.readFeatures.includes(id)) ? 1 : 0);
          const members = await tx.$queryRawUnsafe<Row[]>('SELECT id FROM public.memberships WHERE "workspaceId"=$1 AND "userId"=$2', key.workspaceId, key.createdById);
          add('mcp_api_keys', 'creator_membership', members.length ? 0 : 1);
        }
      }
      checks.push(...configChecks(settings, options.baseline.rootKeys));
      if (columns.has('workspaces') && columns.has('memberships')) await count('workspaces', 'owner_membership', `public.workspaces w WHERE NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m."workspaceId"=w.id AND m.role::text='owner')`);
      const root = await realpath(options.mediaRoot);
      if (!(await lstat(root)).isDirectory()) throw new Error('Media root must be a restored directory.');
      if (!columns.has('media')) add('media', 'required_table', 1);
      const mediaRows = columns.has('media') ? await query('SELECT id, "workspaceId", "storageKey", "storageProvider"::text FROM public.media') : [];
      for (const media of mediaRows) if (media.storageProvider === 'local') {
        add('media', 'storage_workspace', typeof media.storageKey === 'string' && media.storageKey.startsWith(`${media.workspaceId}/`) ? 0 : 1);
        add('media', 'file_present', typeof media.storageKey === 'string' && await filePresent(root, media.storageKey) ? 0 : 1);
      }
      if (columns.has('posts')) {
        // Batches bound row memory; all reads use the same snapshot.
        for (let offset = 0; ; offset += 500) {
          const posts = await query(`SELECT "workspaceId", media FROM public.posts ORDER BY id LIMIT 500 OFFSET ${offset}`);
          for (const post of posts) {
            if (invalidMedia(post.media)) { add('posts', 'media_shape', 1); continue; }
            for (const item of post.media) if (item.url.startsWith('media:')) {
              const id = item.url.slice(6);
              const media = mediaRows.find(m => m.id === id);
              const present = media ? media.workspaceId === post.workspaceId && (media.storageProvider !== 'local' || (media.storageKey && await filePresent(root, media.storageKey))) : /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) && await filePresent(root, `${post.workspaceId}/images/${id}`);
              add('posts', 'media_reference_present', present ? 0 : 1);
            }
          }
          if (posts.length < 500) break;
        }
      }
      // Fold per-row results into aggregate evidence; never include private IDs or values.
      const totals = new Map<string, Check>();
      for (const check of checks) {
        const k = `${check.table}\0${check.rule}`;
        const existing = totals.get(k);
        if (existing) existing.failures = (BigInt(existing.failures) + BigInt(check.failures)).toString();
        else totals.set(k, { ...check });
      }
      const results = [...totals.values()];
      return { version: 1 as const, ok: results.every(c => c.failures === '0'), counts, sourceCounts: options.baseline.counts, checks: results,
        scope: 'Local data integrity only; no live permissions, providers, application workflows or production cutover proof.' };
    }, { isolationLevel: 'RepeatableRead', timeout: 600_000, maxWait: 10_000 });
  } finally { await db.$disconnect(); }
}

async function main() {
  const args = process.argv.slice(2);
  let snapshot = false;
  let baselineFile: string | undefined;
  let mediaRoot: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--snapshot' && !snapshot) snapshot = true;
    else if (['--baseline', '--media-root'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const flag = args[i++];
      if (flag === '--baseline' && !baselineFile) baselineFile = args[i];
      else if (flag === '--media-root' && !mediaRoot) mediaRoot = args[i];
      else throw new Error('Duplicate argument.');
    } else throw new Error('Invalid arguments.');
  }
  if (snapshot ? baselineFile || mediaRoot : !baselineFile || !mediaRoot) throw new Error('Use --snapshot OR --baseline FILE --media-root DIR.');
  const report = await inspectDatabase(process.env.DATABASE_URL ?? '', {
    snapshot, mediaRoot,
    baseline: baselineFile ? JSON.parse(await readFile(baselineFile, 'utf8')) : undefined,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if ('ok' in report && !report.ok) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch(() => { process.stdout.write(JSON.stringify({ version: 1, ok: false, error: 'Verification unavailable. Check guarded URL, baseline, restored media, schema and database access. / Vérification indisponible : vérifier URL locale, référence, médias restaurés, schéma et accès.' }) + '\n'); process.exitCode = 1; });
}
