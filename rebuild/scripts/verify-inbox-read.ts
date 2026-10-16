import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin, 'Set explicit preview database and origin.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Origin must be explicit localhost HTTP.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_inbox_http_${randomUUID()}`;
  const membershipId = `${id}_membership`; const keyId = `${id}_key`;
  const userId = `${id}_viewer`; const workspaceId = 'preview_workspace';
  const viewerToken = randomBytes(32).toString('base64url'); const ownerToken = randomBytes(32).toString('base64url');
  const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const cookies = (token: string) => `msp_session=${token}; sp_workspace=${workspaceId}`;
  const get = (path: string, token = viewerToken) => fetch(new URL(path, origin), { headers: { cookie: cookies(token) }, redirect: 'manual' });
  const rpc = async (name: string, args: unknown) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), { method: 'POST', headers: { origin: origin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const owner = await client.user.findUnique({ where: { id: 'preview_qa_user' }, select: { id: true, disabledAt: true } });
    check(owner && !owner.disabledAt && await client.target.count({ where: { id: { in: ['preview_target_north', 'preview_target_studio'] }, workspaceId, enabled: true } }) === 2 && await client.conversation.count({ where: { id: 'preview_workspace_conversation_history' } }) === 1, 'Seeded synthetic Inbox browsing fixtures are required.');
    await client.user.create({ data: { id: userId, email: `${id}@example.test`, name: 'Temporary scoped Inbox reader', passwordHash: 'unusable-test-credential' } });
    await client.membership.create({ data: { id: membershipId, userId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, 'preview_target_north')`;
    // Verified session fixtures exercise request authorization; password/TOTP login is covered by verify-installation-mcp.ts.
    for (const [suffix, sessionUser, token] of [['viewer', userId, viewerToken], ['owner', owner.id, ownerToken]]) await client.session.create({ data: { id: `${id}_${suffix}_session`, userId: sessionUser, tokenHash: hashLegacySessionToken(token)!, pending: null, expiresAt: new Date(Date.now() + 300000) } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: owner.id, name: 'Temporary Inbox read-only probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['inbox/conversations'], writeFeatures: [], expiresAt: new Date(Date.now() + 300000) } });
    const scoped = await get('/api/inbox?limit=1'); const scopedData = await scoped.json();
    check(scoped.ok && scoped.headers.get('cache-control') === 'no-store' && scopedData.items.length === 1 && scopedData.items.every((item: { target: { id: string } }) => item.target.id === 'preview_target_north'), 'Viewer list must use actual current channel grants.');
    check((await get('/api/inbox?channel=preview_target_studio')).status === 403, 'Forged channel filter must be refused.');
    check((await get('/api/inbox/threads/message:preview_workspace_conversation_history')).status === 404, 'Unassigned thread must not be read.');
    check((await get('/api/inbox/threads/message:preview_conversation_open')).ok, 'Assigned thread history must be readable.');
    const ui = await get('/inbox?limit=1'); check(ui.ok && (await ui.text()).includes('stored matches'), 'Read-only channel-scoped member must reach the actual Inbox UI.');
    const ownerList = await (await get('/api/inbox?limit=1', ownerToken)).json();
    const mcpList = await rpc('list_inbox', { limit: 1 });
    check(mcpList.status === 200 && !mcpList.body.result.isError && JSON.stringify(mcpList.body.result.structuredContent.items.map((item: { key: string }) => item.key)) === JSON.stringify(ownerList.items.map((item: { key: string }) => item.key)) && mcpList.body.result.structuredContent.olderCursor === ownerList.olderCursor, 'Bearer MCP and owner HTTP must share list ordering and cursor.');
    const key = 'message:preview_workspace_conversation_history';
    const httpThread = await (await get(`/api/inbox/threads/${encodeURIComponent(key)}?limit=2`, ownerToken)).json();
    const mcpThread = await rpc('get_inbox_thread', { key, limit: 2 });
    check(!mcpThread.body.result.isError && httpThread.history.total === 54 && JSON.stringify(mcpThread.body.result.structuredContent.thread.entries.map((entry: { id: string }) => entry.id)) === JSON.stringify(httpThread.thread.entries.map((entry: { id: string }) => entry.id)), 'HTTP/MCP must return matching newest stored thread history.');
    const earlier = await (await get(`/api/inbox/threads/${encodeURIComponent(key)}?limit=2&cursor=${encodeURIComponent(httpThread.history.olderCursor)}`, ownerToken)).json();
    check(earlier.thread.entries[0].id !== httpThread.thread.entries[0].id && earlier.history.newerCursor, 'Older history must be reachable with a return cursor.');
    for (const name of ['reply_to_inbox', 'set_inbox_resolved', 'get_root_config']) check((await rpc(name, { kind: 'message', id: 'preview_conversation_open', text: 'must not send', confirmation: 'REPLY message preview_conversation_open' })).body.result.structuredContent.code === 'forbidden', 'Read-only Inbox key must not write or gain Root access.');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    check((await (await get('/api/inbox')).json()).total === 0 && (await get('/api/inbox/threads/message:preview_conversation_open')).status === 404, 'Revoked channel grant must apply immediately.');
    await client.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    check((await get('/api/inbox')).status === 401, 'Disabled session account must be refused.');
    await client.mcpApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    check((await rpc('list_inbox', {})).status === 401, 'Revoked bearer must be refused.');
    console.log(JSON.stringify({ scopedMemberUiHttp: true, forgedChannelAndThreadDenied: true, httpMcpListAndHistoryParity: true, earlierHistory: true, readOnlyKeyAndRootIsolation: true, grantRevocationImmediate: true, disabledUserAndRevokedKeyDenied: true }));
  } finally {
    try {
      await client.$transaction(async tx => {
        await tx.mcpApiKey.deleteMany({ where: { id: keyId } });
        await tx.session.deleteMany({ where: { id: { in: [`${id}_viewer_session`, `${id}_owner_session`] } } });
        await tx.membership.deleteMany({ where: { id: membershipId } });
        await tx.user.deleteMany({ where: { id: userId } });
      });
      check(await client.user.count({ where: { id: userId } }) === 0 && await client.session.count({ where: { id: { startsWith: id } } }) === 0 && await client.mcpApiKey.count({ where: { id: keyId } }) === 0 && await client.membership.count({ where: { id: membershipId } }) === 0, 'Disposable Inbox authorization records must be removed.');
      console.log('Inbox read probe cleanup verified; synthetic browsing example retained.');
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected isolated Inbox read probe failure.'); process.exitCode = 1; });
