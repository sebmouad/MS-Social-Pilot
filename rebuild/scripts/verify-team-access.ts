/** Disposable localhost-only verification of the real Team HTTP, PostgreSQL and MCP boundaries. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new ProbeFailure(message); }
let stage = 'preview guards';
async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required.');
  const database = new URL(databaseUrl), preview = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is allowed.');
  check(preview.origin === origin && preview.protocol === 'http:' && preview.hostname === 'localhost', 'Only an explicit localhost HTTP preview origin is allowed.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_team61_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `${prefix}_workspace`, foreignWorkspaceId = `${prefix}_foreign`;
  const actorId = `${prefix}_owner`, secondOwnerId = `${prefix}_second_owner`, memberId = `${prefix}_member`, adminId = `${prefix}_admin`;
  const actorMembershipId = `${prefix}_owner_membership`, secondMembershipId = `${prefix}_second_membership`, adminMembershipId = `${prefix}_admin_membership`;
  const userIds = [actorId, secondOwnerId, memberId, adminId];
  const token = randomBytes(32).toString('base64url'), adminToken = randomBytes(32).toString('base64url');
  const readKey = `mcp_${randomBytes(32).toString('base64url')}`, writeKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const keyIds = [`${prefix}_read_key`, `${prefix}_write_key`];
  const expiresAt = new Date(Date.now() + 600_000);
  const cookie = (value = token) => `msp_session=${value}; sp_workspace=${workspaceId}`;
  const address = `${memberId}@example.test`;
  const targetId = `${prefix}_channel`, foreignTargetId = `${prefix}_foreign_channel`;
  async function http(method: string, input?: unknown, session = token) {
    const response = await fetch(new URL('/api/settings/team', preview), { method, redirect: 'manual', headers: { origin: preview.origin, cookie: cookie(session), 'content-type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    check(response.headers.get('cache-control') === 'no-store', 'Team responses must be private no-store.');
    return { response, body: await response.json() };
  }
  async function rpc(name: string, args: unknown = {}, bearer = writeKey) {
    const response = await fetch(new URL('/api/mcp?scope=workspace', preview), { method: 'POST', redirect: 'manual', headers: { origin: preview.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    check(response.headers.get('cache-control') === 'no-store', 'MCP responses must be private no-store.');
    const body = await response.json();
    return { response, body, result: body.result?.structuredContent };
  }
  try {
    stage = 'isolated synthetic identities';
    for (const id of [workspaceId, foreignWorkspaceId]) await db.workspace.create({ data: { id, slug: id, name: 'Disposable Team verification', timezone: 'UTC' } });
    for (const id of userIds) await db.user.create({ data: { id, name: `Synthetic ${id.slice(-12)}`, email: `${id}@example.test`, passwordHash: 'unusable-preview-account' } });
    for (const [id, userId, role] of [[actorMembershipId, actorId, 'owner'], [secondMembershipId, secondOwnerId, 'owner'], [adminMembershipId, adminId, 'admin']] as const) await db.membership.create({ data: { id, userId, workspaceId, role } });
    // An independent membership proves removal preserves unrelated access.
    await db.membership.create({ data: { id: `${prefix}_foreign_membership`, userId: memberId, workspaceId: foreignWorkspaceId, role: 'viewer' } });
    for (const [id, userId, value] of [[`${prefix}_session`, actorId, token], [`${prefix}_admin_session`, adminId, adminToken]]) await db.session.create({ data: { id, userId, tokenHash: hashSessionToken(value)!, expiresAt, pending: null } });
    for (const [index, bearer] of [readKey, writeKey].entries()) await db.mcpApiKey.create({ data: { id: keyIds[index]!, workspaceId, createdById: actorId, name: 'Disposable Team probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), expiresAt, readFeatures: ['settings/team'], writeFeatures: index ? ['settings/team'] : [] } });
    for (const [id, workspace] of [[targetId, workspaceId], [foreignTargetId, foreignWorkspaceId]]) {
      const socialId = `${id}_source`;
      await db.socialAccount.create({ data: { id: socialId, workspaceId: workspace, provider: 'facebook', providerUserId: socialId, name: 'Synthetic source', accessToken: 'not-a-real-credential' } });
      await db.target.create({ data: { id, workspaceId: workspace, socialAccountId: socialId, providerId: id, name: 'Synthetic selected channel', type: 'page', enabled: true, canPublish: false, createdAt: new Date() } });
    }
    stage = 'current authorized directory';
    const directory = await http('GET');
    check(directory.response.ok && directory.body.total === 3 && directory.body.targets.some((target: { id: string }) => target.id === targetId), 'Owner must see the actual selected channel and three members.');
    check(!JSON.stringify(directory.body).includes(foreignTargetId) && !JSON.stringify(directory.body).includes('not-a-real-credential'), 'Directory must not include foreign channels or credentials.');
    const add = { email: address.toUpperCase(), role: 'editor', allPages: false, targetIds: [targetId], confirmation: `ADD MEMBER ${address}` };
    stage = 'invalid confirmation and cross-workspace scope';
    check((await http('POST', { ...add, confirmation: 'yes' })).response.status === 400, 'Exact confirmation is mandatory.');
    check((await http('POST', { ...add, targetIds: [foreignTargetId] })).response.status === 404, 'Foreign channel grants must be refused.');
    check((await db.membership.count({ where: { userId: memberId, workspaceId } })) === 0, 'Rejected additions must have no membership side effect.');
    stage = 'HTTP add and PostgreSQL scope receipt';
    const added = await http('POST', add);
    check(added.response.ok && added.body.ok === true && added.body.added === true && typeof added.body.id === 'string', 'HTTP addition must return an explicit membership receipt.');
    const membershipId = added.body.id as string;
    const grants = await db.$queryRaw<Array<{ allPages: boolean; targetId: string }>>`SELECT m."allPages", a."targetId" FROM memberships m JOIN member_page_access a ON a."membershipId" = m.id WHERE m.id = ${membershipId} AND m."workspaceId" = ${workspaceId}`;
    check(grants.length === 1 && !grants[0]!.allPages && grants[0]!.targetId === targetId, 'Only the exact selected channel must be persisted.');
    check((await http('POST', add)).response.status === 409, 'A repeated add must not create another membership.');
    stage = 'MCP read/write key parity';
    const read = await rpc('list_workspace_team', { limit: 1 }, readKey);
    check(read.result?.members.length === 1 && read.result.total === 4 && read.result.nextOffset === 1, 'Read-only workspace key must see a bounded directory.');
    const update = { membershipId, role: 'viewer', allPages: true, targetIds: [], confirmation: `UPDATE MEMBER ${membershipId}` };
    check((await rpc('update_workspace_member', update, readKey)).result?.code === 'forbidden', 'Read-only key must not mutate team access.');
    const updated = await rpc('update_workspace_member', update);
    check(updated.result?.updated === true && updated.result.id === membershipId, 'MCP must mutate through the same membership service.');
    check((await db.membership.findUnique({ where: { id: membershipId } }))?.role === 'viewer', 'MCP role change must be persisted.');
    check((await db.$queryRaw<Array<{ allPages: boolean }>>`SELECT "allPages" FROM memberships WHERE id = ${membershipId}`)[0]?.allPages === true
      && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM member_page_access WHERE "membershipId" = ${membershipId}`)[0]?.count === BigInt(0), 'All-channel change must clear old explicit grants.');
    stage = 'admin versus owner and self guards';
    const promote = { ...update, role: 'owner' };
    check((await http('PATCH', promote, adminToken)).response.status === 403, 'Admin must not assign the owner role.');
    const self = { ...update, membershipId: actorMembershipId, confirmation: `UPDATE MEMBER ${actorMembershipId}` };
    check((await http('PATCH', self)).response.status === 409, 'Owner cannot demote their own membership.');
    check((await http('DELETE', { membershipId: actorMembershipId, confirmation: `REMOVE MEMBER ${actorMembershipId}` })).response.status === 409, 'Owner cannot remove their own access.');
    stage = 'current account and workspace access rechecks';
    await db.user.update({ where: { id: actorId }, data: { disabledAt: new Date() } });
    const denied = await rpc('list_workspace_team');
    check(!denied.response.ok || denied.result?.code === 'unauthorized' || Boolean(denied.body.error), 'A disabled key creator must lose MCP access.');
    await db.user.update({ where: { id: actorId }, data: { disabledAt: null } });
    await db.$executeRaw`UPDATE workspaces SET "suspendedAt" = NOW() WHERE id = ${workspaceId}`;
    const suspended = await rpc('list_workspace_team');
    check(!suspended.response.ok || suspended.result?.code === 'forbidden' || Boolean(suspended.body.error), 'Suspended workspace must lose team access.');
    await db.$executeRaw`UPDATE workspaces SET "suspendedAt" = NULL WHERE id = ${workspaceId}`;
    stage = 'disabled member removal retains account and other workspace';
    await db.user.update({ where: { id: memberId }, data: { disabledAt: new Date() } });
    const removed = await rpc('remove_workspace_member', { membershipId, confirmation: `REMOVE MEMBER ${membershipId}` });
    check(removed.result?.removed === true, 'Disabled members must remain removable.');
    check(await db.user.count({ where: { id: memberId } }) === 1 && await db.membership.count({ where: { userId: memberId, workspaceId: foreignWorkspaceId } }) === 1, 'Removal must retain the account and other workspace access.');
    stage = 'transactional domain audits';
    const audits = await db.$queryRaw<Array<{ action: string; detail: unknown }>>`SELECT action, detail FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND "actorId" = ${actorId} AND action LIKE 'team.member_%' ORDER BY "createdAt"`;
    check(audits.length === 3 && new Set(audits.map(row => row.action)).size === 3, 'Exactly one domain audit must accompany each committed add/update/remove.');
    check(!JSON.stringify(audits).includes(address) && !JSON.stringify(audits).includes(token), 'Domain audits must not contain email or session credentials.');
    console.log('PASS: real HTTP, MCP read/write keys, PostgreSQL grants/audits, denied scope/owner/self changes, current disabled/suspended access, disabled-member removal and unrelated-access retention.');
  } finally {
    stage = `cleanup after ${stage}`;
    await db.mcpApiKey.deleteMany({ where: { id: { in: keyIds } } });
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ANY(${[workspaceId, foreignWorkspaceId]}::text[])`;
    await db.membership.deleteMany({ where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } } });
    await db.target.deleteMany({ where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } } });
    await db.socialAccount.deleteMany({ where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } } });
    await db.workspace.deleteMany({ where: { id: { in: [workspaceId, foreignWorkspaceId] } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    check(await db.user.count({ where: { id: { in: userIds } } }) === 0 && await db.workspace.count({ where: { id: { in: [workspaceId, foreignWorkspaceId] } } }) === 0, 'All disposable identities/workspaces must be removed.');
    await db.$disconnect();
    console.log('Disposable Team fixture cleanup verified. No settings, provider or production changes.');
  }
}
main().catch(error => { console.error(`Team probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : 'unexpected local verification failure (details withheld)'}`); process.exitCode = 1; });
