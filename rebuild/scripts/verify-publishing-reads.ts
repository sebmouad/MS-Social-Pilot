import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
const json = async (response: Response) => response.json();
const postIds = (posts: Array<{ id: string }>) => posts.map(post => post.id);

async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production', 'Explicit isolated preview database and origin required.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(process.env.DATABASE_URL === rawDatabase, 'Prisma DATABASE_URL must exactly match the guarded preview database.');
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost' && origin.port === '3200', 'Origin must be the explicit local preview at localhost:3200.');

  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_publishing_reads_${randomUUID()}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user';
  const userId = `${id}_viewer`; const membershipId = `${id}_membership`; const sessionId = `${id}_session`; const keyId = `${id}_read_key`;
  const draftId = `${id}_draft`; const northPostId = `${id}_north_post`; const unselectedPostId = `${id}_unselected_post`;
  const northPostTargetId = `${id}_north_post_target`; const unselectedPostTargetId = `${id}_unselected_post_target`;
  const sessionToken = randomBytes(32).toString('base64url'); const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const expiresAt = new Date(Date.now() + 300_000); const now = new Date();
  let oldRoleSetting: { value: unknown; encrypted: boolean; updatedAt: Date } | null = null;
  let changedRoleSetting = false;
  const get = (path: string) => fetch(new URL(path, origin), { headers: { cookie }, redirect: 'manual' });
  const rpc = async (method: string, params: object) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), {
      method: 'POST', headers: { origin: origin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), redirect: 'manual',
    });
    return { response, body: await json(response) };
  };
  const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args });
  const workspaceRpc = (method: string, params: object) => rpc(method, params);

  try {
    const owner = await client.user.findUnique({ where: { id: ownerId }, select: { id: true, isInstanceOwner: true, disabledAt: true } });
    check(owner?.isInstanceOwner && !owner.disabledAt, 'Synthetic preview owner is required.');
    const channels = await client.target.findMany({ where: { id: { in: ['preview_target_north', 'preview_target_studio', 'preview_target_unselected'] }, workspaceId }, select: { id: true, enabled: true } });
    check(channels.some(target => target.id === 'preview_target_north' && target.enabled)
      && channels.some(target => target.id === 'preview_target_studio')
      && channels.some(target => target.id === 'preview_target_unselected'), 'Synthetic North, Studio, and unselected destinations are required.');
    const mixedSeed = await client.post.findFirst({ where: { workspaceId, status: 'published', AND: [
      { targets: { some: { targetId: 'preview_target_north' } } }, { targets: { some: { targetId: 'preview_target_studio' } } },
    ] }, select: { id: true } });
    check(mixedSeed, 'The seeded North and Studio mixed-destination publication is required.');
    check(!await client.user.findUnique({ where: { id: userId } }), 'Disposable viewer identity must be unused.');

    await client.user.create({ data: { id: userId, email: `${id}@example.test`, name: 'Disposable scoped Publishing reader', passwordHash: 'unusable-probe-credential' } });
    await client.membership.create({ data: { id: membershipId, userId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, 'preview_target_north')`;
    await client.session.create({ data: { id: sessionId, userId, tokenHash: hashSessionToken(sessionToken)!, pending: null, expiresAt } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Temporary Publishing read probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: [], expiresAt } });
    await client.post.create({ data: {
      id: draftId, workspaceId, authorId: userId, message: `${id} unconnected draft`, status: 'draft', firstComment: null, media: [],
      scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
    } });
    await client.post.create({ data: {
      id: northPostId, workspaceId, authorId: userId, message: `${id} selected North publication`, status: 'published', firstComment: null, media: [],
      scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now,
      targets: { create: { id: northPostTargetId, targetId: 'preview_target_north', status: 'published', remotePostId: `${id}_synthetic_remote` } },
    } });
    await client.post.create({ data: {
      id: unselectedPostId, workspaceId, authorId: userId, message: `${id} unselected destination publication`, status: 'published', firstComment: null, media: [],
      scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now,
      targets: { create: { id: unselectedPostTargetId, targetId: 'preview_target_unselected', status: 'published', remotePostId: `${id}_unselected_remote` } },
    } });

    const roleRow = await client.appSetting.findUnique({ where: { key: 'mcp.authenticatedRoles' }, select: { value: true, encrypted: true, updatedAt: true } });
    oldRoleSetting = roleRow;
    const configuredRoles = (roleRow?.value ?? CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.defaultValue) as string[];
    if (!configuredRoles.includes('viewer')) {
      const deniedByDefault = await call('list_posts', {});
      check(deniedByDefault.response.status === 401 && deniedByDefault.response.headers.get('cache-control') === 'no-store', 'Viewer MCP role must be denied by the original policy before the temporary test grant.');
      const testRoles = [...new Set([...configuredRoles, 'viewer'])];
      await client.appSetting.upsert({ where: { key: 'mcp.authenticatedRoles' },
        create: { key: 'mcp.authenticatedRoles', value: testRoles, encrypted: false, updatedAt: new Date() },
        update: { value: testRoles, encrypted: false, updatedAt: new Date() } });
      changedRoleSetting = true;
    }

    const httpResponse = await get('/api/publishing/posts'); const httpData = await json(httpResponse);
    check(httpResponse.ok && httpResponse.headers.get('cache-control') === 'no-store', 'Scoped HTTP Posts read must succeed without caching.');
    const httpPosts = httpData.posts as Array<{ id: string; authorId: string; status: string; targets: Array<{ target: { id: string } }> }>;
    check(httpPosts.some(post => post.id === draftId) && httpPosts.some(post => post.id === northPostId), 'HTTP must include the viewer draft and selected North publication.');
    check(!httpPosts.some(post => [unselectedPostId, mixedSeed.id].includes(post.id)), 'HTTP must exclude unselected and whole mixed-destination posts.');
    check(httpPosts.every(post => post.targets.length === 0
      ? post.authorId === userId && post.status === 'draft'
      : post.targets.every(target => target.target.id === 'preview_target_north')), 'HTTP results must contain only the viewer-owned draft and posts wholly scoped to North.');

    const mcpList = await call('list_posts', {});
    check(mcpList.response.status === 200 && mcpList.response.headers.get('cache-control') === 'no-store' && !mcpList.body.result?.isError, 'Read-only MCP list_posts must succeed without caching.');
    const mcpPosts = mcpList.body.result.structuredContent.items as typeof httpPosts;
    check(mcpPosts.some(post => post.id === draftId) && mcpPosts.some(post => post.id === northPostId)
      && !mcpPosts.some(post => [unselectedPostId, mixedSeed.id].includes(post.id)), 'MCP list_posts must apply the same scoped visibility.');

    const resourceRead = await workspaceRpc('resources/read', { uri: 'msp://posts' });
    check(resourceRead.response.status === 200 && resourceRead.response.headers.get('cache-control') === 'no-store', 'Posts MCP resource must succeed without caching.');
    const resourcePosts = JSON.parse(resourceRead.body.result.contents[0].text) as typeof httpPosts;
    check(resourcePosts.some(post => post.id === draftId) && resourcePosts.some(post => post.id === northPostId)
      && !resourcePosts.some(post => [unselectedPostId, mixedSeed.id].includes(post.id)), 'Posts MCP resource must apply the same scoped visibility.');

    const malformedHttp = await Promise.all(['/api/publishing/posts?extra=1', '/api/publishing/posts?page=0', '/api/publishing/posts?from=2026-02-30'].map(get));
    check(malformedHttp.every(response => response.status === 400 && response.headers.get('cache-control') === 'no-store'), 'HTTP must reject unknown fields, invalid page, and unsupported date fields without caching.');
    const forgedChannel = await get('/api/publishing/posts?channel=preview_target_studio');
    const forgedData = await json(forgedChannel);
    check(forgedChannel.status === 200 && forgedChannel.headers.get('cache-control') === 'no-store'
      && forgedData.channelUnavailable === true && forgedData.posts.length === 0, 'HTTP must safely return no matches for an unassigned channel filter.');
    const badMcpDate = await call('list_posts', { from: '2026-02-30' });
    const badMcpField = await call('list_posts', { unexpected: true });
    check(badMcpDate.response.status === 200 && badMcpDate.response.headers.get('cache-control') === 'no-store'
      && badMcpDate.body.result?.isError && badMcpDate.body.result.structuredContent.code === 'invalid_request'
      && badMcpField.body.result?.isError && badMcpField.body.result.structuredContent.code === 'invalid_request', 'MCP must reject invalid dates and unknown list fields safely.');
    const deleteAttempt = await call('delete_post', { postId: northPostId, deleteRemote: false, confirmation: `DELETE POST ${northPostId} LOCAL` });
    check(deleteAttempt.body.result?.isError && deleteAttempt.body.result.structuredContent.code === 'forbidden'
      && await client.post.count({ where: { id: northPostId } }) === 1, 'Read-only key must not delete posts.');

    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    const revokedAccess = await get('/api/publishing/posts'); const revokedData = await json(revokedAccess);
    check(revokedAccess.ok && revokedData.posts.every((post: { targets: Array<{ target: { id: string } }> }) => post.targets.length === 0), 'Revoking the North grant must immediately remove connected North posts.');
    await client.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    const disabledHttp = await get('/api/publishing/posts'); const disabledKey = await call('list_posts', {});
    check(disabledHttp.status === 401 && disabledHttp.headers.get('cache-control') === 'no-store'
      && disabledKey.response.status === 401 && disabledKey.response.headers.get('cache-control') === 'no-store', 'Disabling the viewer must immediately deny the same session and bearer key.');

    console.log(JSON.stringify({ originalViewerRoleDenied: !configuredRoles.includes('viewer'),
      httpScopedPosts: true, mcpListPostsScoped: true, mcpResourceScoped: true, httpNoStoreAndValidation: true, mcpValidation: true,
      readKeyCannotDelete: true, grantRevocationImmediate: true, disabledSessionAndKeyDenied: true, realProviderDispatch: false }));
  } finally {
    try {
      let cleanupFailed = false;
      try {
        await client.$transaction(async tx => {
          await tx.postTarget.deleteMany({ where: { postId: { in: [draftId, northPostId, unselectedPostId] } } });
          await tx.post.deleteMany({ where: { id: { in: [draftId, northPostId, unselectedPostId] }, workspaceId, authorId: userId } });
          await tx.mcpApiKey.deleteMany({ where: { id: keyId } });
          await tx.session.deleteMany({ where: { id: sessionId } });
          await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
          await tx.membership.deleteMany({ where: { id: membershipId } });
          await tx.user.deleteMany({ where: { id: userId } });
        });
      } catch { cleanupFailed = true; }
      try {
        if (changedRoleSetting) {
          if (oldRoleSetting) await client.appSetting.update({ where: { key: 'mcp.authenticatedRoles' }, data: { value: oldRoleSetting.value as Prisma.InputJsonValue, encrypted: oldRoleSetting.encrypted, updatedAt: oldRoleSetting.updatedAt } });
          else await client.appSetting.deleteMany({ where: { key: 'mcp.authenticatedRoles' } });
        }
      } catch { cleanupFailed = true; }
      check(await client.user.count({ where: { id: userId } }) === 0
        && await client.membership.count({ where: { id: membershipId } }) === 0
        && await client.session.count({ where: { id: sessionId } }) === 0
        && await client.mcpApiKey.count({ where: { id: keyId } }) === 0
        && await client.post.count({ where: { id: { in: [draftId, northPostId, unselectedPostId] } } }) === 0,
      'Disposable Publishing HTTP/MCP fixtures must be removed and verified.');
      const restored = await client.appSetting.findUnique({ where: { key: 'mcp.authenticatedRoles' }, select: { value: true, encrypted: true, updatedAt: true } });
      check(JSON.stringify(restored) === JSON.stringify(oldRoleSetting), 'Original MCP role policy must be restored exactly.');
      check(!cleanupFailed, 'Fixture and MCP role policy cleanup must complete.');
      console.log(JSON.stringify({ fixturesCleaned: true, rolePolicyRestored: true }));
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Publishing HTTP/MCP read probe failed; inspect isolated preview logs without displaying credentials.'); process.exitCode = 1; });
