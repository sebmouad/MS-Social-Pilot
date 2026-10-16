import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
async function main() {
  const rawDatabase = process.env.DATABASE_URL; const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production', 'Explicit isolated preview database and origin required.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview databases are accepted.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Explicit localhost HTTP origin required.');
  const client = new PrismaClient(); const id = `preview_publishing_${randomUUID()}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user'; const channelId = 'preview_target_north';
  const userId = `${id}_editor`; const membershipId = `${id}_member`; const sessionId = `${id}_owner_session`;
  const ownerToken = randomBytes(32).toString('base64url'); const writeBearer = `mcp_${randomBytes(32).toString('base64url')}`; const readBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  let previousRoles: string[] | null = null; let postId: string | null = null;
  const rpc = async (name: string, args: unknown, bearer = writeBearer) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', data: await response.json() };
  };
  const roles = async (value: string[]) => {
    const response = await fetch(new URL('/api/root/config', origin), { method: 'PUT', headers: { origin: origin.origin, 'content-type': 'application/json', cookie: `msp_session=${ownerToken}` }, body: JSON.stringify({ key: 'mcp.authenticatedRoles', value }) });
    check(response.ok, 'Audited preview Root role policy write must succeed.');
  };
  const auditCount = async (action: string) => Number((await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${userId} AND action = ${action} AND detail->>'workspaceId' = ${workspaceId}`)[0]?.count ?? 0);
  try {
    check(await client.user.count({ where: { id: ownerId, isInstanceOwner: true, disabledAt: null } }) === 1 && await client.target.count({ where: { id: channelId, workspaceId, enabled: true } }) === 1, 'Synthetic preview owner and channel are required.');
    await client.user.create({ data: { id: userId, email: `${id}@example.test`, name: 'Disposable publishing editor', passwordHash: 'unusable-test-password' } });
    await client.membership.create({ data: { id: membershipId, userId, workspaceId, role: 'editor' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${channelId})`;
    await client.session.create({ data: { id: sessionId, userId: ownerId, tokenHash: hashLegacySessionToken(ownerToken)!, pending: null, expiresAt: new Date(Date.now() + 300000) } });
    for (const [suffix, bearer, writable] of [['write', writeBearer, true], ['read', readBearer, false]] as const) await client.mcpApiKey.create({ data: { id: `${id}_${suffix}_key`, workspaceId, createdById: userId, name: `Disposable Publishing ${suffix} probe`, tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: writable ? ['publishing/posts'] : [], expiresAt: new Date(Date.now() + 300000) } });
    const stored = await client.appSetting.findUnique({ where: { key: 'mcp.authenticatedRoles' } });
    previousRoles = (stored?.value ?? CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.defaultValue) as string[];
    await roles([...new Set([...previousRoles, 'editor'])]);
    const input = { message: `${id} draft`, firstComment: 'Synthetic first comment', targetIds: [channelId], confirmation: 'CREATE POST' };
    const deniedRead = await rpc('create_post', input, readBearer);
    check(deniedRead.data.result?.structuredContent?.code === 'forbidden', 'A read-only key must not create posts.');
    const created = await rpc('create_post', input);
    postId = created.data.result?.structuredContent?.id ?? null;
    check(created.status === 200 && created.noStore && !created.data.result?.isError && postId, 'A scoped create must complete through the service-owned guard.');
    const post = await client.post.findUnique({ where: { id: postId }, include: { targets: true } });
    check(post?.workspaceId === workspaceId && post.authorId === userId && post.firstComment === input.firstComment && post.targets.length === 1 && post.targets[0]?.targetId === channelId && await auditCount('publishing.post_created') === 1, 'Create must retain first comment, scoped destination and domain audit.');
    const update = { postId, message: `${id} revised`, firstComment: 'Revised first comment', targetIds: [channelId], confirmation: `UPDATE POST ${postId}` };
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    check((await rpc('update_post', update)).data.result?.structuredContent?.code === 'forbidden', 'Revoked channel grants must block an existing post update.');
    check((await client.post.findUnique({ where: { id: postId } }))?.message === input.message, 'Denied update must not change data.');
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${channelId})`;
    const updated = await rpc('update_post', update);
    check(!updated.data.result?.isError && (await client.post.findUnique({ where: { id: postId } }))?.firstComment === update.firstComment && await auditCount('publishing.post_updated') === 1, 'Confirmed update must preserve first comments and audit once.');
    const delivery = await client.postTarget.findFirstOrThrow({ where: { postId }, select: { id: true } });
    await client.postTarget.update({ where: { id: delivery.id }, data: { status: 'published', remotePostId: 'preview_probe_remote_post', firstCommentAt: new Date(), firstCommentError: 'synthetic-private-provider-detail' } });
    const outcome = { postId, postTargetId: delivery.id, outcome: 'sent', remoteId: 'preview_probe_remote_comment', confirmation: `RECORD FIRST COMMENT ${delivery.id} SENT` };
    check((await rpc('record_first_comment_outcome', outcome, readBearer)).data.result?.structuredContent?.code === 'forbidden', 'Read-only keys cannot record comment outcomes.');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    check((await rpc('record_first_comment_outcome', outcome)).data.result?.structuredContent?.code === 'forbidden', 'Current channel grants also protect comment reconciliation.');
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${channelId})`;
    check((await rpc('record_first_comment_outcome', { ...outcome, confirmation: 'wrong' })).data.result?.structuredContent?.code === 'invalid_request', 'Comment outcome needs its exact confirmation.');
    const listed = await rpc('list_posts', {});
    check(JSON.stringify(listed.data).includes('needs_review') && !JSON.stringify(listed.data).includes('synthetic-private-provider-detail'), 'MCP exposes safe comment state without legacy provider error strings.');
    const recorded = await rpc('record_first_comment_outcome', outcome);
    check(recorded.data.result?.structuredContent?.state === 'sent' && await auditCount('publishing.first_comment_outcome_recorded') === 1 && (await client.postTarget.findUnique({ where: { id: delivery.id } }))?.firstCommentId === outcome.remoteId, 'Manual comment receipt and audit must commit together.');
    check((await rpc('send_first_comment', { postId, postTargetId: delivery.id, confirmation: `SEND FIRST COMMENT ${delivery.id}` })).data.result?.structuredContent?.state === 'sent' && await auditCount('publishing.first_comment_started') === 0, 'A confirmed comment must not be dispatched again.');
    await client.postTarget.update({ where: { id: delivery.id }, data: { firstCommentId: null, firstCommentAt: new Date(), firstCommentError: 'synthetic uncertain outcome' } });
    const absent = await rpc('record_first_comment_outcome', { postId, postTargetId: delivery.id, outcome: 'not_sent', confirmation: `RECORD FIRST COMMENT ${delivery.id} NOT SENT` });
    const cleared = await client.postTarget.findUnique({ where: { id: delivery.id } });
    check(absent.data.result?.structuredContent?.state === 'ready' && !cleared?.firstCommentAt && !cleared?.firstCommentError && await auditCount('publishing.first_comment_outcome_recorded') === 2, 'Manual absence permits a separate later send without dispatching now.');
    await client.postTarget.update({ where: { id: delivery.id }, data: { status: 'pending', remotePostId: null } });
    await client.$executeRaw`UPDATE memberships SET "disabledModules" = ARRAY['publishing/posts']::TEXT[] WHERE id = ${membershipId}`;
    check((await rpc('update_post', update)).data.result?.structuredContent?.code === 'forbidden', 'Current module/feature permissions must apply immediately.');
    await client.$executeRaw`UPDATE memberships SET "disabledModules" = ARRAY[]::TEXT[] WHERE id = ${membershipId}`;
    await client.postTarget.updateMany({ where: { postId }, data: { status: 'processing' } });
    const remove = { postId, deleteRemote: false, confirmation: `DELETE POST ${postId} LOCAL` };
    check((await rpc('delete_post', remove)).data.result?.structuredContent?.code === 'conflict' && await client.post.count({ where: { id: postId } }) === 1, 'Uncertain processing evidence must survive local delete attempts.');
    await client.postTarget.updateMany({ where: { postId }, data: { status: 'pending' } });
    const deleted = await rpc('delete_post', remove);
    check(!deleted.data.result?.isError && await client.post.count({ where: { id: postId } }) === 0 && await auditCount('publishing.post_deleted') === 1, 'Local deletion must finish once with its domain audit.');
    const root = await rpc('get_root_config', {});
    check(root.data.result?.structuredContent?.code === 'forbidden', 'Workspace bearer must not gain Root access.');
    console.log(JSON.stringify({ scopedCreateAndFirstComment: true, readOnlyDenied: true, currentGrantRevocation: true, scopedUpdateAndAudit: true, firstCommentScopedReconciliation: true, safeFirstCommentReads: true, firstCommentExactConfirmation: true, confirmedCommentNoRepeat: true, manualAbsenceNoDispatch: true, featureRevocation: true, processingDeletionDenied: true, confirmedLocalDeletion: true, rootIsolation: true, noStore: true }));
  } finally {
    try {
      if (previousRoles) await roles(previousRoles);
      await client.$transaction(async tx => {
        await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' = ${workspaceId}`;
        await tx.postTarget.deleteMany({ where: { post: { authorId: userId, workspaceId } } }); await tx.post.deleteMany({ where: { authorId: userId, workspaceId } });
        await tx.mcpApiKey.deleteMany({ where: { createdById: userId } }); await tx.session.deleteMany({ where: { id: sessionId } });
        await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
        await tx.membership.deleteMany({ where: { id: membershipId } }); await tx.user.deleteMany({ where: { id: userId } });
      });
      const counts = await Promise.all([client.user.count({ where: { id: userId } }), client.membership.count({ where: { id: membershipId } }), client.post.count({ where: { authorId: userId } }), client.mcpApiKey.count({ where: { createdById: userId } }), client.session.count({ where: { id: sessionId } }), auditCount('mcp.write')]);
      check(counts.every(value => value === 0), 'Disposable Publishing fixture cleanup must be verified.');
      console.log('Publishing probe cleanup and original role policy restoration verified; no provider operation dispatched.');
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected guarded Publishing probe failure.'); process.exitCode = 1; });
