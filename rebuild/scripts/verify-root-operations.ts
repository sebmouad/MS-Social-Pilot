/** Synthetic-only installation HTTP/MCP/PostgreSQL verification; never production. */
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'explicit preview guards';

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && origin && databaseUrl === process.env.DATABASE_URL && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin required.');
  const database = new URL(databaseUrl), url = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Isolated loopback preview database required.');
  check(origin === 'http://localhost:3200' && url.origin === origin, 'Canonical localhost preview origin required.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_root65_${randomUUID().replaceAll('-', '')}`;
  const root = `${prefix}_root`, member = `${prefix}_member`, recipient = `${prefix}_recipient`, workspace = `${prefix}_workspace`, plan = `${prefix}_plan`, errorId = `${prefix}_error`;
  const rootMembership = `${prefix}_root_member`, memberMembership = `${prefix}_member_member`;
  const users = [root, member, recipient], backupIds = [`${prefix}_offsite`, `${prefix}_restore`];
  const rootToken = randomBytes(32).toString('base64url'), memberToken = randomBytes(32).toString('base64url');
  const recipientEmail = `${recipient}@example.test`, memberEmail = `${member}@example.test`;
  const secretMarker = 'preview_dummy_secret_never_a_real_credential';
  let original: { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null = null;
  let captured = false, fixtureStarted = false;
  async function http(path: string, method = 'GET', body?: unknown, token = rootToken) {
    return fetch(new URL(path, url), { method, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { origin: url.origin, cookie: `msp_session=${token}; sp_workspace=${workspace}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function mcp(name: string, args: unknown = {}, token = rootToken) {
    const response = await http('/api/mcp?scope=installation', 'POST', { jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }, token);
    return { response, body: await json(response) };
  }
  async function ok(response: Response, message: string) {
    const body = await json(response);
    check(response.ok && body?.ok === true, `${message} (HTTP ${response.status}, code ${typeof body?.code === 'string' ? body.code : 'unknown'}).`);
    return body;
  }
  try {
    stage = 'preview preflight';
    const health = await fetch(new URL('/sign-in', url), { signal: AbortSignal.timeout(10000) });
    check(health.status < 500, 'Preview is unavailable.');
    original = await db.appSetting.findUnique({ where: { key: 'mcp.enabled' }, select: { key: true, value: true, encrypted: true, updatedAt: true } }); captured = true;
    fixtureStarted = true;
    await db.workspace.create({ data: { id: workspace, slug: workspace, name: 'Disposable Root verification', timezone: 'UTC' } });
    for (const id of users) await db.user.create({ data: { id, email: `${id}@example.test`, name: 'Disposable Root verification', passwordHash: 'unusable-preview-password', isInstanceOwner: id === root, totpEnabledAt: new Date() } });
    await db.membership.create({ data: { id: rootMembership, workspaceId: workspace, userId: root, role: 'owner' } });
    await db.membership.create({ data: { id: memberMembership, workspaceId: workspace, userId: member, role: 'owner' } });
    const expiresAt = new Date(Date.now() + 1800000);
    for (const [id, token] of [[root, rootToken], [member, memberToken]]) await db.session.create({ data: { id: `${id}_session`, userId: id, tokenHash: hashLegacySessionToken(token)!, expiresAt, pending: null } });
    await db.$executeRaw`INSERT INTO plans (id, key, name, features, "isDefault", "createdAt", "updatedAt") VALUES (${plan}, ${plan}, 'Disposable plan', ARRAY['product_v2', 'publishing/posts']::text[], false, NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO error_events (id, fingerprint, source, name, message, stack, location, release, "firstSeenAt", "lastSeenAt") VALUES (${errorId}, ${errorId}, 'server', 'Synthetic error', ${`password=${secretMarker}`}, ${`cookie=${secretMarker}`}, '/preview?token=not-real', 'preview', NOW(), NOW())`;
    for (const [index, kind] of ['offsite', 'restore_test'].entries()) await db.$executeRaw`INSERT INTO backup_runs (id, kind, status, detail, "startedAt", "finishedAt") VALUES (${backupIds[index]}, ${kind}, 'ok', 'Synthetic probe record; no actual backup', NOW(), NOW())`;
    await ok(await http('/api/root/config', 'PUT', { key: 'mcp.enabled', value: true }), 'MCP enablement');

    stage = 'private authority and strict requests';
    for (const path of ['/api/root/plans', '/api/root/privileges', '/api/root/lifecycle', '/api/root/errors', '/api/root/backups']) {
      const denied = await http(path, 'GET', undefined, memberToken); check([401, 403, 404].includes(denied.status), 'Workspace owner reached private Root data.');
    }
    const keyDenied = await mcp('list_root_plans', {}, memberToken); check(!keyDenied.response.ok || keyDenied.body?.result?.isError === true || keyDenied.body?.error, 'Non-Root installation MCP was accepted.');
    check((await http('/api/root/privileges?role=owner&role=viewer')).status === 400, 'Repeated Root filter was accepted.');
    check((await http('/api/root/backups?unknown=1')).status === 400, 'Unknown Root filter was accepted.');

    stage = 'plan reads and confirmed writes';
    const catalog = await ok(await http('/api/root/plans'), 'Plan catalog'); check(catalog.plans.some((item: any) => item.id === plan), 'Synthetic plan missing.');
    check((await http(`/api/root/plans/${plan}`, 'PATCH', { patch: { name: 'Must not save' }, confirmation: 'wrong' })).status === 400, 'Incorrect plan confirmation was accepted.');
    const changed = await mcp('update_root_plan', { planId: plan, patch: { name: 'Verified disposable plan', members: 3 }, confirmation: `UPDATE PLAN ${plan}` });
    check(changed.response.ok && changed.body?.result?.structuredContent?.changed === true, 'Installation MCP plan update failed.');
    const stored = await db.$queryRaw<Array<{ name: string; members: number }>>`SELECT name, members FROM plans WHERE id = ${plan}`;
    check(stored[0]?.name === 'Verified disposable plan' && stored[0].members === 3, 'Plan update was not stored.');
    await ok(await http('/api/root/plans/assign', 'POST', { userId: member, planKey: plan, confirmation: `ASSIGN PLAN ${plan} TO ${memberEmail}` }), 'Plan assignment');
    const assigned = await db.$queryRaw<Array<{ planId: string }>>`SELECT "planId" FROM users WHERE id = ${member}`; check(assigned[0]?.planId === plan, 'Plan assignment not stored.');
    const history = await ok(await http('/api/root/plans?view=history'), 'Plan history'); check(history.items.some((item: any) => item.actor === `${root}@example.test`), 'Root plan audit missing.');

    stage = 'role and ownership invariants';
    await ok(await http('/api/root/privileges', 'POST', { membershipId: memberMembership, role: 'editor', confirmation: `CHANGE ROLE ${memberEmail} IN ${workspace} TO editor` }), 'Role mutation');
    const lastOwner = await http('/api/root/privileges', 'POST', { membershipId: rootMembership, role: 'viewer', confirmation: `CHANGE ROLE ${root}@example.test IN ${workspace} TO viewer` }); check(lastOwner.status === 409, 'Last active owner was demoted.');
    await ok(await http('/api/root/lifecycle/ownership', 'POST', { workspaceId: workspace, newOwnerEmail: recipientEmail, previousOwners: 'demote_admin', confirmation: `TRANSFER WORKSPACE ${workspace} TO ${recipientEmail}` }), 'Ownership transfer');
    const membership = await db.$queryRaw<Array<{ role: string; allPages: boolean }>>`SELECT role::text AS role, "allPages" FROM memberships WHERE "workspaceId" = ${workspace} AND "userId" = ${recipient}`;
    check(membership[0]?.role === 'owner' && membership[0].allPages === true, 'Ownership transfer did not grant the expected workspace scope.');
    const privileges = await ok(await http(`/api/root/privileges?workspaceId=${workspace}`), 'Privilege directory'); check(privileges.items.some((item: any) => item.userId === recipient && item.role === 'owner'), 'Privilege audit missed new owner.');

    stage = 'redacted errors and confirmed resolution';
    const error = await ok(await http(`/api/root/errors/${errorId}`), 'Error detail'); check(!JSON.stringify(error).includes(secretMarker), 'Error detail exposed dummy credential-shaped text.');
    const unconfirmed = await mcp('set_root_error_resolved', { id: errorId, resolved: true }); check(unconfirmed.body?.result?.isError === true, 'MCP error mutation accepted no confirmation.');
    const resolved = await mcp('set_root_error_resolved', { id: errorId, resolved: true, confirmation: `RESOLVE ROOT ERROR ${errorId}` }); check(resolved.body?.result?.structuredContent?.changed === true, 'Confirmed error resolution failed.');
    check((await db.$queryRaw<Array<{ resolvedAt: Date | null }>>`SELECT "resolvedAt" FROM error_events WHERE id = ${errorId}`)[0]?.resolvedAt, 'Error resolution not stored.');

    stage = 'truthful recorded backup and lifecycle reads';
    const backups = await ok(await http('/api/root/backups'), 'Backup records'); check(backups.backups?.source === 'backup_runs' && backups.backups.checks.length === 2 && backups.backups.checks.every((item: any) => item.verification === 'recorded_by_script'), 'Backup records claimed archive verification.');
    const lifecycle = await ok(await http('/api/root/lifecycle'), 'Lifecycle summary'); check(lifecycle.deletion === 'unavailable', 'Lifecycle advertises unimplemented deletion.');
    await db.user.update({ where: { id: root }, data: { disabledAt: new Date() } });
    check([401, 403, 404].includes((await http('/api/root/plans')).status), 'Disabled Root kept private HTTP access.');
    check(!(await mcp('list_root_plans')).response.ok, 'Disabled Root kept installation MCP access.');
    console.log('PASS: synthetic private Root HTTP/MCP/database plan, privilege, ownership, error and recorded-backup workflows; no provider or production calls.');
  } finally {
    if (fixtureStarted) {
      await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ANY(${users}::text[])`;
      await db.$executeRaw`DELETE FROM error_events WHERE id = ${errorId}`;
      await db.$executeRaw`DELETE FROM backup_runs WHERE id = ANY(${backupIds}::text[])`;
      await db.workspace.deleteMany({ where: { id: workspace } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$executeRaw`DELETE FROM plans WHERE id = ${plan}`;
    }
    if (captured) {
      if (original) await db.appSetting.upsert({ where: { key: original.key }, create: { ...original, value: original.value === null ? Prisma.JsonNull : original.value }, update: { value: original.value === null ? Prisma.JsonNull : original.value, encrypted: original.encrypted, updatedAt: original.updatedAt } });
      else await db.appSetting.deleteMany({ where: { key: 'mcp.enabled' } });
      const restored = await db.appSetting.findUnique({ where: { key: 'mcp.enabled' } });
      check(original ? restored && JSON.stringify(restored.value) === JSON.stringify(original.value) && restored.encrypted === original.encrypted && restored.updatedAt.getTime() === original.updatedAt.getTime() : !restored, 'Root setting restoration failed.');
    }
    check(await db.user.count({ where: { id: { in: users } } }) === 0 && await db.workspace.count({ where: { id: workspace } }) === 0, 'Synthetic account/workspace cleanup failed.');
    const remaining = await db.$queryRaw<Array<{ count: bigint }>>`SELECT ((SELECT COUNT(*) FROM root_activities WHERE "actorId" = ANY(${users}::text[])) + (SELECT COUNT(*) FROM error_events WHERE id = ${errorId}) + (SELECT COUNT(*) FROM backup_runs WHERE id = ANY(${backupIds}::text[])) + (SELECT COUNT(*) FROM plans WHERE id = ${plan}))::bigint AS count`;
    check(remaining[0]?.count === BigInt(0), 'Synthetic Root record cleanup failed.');
    console.log('Synthetic fixtures, Root audit rows and exact prior MCP setting restored and verified.');
    await db.$disconnect();
  }
}

main().catch(error => { const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : error instanceof ProbeFailure ? error.message : 'unexpected local verification failure'; console.error(`Root probe failed at ${stage}: ${code}`); process.exitCode = 1; });
