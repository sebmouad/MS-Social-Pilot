/** Guarded, synthetic-only localhost/PostgreSQL/MCP probe for labels and Analytics Explorer. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles',
  'entitlements.features.publishing/labels', 'entitlements.features.analytics/explorer',
  'platforms.facebook.enabled',
] as const;

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required.');
  const database = new URL(databaseUrl), previewOrigin = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is allowed.');
  check(previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost' && previewOrigin.port === '3200', 'Only the explicit localhost:3200 HTTP preview origin is allowed.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_label_explorer_${randomUUID().replaceAll('-', '')}`;
  const workspaceA = `${prefix}_a`, workspaceB = `${prefix}_b`, rootId = `${prefix}_root`, ownerId = `${prefix}_owner`;
  const token = randomBytes(32).toString('base64url'), bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const keyId = `${prefix}_mcp`, expiresAt = new Date(Date.now() + 30 * 60_000);
  const cookie = `msp_session=${token}; sp_workspace=${workspaceA}`;
  const settings = new Map<string, { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null>();
  const previousAudits = new Set<string>(), changedAudits = new Set<string>();
  let settingsCaptured = false, fixtureStarted = false;
  const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

  async function http(path: string, method = 'GET', body?: unknown, workspaceId = workspaceA) {
    return fetch(new URL(path, previewOrigin), {
      method, redirect: 'manual',
      headers: { origin: previewOrigin.origin, cookie: `${cookie.split('; ')[0]}; sp_workspace=${workspaceId}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function saveSetting(key: string, value: unknown) {
    const response = await http('/api/root/config', 'PUT', { key, value });
    check(response.ok && (await json(response))?.ok === true, 'Preview Root setting change was not confirmed.');
  }
  async function mcp(name: string, args: unknown = {}) {
    const response = await fetch(new URL('/api/mcp?scope=workspace', previewOrigin), {
      method: 'POST', redirect: 'manual',
      headers: { origin: previewOrigin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
    });
    return { response, body: await json(response) };
  }
  async function insertAnalyticsFixture(targetId: string, workspaceId: string, socialId: string, pageName: string) {
    await db.$executeRaw`INSERT INTO social_accounts (id, "workspaceId", provider, "providerUserId", name, "accessToken", "createdAt", "updatedAt") VALUES (${socialId}, ${workspaceId}, 'facebook', ${`${prefix}_provider_${pageName}`}, 'Disposable Analytics account', 'synthetic-no-credential', NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO targets (id, "workspaceId", "socialAccountId", type, "providerId", name, enabled, "createdAt", "updatedAt") VALUES (${targetId}, ${workspaceId}, ${socialId}, 'page'::"TargetType", ${`${prefix}_${pageName}`}, ${`Disposable ${pageName}`}, true, NOW(), NOW())`;
    const value = 37;
    await db.$executeRaw`INSERT INTO page_insights (id, "targetId", metric, period, "endTime", value, numeric, "fetchedAt") VALUES (${`${prefix}_${pageName}_insight`}, ${targetId}, 'page_fans', 'day', NOW(), ${JSON.stringify(value)}::jsonb, ${value}, NOW())`;
  }

  try {
    stage = 'preflight preview availability and required tables before writes';
    const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(${['workspaces', 'users', 'memberships', 'sessions', 'mcp_api_keys', 'app_settings', 'root_activities', 'activity_logs', 'labels', 'posts', 'post_labels', 'post_templates', 'content_mix_rules', 'social_accounts', 'targets', 'page_insights']}::text[])`;
    check(tables.length === 16, 'Required legacy preview tables are unavailable; no fixture writes were attempted.');
    const preflight = await fetch(new URL('/sign-in', previewOrigin), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    check(preflight.status < 500 && new URL(preflight.url).origin === previewOrigin.origin, 'The expected localhost preview is not responding.');

    stage = 'capture exact Root settings and prior audit ids';
    const rows = await db.appSetting.findMany({ where: { key: { in: [...settingKeys] } }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
    for (const key of settingKeys) settings.set(key, rows.find(row => row.key === key) ?? null);
    settingsCaptured = true;
    const audits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...settingKeys]}::text[])`;
    audits.forEach(row => previousAudits.add(row.id));

    stage = 'create disposable Root identity, tenants, sessions and MCP read/write key';
    fixtureStarted = true;
    for (const [index, workspaceId] of [workspaceA, workspaceB].entries()) await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: `Disposable label and explorer ${index ? 'B' : 'A'}`, timezone: 'UTC' } });
    await db.user.create({ data: { id: rootId, email: `${rootId}@example.test`, name: 'Disposable Root', passwordHash: 'unusable-preview-password', isInstanceOwner: true, totpEnabledAt: new Date() } });
    await db.user.create({ data: { id: ownerId, email: `${ownerId}@example.test`, name: 'Disposable workspace owner', passwordHash: 'unusable-preview-password' } });
    for (const [index, workspaceId] of [workspaceA, workspaceB].entries()) {
      await db.membership.create({ data: { id: `${prefix}_root_membership_${index}`, userId: rootId, workspaceId, role: 'owner' } });
      await db.membership.create({ data: { id: `${prefix}_owner_membership_${index}`, userId: ownerId, workspaceId, role: 'owner' } });
    }
    await db.session.create({ data: { id: `${prefix}_root_session`, userId: rootId, tokenHash: hashSessionToken(token)!, expiresAt, pending: null } });
    await db.mcpApiKey.create({ data: { id: keyId, workspaceId: workspaceA, createdById: ownerId, name: 'Disposable labels and explorer probe key', tokenHash: tokenHash(bearer), tokenPrefix: bearer.slice(0, 12), expiresAt, readFeatures: ['publishing/labels', 'analytics/explorer'], writeFeatures: ['publishing/labels'] } });

    stage = 'enable the two product gates, local Facebook storage reader and MCP';
    await saveSetting('mcp.enabled', true);
    await saveSetting('mcp.authenticatedRoles', ['owner', 'admin']);
    await saveSetting('entitlements.features.publishing/labels', true);
    await saveSetting('entitlements.features.analytics/explorer', true);
    await saveSetting('platforms.facebook.enabled', true);

    stage = 'seed two tenants and isolated stored Analytics observations';
    const postA = `${prefix}_post_a`, postB = `${prefix}_post_b`, labelB = `${prefix}_label_b`;
    const targetA = `${prefix}_target_a`, targetB = `${prefix}_target_b`;
    await insertAnalyticsFixture(targetA, workspaceA, `${prefix}_social_a`, 'A');
    await insertAnalyticsFixture(targetB, workspaceB, `${prefix}_social_b`, 'B');
    for (const [id, workspaceId] of [[postA, workspaceA], [postB, workspaceB]] as const) {
      await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, "createdAt", "updatedAt") VALUES (${id}, ${workspaceId}, ${ownerId}, 'Synthetic post', NOW(), NOW())`;
    }
    await db.$executeRaw`INSERT INTO labels (id, "workspaceId", name, color, "createdAt") VALUES (${labelB}, ${workspaceB}, 'Foreign synthetic label', 'blue', NOW())`;

    stage = 'exercise label HTTP CRUD, scoped counts, foreign denial and legacy cascades';
    const createdResponse = await http('/api/publishing/labels', 'POST', { name: 'Probe label with references', color: 'blue', confirmation: 'CREATE LABEL Probe label with references' });
    const created = await json(createdResponse);
    check(createdResponse.status === 201 && typeof created?.id === 'string' && created.name === 'Probe label with references', 'Label HTTP create did not return a confirmed record.');
    const sharedLabelId = created.id as string;
    await db.$executeRaw`INSERT INTO post_labels ("postId", "labelId") VALUES (${postA}, ${sharedLabelId})`;
    await db.$executeRaw`INSERT INTO post_templates (id, "workspaceId", name, body, "labelId", "createdAt", "updatedAt") VALUES (${`${prefix}_template_a`}, ${workspaceA}, 'Synthetic template', 'Synthetic body', ${sharedLabelId}, NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO content_mix_rules (id, "workspaceId", "targetId", "labelId", "perWeek", "createdAt") VALUES (${`${prefix}_mix_a`}, ${workspaceA}, ${targetA}, ${sharedLabelId}, 2, NOW())`;
    const listResponse = await http('/api/publishing/labels'); const listed = await json(listResponse);
    const local = listed?.labels?.find((item: any) => item.id === sharedLabelId);
    check(listResponse.ok && local?.usage?.posts === 1 && local.usage.templates === 1 && local.usage.contentMixRules === 1, 'Label usage counts did not match same-workspace related rows.');
    check(!listed.labels.some((item: any) => item.id === labelB), 'Label list exposed a foreign workspace record.');
    const foreignDelete = await http(`/api/publishing/labels/${encodeURIComponent(labelB)}`, 'DELETE', { confirmation: `DELETE LABEL ${labelB}` });
    check(foreignDelete.status === 404 || (foreignDelete.status === 400 && (await json(foreignDelete))?.code === 'not_found'), 'Foreign-workspace label deletion was not denied.');
    const updatedResponse = await http(`/api/publishing/labels/${encodeURIComponent(sharedLabelId)}`, 'PUT', { name: 'Probe label renamed', color: 'teal', confirmation: `UPDATE LABEL ${sharedLabelId}` });
    check(updatedResponse.ok && (await json(updatedResponse))?.name === 'Probe label renamed', 'Label HTTP update did not confirm the scoped row.');
    const deleteCreate = await http('/api/publishing/labels', 'POST', { name: 'Probe delete effects', color: 'green', confirmation: 'CREATE LABEL Probe delete effects' });
    const deletion = await json(deleteCreate); check(deleteCreate.status === 201 && typeof deletion?.id === 'string', 'Delete-effects label fixture could not be created.');
    await db.$executeRaw`INSERT INTO post_labels ("postId", "labelId") VALUES (${postA}, ${deletion.id})`;
    await db.$executeRaw`INSERT INTO post_templates (id, "workspaceId", name, body, "labelId", "createdAt", "updatedAt") VALUES (${`${prefix}_template_delete`}, ${workspaceA}, 'Delete effects template', 'Synthetic body', ${deletion.id}, NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO content_mix_rules (id, "workspaceId", "targetId", "labelId", "perWeek", "createdAt") VALUES (${`${prefix}_mix_delete`}, ${workspaceA}, ${targetA}, ${deletion.id}, 1, NOW())`;
    const deleteResponse = await http(`/api/publishing/labels/${encodeURIComponent(deletion.id)}`, 'DELETE', { confirmation: `DELETE LABEL ${deletion.id}` });
    const deleted = await json(deleteResponse);
    check(deleteResponse.ok && deleted?.deleted === true && deleted.detached?.posts === 1 && deleted.detached?.templates === 1 && deleted.detached?.contentMixRules === 1, 'Label deletion receipt did not report actual legacy relation consequences.');
    check(await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_labels WHERE "labelId" = ${deletion.id}`.then(result => result[0]?.count === BigInt(0)), 'Label delete did not cascade post_labels rows.');
    check(await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_templates WHERE id = ${`${prefix}_template_delete`} AND "labelId" IS NULL`.then(result => result[0]?.count === BigInt(1)), 'Label delete did not null the legacy template label reference.');
    check(await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM content_mix_rules WHERE id = ${`${prefix}_mix_delete`}`.then(result => result[0]?.count === BigInt(0)), 'Label delete did not cascade the legacy content-mix rule.');
    check(await db.post.count({ where: { id: postA } }) === 1, 'Label deletion unexpectedly removed a post.');

    stage = 'exercise label and Analytics Explorer MCP read scopes';
    const labelMcp = await mcp('list_post_labels', {});
    check(labelMcp.response.ok && JSON.stringify(labelMcp.body).includes(sharedLabelId) && !JSON.stringify(labelMcp.body).includes(labelB), 'MCP label listing did not stay within the current tenant.');
    const explorerMcp = await mcp('get_analytics_explorer', { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) });
    const explorerText = JSON.stringify(explorerMcp.body);
    check(explorerMcp.response.ok && explorerText.includes('page_fans') && explorerText.includes('Disposable A') && !explorerText.includes('Disposable B'), 'MCP Analytics Explorer did not return the authorized stored metric without foreign-channel data.');
    const explorerApi = await http(`/api/analytics/explorer?start=${new Date().toISOString().slice(0, 10)}&end=${new Date().toISOString().slice(0, 10)}`);
    const explorerApiBody = await json(explorerApi);
    check(explorerApi.ok && explorerApiBody?.metrics?.items?.some((item: any) => item.key.includes('page_fans')) && JSON.stringify(explorerApiBody).includes('Disposable A') && !JSON.stringify(explorerApiBody).includes('Disposable B'), 'Analytics Explorer HTTP response did not preserve workspace resource isolation.');
    const foreignChannel = await http(`/api/analytics/explorer?start=${new Date().toISOString().slice(0, 10)}&end=${new Date().toISOString().slice(0, 10)}&filter=1&channel=${encodeURIComponent(targetB)}`);
    check(foreignChannel.status === 403 || foreignChannel.status === 400, 'Analytics Explorer accepted a channel from another workspace.');

    stage = 'verify API and MCP honor per-feature installation gates';
    await saveSetting('entitlements.features.publishing/labels', false);
    const deniedLabels = await http('/api/publishing/labels');
    check(!deniedLabels.ok, 'Labels API ignored the Root installation feature gate.');
    const deniedLabelMcp = await mcp('list_post_labels', {});
    check(/forbidden|not enabled|unavailable/i.test(JSON.stringify(deniedLabelMcp.body)), 'Labels MCP ignored the Root installation feature gate.');
    await saveSetting('entitlements.features.publishing/labels', true);
    await saveSetting('entitlements.features.analytics/explorer', false);
    const deniedExplorer = await http('/api/analytics/explorer');
    check(!deniedExplorer.ok, 'Analytics Explorer API ignored the Root installation feature gate.');
    const deniedExplorerMcp = await mcp('get_analytics_explorer', {});
    check(/forbidden|not enabled|unavailable/i.test(JSON.stringify(deniedExplorerMcp.body)), 'Analytics Explorer MCP ignored the Root installation feature gate.');
    await saveSetting('entitlements.features.analytics/explorer', true);

    stage = 'verify workspace audit rows and fixture persistence';
    const auditsInA = await db.$queryRaw<Array<{ labelWrites: bigint }>>`SELECT COUNT(*) FILTER (WHERE action LIKE 'publishing.label_%')::bigint AS "labelWrites" FROM activity_logs WHERE "workspaceId" = ${workspaceA}`;
    const auditsInB = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceB} AND action LIKE 'publishing.label_%'`;
    check(Number(auditsInA[0]?.labelWrites ?? 0) >= 3 && Number(auditsInB[0]?.count ?? 0) === 0, 'Label audit entries were missing or escaped their workspace.');
    check(await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM labels WHERE id = ${labelB} AND "workspaceId" = ${workspaceB}`.then(result => result[0]?.count === BigInt(1)), 'Probe changed the foreign tenant label.');
    console.log('PASS: prepared local probe verified synthetic label CRUD/counts/legacy cascades, tenant isolation, Analytics Explorer HTTP/MCP stored reads, resource scope, and feature denials.');
  } finally {
    stage = `cleanup after ${stage}`;
    const cleanupErrors: string[] = [];
    async function cleanup(label: string, action: () => Promise<unknown>) { try { await action(); } catch { cleanupErrors.push(label); } }
    if (settingsCaptured) {
      for (const key of settingKeys) {
        const previous = settings.get(key);
        await cleanup(`setting:${key}`, async () => {
          await db.appSetting.deleteMany({ where: { key } });
          if (previous) await db.appSetting.create({ data: { ...previous, value: previous.value as Prisma.InputJsonValue } });
        });
      }
      await cleanup('Root config audits', async () => {
        const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...settingKeys]}::text[])`;
        for (const row of rows) if (!previousAudits.has(row.id)) changedAudits.add(row.id);
        if (changedAudits.size) await db.$executeRaw`DELETE FROM root_activities WHERE id = ANY(${[...changedAudits]}::text[])`;
      });
    }
    await cleanup('MCP key', () => db.mcpApiKey.deleteMany({ where: { id: keyId } }));
    await cleanup('synthetic sessions', () => db.session.deleteMany({ where: { userId: { in: [rootId, ownerId] } } }));
    await cleanup('synthetic workspaces and dependent records', () => db.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } }));
    await cleanup('synthetic users', () => db.user.deleteMany({ where: { id: { in: [rootId, ownerId] } } }));
    if (fixtureStarted) await cleanup('fixture and setting restoration verification', async () => {
      check(await db.user.count({ where: { id: { in: [rootId, ownerId] } } }) === 0 && await db.workspace.count({ where: { id: { in: [workspaceA, workspaceB] } } }) === 0
        && await db.session.count({ where: { userId: { in: [rootId, ownerId] } } }) === 0 && await db.mcpApiKey.count({ where: { id: keyId } }) === 0,
      'Synthetic identities, workspaces, sessions or MCP key remain after cleanup.');
      const leftoverAudit = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ANY(${[workspaceA, workspaceB]}::text[])`;
      check(leftoverAudit[0]?.count === BigInt(0), 'Synthetic workspace audit records remain after cleanup.');
      for (const key of settingKeys) {
        const restored = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
        check(JSON.stringify(restored) === JSON.stringify(settings.get(key)), 'A Root setting was not restored exactly to its original row.');
      }
      const remaining = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM root_activities WHERE id = ANY(${[...changedAudits]}::text[])`;
      check(remaining[0]?.count === BigInt(0), 'Synthetic Root config audit rows remain after cleanup.');
    });
    await db.$disconnect().catch(() => { cleanupErrors.push('database disconnect'); });
    check(cleanupErrors.length === 0, 'Disposable records or Root settings could not be restored and verified.');
    console.log('Synthetic tenants, identities, page data, labels, related records, MCP keys, audit rows and exact prior Root settings restored and verified.');
  }
}

main().catch(error => {
  console.error(`Labels and Analytics Explorer probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : 'unexpected local verification failure (details withheld)'}`);
  process.exitCode = 1;
});
