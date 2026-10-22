/** Guarded, synthetic-only localhost/PostgreSQL/MCP probe for Publishing collaboration. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles',
  'entitlements.features.publishing/collaboration', 'publishing.collab.notePageSize',
] as const;

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required.');
  const database = new URL(databaseUrl), previewOrigin = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is allowed.');
  check(previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost' && previewOrigin.port === '3200', 'Only the explicit localhost:3200 HTTP preview origin is allowed.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_collab67_${randomUUID().replaceAll('-', '')}`;
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
    await db.mcpApiKey.create({ data: { id: keyId, workspaceId: workspaceA, createdById: ownerId, name: 'Disposable labels and explorer probe key', tokenHash: tokenHash(bearer), tokenPrefix: bearer.slice(0, 12), expiresAt, readFeatures: ['publishing/collaboration'], writeFeatures: ['publishing/collaboration'] } });

    stage = 'enable collaboration and authenticated workspace MCP';
    await saveSetting('mcp.enabled', true);
    await saveSetting('mcp.authenticatedRoles', ['owner', 'admin']);
    await saveSetting('entitlements.features.publishing/collaboration', true);
    const postA = `${prefix}_post_a`, postB = `${prefix}_post_b`, labelA = `${prefix}_label_a`;
    for (const [id, workspaceId] of [[postA, workspaceA], [postB, workspaceB]] as const) await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, "createdAt", "updatedAt") VALUES (${id}, ${workspaceId}, ${ownerId}, 'Disposable collaboration post', NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO labels (id, "workspaceId", name, color, "createdAt") VALUES (${labelA}, ${workspaceA}, 'Disposable collaboration label', 'blue', NOW())`;

    stage = 'custom field HTTP CRUD, values and foreign-post denial';
    const response = await http('/api/publishing/custom-fields', 'POST', { name: 'Disposable campaign', kind: 'choice', options: ['Summer', 'Winter'], confirmation: 'CREATE FIELD Disposable campaign' });
    const field = await json(response); check(response.status === 201 && typeof field?.id === 'string', 'Field creation was not confirmed.');
    const fieldId = field.id as string;
    const valueResponse = await http(`/api/publishing/custom-fields/posts/${postA}`, 'PUT', { values: { [fieldId]: 'Summer' }, confirmation: `SET POST FIELDS ${postA}` });
    check(valueResponse.ok && (await json(valueResponse))?.set === 1, 'Field value was not stored.');
    const foreign = await http(`/api/publishing/custom-fields/posts/${postB}`, 'PUT', { values: { [fieldId]: 'Winter' }, confirmation: `SET POST FIELDS ${postB}` });
    check(!foreign.ok, 'Foreign post was writable.');
    const fields = await mcp('get_post_field_values', { postId: postA });
    check(fields.response.ok && fields.body?.result?.structuredContent?.fields?.some((item: any) => item.id === fieldId && item.value === 'Summer'), 'MCP field values did not match persistence.');
    const invalid = await mcp('create_custom_field', { name: 'Must not save', kind: 'text', confirmation: 'wrong' });
    check(invalid.body?.result?.isError === true, 'Incorrect write confirmation was accepted.');

    stage = 'bulk labels and internal notes through HTTP and MCP';
    const assigned = await http('/api/publishing/assignments', 'POST', { postIds: [postA], labelIds: [labelA], mode: 'add', confirmation: 'ADD LABELS ON 1 POST' });
    check(assigned.ok && (await json(assigned))?.posts?.[0]?.labelIds?.includes(labelA), 'Bulk labels were not confirmed.');
    const labelRead = await mcp('get_post_labels', { postId: postA });
    check(labelRead.body?.result?.structuredContent?.labels?.some((item: any) => item.id === labelA), 'MCP label associations do not match the UI service.');
    const labelChoices = await mcp('list_post_label_choices', { page: 1 });
    check(labelChoices.body?.result?.structuredContent?.labels?.some((item: any) => item.id === labelA), 'MCP label choices are unavailable.');
    const held = await mcp('get_post_recycle', { postId: postA });
    check(held.body?.result?.isError === true, 'Unregistered automatic scheduling was exposed.');
    const noteResult = await mcp('add_post_note', { postId: postA, body: 'Identifiable disposable internal note', confirmation: `ADD NOTE ${postA}` });
    const note = noteResult.body?.result?.structuredContent;
    check(noteResult.response.ok && typeof note?.id === 'string', 'MCP note creation was not confirmed.');
    const listed = await http(`/api/publishing/notes?postId=${postA}`); const list = await json(listed);
    check(listed.ok && list?.notes?.some((item: any) => item.id === note.id), 'Stored note is absent from HTTP.');
    const persisted = await db.$queryRaw<Array<{ body: string }>>`SELECT body FROM post_notes WHERE id = ${note.id}`;
    check(persisted[0]?.body === 'Identifiable disposable internal note', 'Note persistence differs.');
    const removed = await http(`/api/publishing/notes/${note.id}`, 'DELETE', { confirmation: `DELETE NOTE ${note.id}` });
    check(removed.ok && (await json(removed))?.deleted === true, 'Note deletion was not confirmed.');
    await saveSetting('publishing.collab.notePageSize', 5);
    for (let index = 0; index < 6; index++) await db.$executeRaw`INSERT INTO post_notes (id, "postId", "authorId", body, "createdAt") VALUES (${`${prefix}_paging_${index}`}, ${postA}, ${ownerId}, ${`Disposable paging note ${index}`}, NOW())`;
    const notesFirstResponse = await http(`/api/publishing/notes?postId=${postA}&page=1`), notesSecondResponse = await http(`/api/publishing/notes?postId=${postA}&page=2`);
    const notesFirst = await json(notesFirstResponse), notesSecond = await json(notesSecondResponse);
    check(notesFirstResponse.ok && notesSecondResponse.ok && notesFirst.notes?.length === 5 && notesFirst.hasMore === true && notesSecond.notes?.length === 1 && notesSecond.hasMore === false, 'Notes pagination did not expose all records within the current Root page size.');
    const postPage = await http(`/content/post/${postA}`);
    check(postPage.ok && (await postPage.text()).includes('Older notes'), 'Post organization page did not expose older-note navigation.');
    check((await http('/api/publishing/custom-fields?unknown=1')).status === 400, 'Unknown field filters were ignored.');
    const corruptId = `${prefix}_foreign_field_value`;
    await db.$executeRaw`INSERT INTO post_field_values (id, "postId", "fieldId", value) VALUES (${corruptId}, ${postB}, ${fieldId}, 'Winter')`;
    const guardedDeletion = await mcp('delete_custom_field', { id: fieldId, confirmation: `DELETE FIELD ${fieldId}` });
    check(guardedDeletion.body?.result?.isError === true, 'Cross-tenant field relation allowed cascading deletion.');
    const preserved = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM post_field_values WHERE id = ${corruptId}`;
    check(preserved.length === 1, 'Foreign related value was removed by a denied operation.');
    await db.$executeRaw`DELETE FROM post_field_values WHERE id = ${corruptId}`;
    const deletedField = await mcp('delete_custom_field' , { id: fieldId, confirmation: `DELETE FIELD ${fieldId}` });
    check(deletedField.body?.result?.structuredContent?.deleted === true, 'MCP field deletion failed.');
    const values = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_field_values WHERE "fieldId" = ${fieldId}`;
    check(values[0]?.count === BigInt(0), 'Deleted field values remain.');

    stage = 'current feature and write permission enforcement';
    await db.mcpApiKey.update({ where: { id: keyId }, data: { writeFeatures: [] } });
    const readOnly = await mcp('add_post_note', { postId: postA, body: 'Must not save', confirmation: `ADD NOTE ${postA}` });
    check(readOnly.body?.result?.isError === true, 'Read-only key performed a write.');
    await saveSetting('entitlements.features.publishing/collaboration', false);
    check(!(await http('/api/publishing/custom-fields')).ok, 'Disabled feature remained available through HTTP.');
    const denied = await mcp('list_custom_fields'); check(denied.body?.result?.isError === true, 'Disabled feature remained available through MCP.');
    console.log('PASS: synthetic Publishing collaboration HTTP/MCP/PostgreSQL fields, values, labels, notes, confirmations, tenant and permission checks; no provider calls.');
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
    console.log('Synthetic collaboration records, tenants, identities, MCP keys, audits and exact prior settings restored and verified.');
  }
}

main().catch(error => {
  console.error(`Labels and Analytics Explorer probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : 'unexpected local verification failure (details withheld)'}`);
  process.exitCode = 1;
});
