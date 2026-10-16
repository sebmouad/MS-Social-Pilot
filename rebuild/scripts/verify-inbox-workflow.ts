import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { encryptSecret } from '../src/server/secret-crypto';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }

async function main() {
  const rawDatabase = process.env.DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin, 'Set explicit preview database and origin.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Origin must be explicit localhost HTTP.');
  check(process.env.NODE_ENV !== 'production', 'Workflow probe is refused in production.');
  check(process.env.ENCRYPTION_KEY && Buffer.from(process.env.ENCRYPTION_KEY, 'base64').length === 32, 'A local encryption key is required for the fake preview credential.');

  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_inbox_workflow_${randomUUID()}`;
  const workspaceId = 'preview_workspace';
  const ownerId = 'preview_qa_user';
  const viewerId = `${id}_viewer`;
  const viewerMembershipId = `${id}_viewer_membership`;
  const targetId = `${id}_target`;
  const socialId = `${id}_social`;
  const conversationId = `${id}_conversation`;
  const postId = `${id}_post`;
  const postTargetId = `${id}_post_target`;
  const commentId = `${id}_comment`;
  const keyId = `${id}_key`;
  const ownerSessionId = `${id}_owner_session`;
  const viewerSessionId = `${id}_viewer_session`;
  const ownerToken = randomBytes(32).toString('base64url');
  const viewerToken = randomBytes(32).toString('base64url');
  const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const now = new Date();
  const expired = new Date(now.getTime() - 86_400_000);
  const fakeCredential = encryptSecret(`FAKE_INBOX_WORKFLOW_${randomUUID()}`);
  const cookies = (token: string) => `msp_session=${token}; sp_workspace=${workspaceId}`;
  const httpResolve = async (kind: 'message' | 'comment', itemId: string, resolved: boolean, token = ownerToken) => {
    const response = await fetch(new URL('/api/inbox/actions', origin), {
      method: 'POST', headers: { origin: origin.origin, cookie: cookies(token), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', kind, id: itemId, resolved }), redirect: 'manual',
    });
    let data: Record<string, unknown> = {};
    try { data = await response.json() as Record<string, unknown>; } catch { /* report only the aggregate check below */ }
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', data };
  };
  const rpc = async (name: string, args: unknown) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), {
      method: 'POST', headers: { origin: origin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    let data: Record<string, any> = {};
    try { data = await response.json() as Record<string, any>; } catch { /* report only the aggregate check below */ }
    return { status: response.status, data };
  };
  const state = async (kind: 'message' | 'comment', itemId: string) => kind === 'message'
    ? Boolean((await client.conversation.findUnique({ where: { id: itemId }, select: { resolvedAt: true } }))?.resolvedAt)
    : Boolean((await client.postComment.findUnique({ where: { id: itemId }, select: { resolvedAt: true } }))?.resolvedAt);
  const verifyDomainAudit = async (actorId: string, action: string, itemId: string) => {
    const rows = await client.$queryRaw<Array<{ itemId: string; targetId: string }>>`
      SELECT detail->>'itemId' AS "itemId", detail->>'targetId' AS "targetId"
      FROM root_activities
      WHERE "actorId" = ${actorId} AND action = ${action} AND detail->>'workspaceId' = ${workspaceId}
        AND detail->>'itemId' = ${itemId} AND detail->>'targetId' = ${targetId}`;
    return rows.length > 0 && rows.every(row => row.itemId === itemId && row.targetId === targetId);
  };
  const itemIds = [conversationId, commentId];
  const knownActions = ['inbox.conversation_resolved', 'inbox.conversation_reopened', 'inbox.comment_resolved', 'inbox.comment_reopened', 'mcp.write'];
  let aggregate: Record<string, boolean> = {};

  try {
    const owner = await client.user.findUnique({ where: { id: ownerId }, select: { id: true, disabledAt: true } });
    check(owner && !owner.disabledAt && await client.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }), 'The existing synthetic preview owner and workspace are required.');
    check(!await client.socialAccount.findUnique({ where: { id: socialId } }) && !await client.target.findUnique({ where: { id: targetId } }), 'Disposable fixture IDs must be unused.');

    await client.user.create({ data: { id: viewerId, email: `${id}@example.test`, name: 'Temporary Inbox workflow viewer', passwordHash: 'unusable-test-credential', createdAt: now, updatedAt: now } });
    await client.membership.create({ data: { id: viewerMembershipId, userId: viewerId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${viewerMembershipId}`;
    await client.session.create({ data: { id: ownerSessionId, userId: ownerId, tokenHash: hashLegacySessionToken(ownerToken)!, expiresAt: new Date(Date.now() + 300_000), pending: null } });
    await client.session.create({ data: { id: viewerSessionId, userId: viewerId, tokenHash: hashLegacySessionToken(viewerToken)!, expiresAt: new Date(Date.now() + 300_000), pending: null } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: ownerId, name: 'Temporary Inbox workflow probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['inbox/conversations'], writeFeatures: ['inbox/conversations'], expiresAt: new Date(Date.now() + 300_000) } });

    await client.socialAccount.create({ data: { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${id}_remote_account`, name: 'Expired local Inbox probe', accessToken: fakeCredential, refreshToken: null, tokenExpiresAt: expired, scopes: 'pages_messaging,pages_manage_engagement', invalidatedAt: null, createdAt: now, updatedAt: now } });
    await client.target.create({ data: { id: targetId, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${id}_remote_page`, name: 'Expired local Inbox probe', accessToken: fakeCredential, enabled: true, canPublish: true, createdAt: now, updatedAt: now } });
    await client.conversation.create({ data: { id: conversationId, targetId, remoteId: `${id}_remote_conversation`, snippet: 'Synthetic local workflow', unreadCount: 0, messageCount: 1, participants: [], updatedTime: now, fetchedAt: now } });
    await client.post.create({ data: { id: postId, workspaceId, authorId: ownerId, message: 'Synthetic local Inbox comment parent', firstComment: null, link: null, media: [], status: 'published', scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now } });
    await client.postTarget.create({ data: { id: postTargetId, postId, targetId, status: 'published', remotePostId: `${id}_remote_post` } });
    await client.postComment.create({ data: { id: commentId, postTargetId, remoteId: `${id}_remote_comment`, parentRemoteId: null, message: 'Synthetic local top-level comment', fromName: 'Preview visitor', fromId: `${id}_visitor`, likeCount: 0, replyCount: 0, isHidden: false, createdTime: now, fetchedAt: now, firstSeenAt: now } });

    const httpMessageResolve = await httpResolve('message', conversationId, true);
    check(httpMessageResolve.status === 200 && httpMessageResolve.noStore && await state('message', conversationId), 'HTTP must resolve the stored conversation and return no-store success.');
    const httpMessageResolvedState = await state('message', conversationId);
    const messageResolvedAudit = await verifyDomainAudit(ownerId, 'inbox.conversation_resolved', conversationId);

    const mcpMessageReopen = await rpc('set_inbox_resolved', { kind: 'message', id: conversationId, resolved: false, confirmation: `REOPEN message ${conversationId}` });
    check(mcpMessageReopen.status === 200 && !mcpMessageReopen.data.result?.isError && mcpMessageReopen.data.result?.structuredContent?.resolved === false && !await state('message', conversationId), 'MCP must reopen the same stored conversation with exact confirmation.');
    const mcpMessageReopenedState = await state('message', conversationId);
    const messageReopenedAudit = await verifyDomainAudit(ownerId, 'inbox.conversation_reopened', conversationId);

    const mcpCommentResolve = await rpc('set_inbox_resolved', { kind: 'comment', id: commentId, resolved: true, confirmation: `RESOLVE comment ${commentId}` });
    check(mcpCommentResolve.status === 200 && !mcpCommentResolve.data.result?.isError && mcpCommentResolve.data.result?.structuredContent?.resolved === true && await state('comment', commentId), 'MCP must resolve the stored comment with exact confirmation.');
    const mcpCommentResolvedState = await state('comment', commentId);
    const commentResolvedAudit = await verifyDomainAudit(ownerId, 'inbox.comment_resolved', commentId);

    const httpCommentReopen = await httpResolve('comment', commentId, false);
    check(httpCommentReopen.status === 200 && httpCommentReopen.noStore && !await state('comment', commentId), 'HTTP must reopen the same stored comment and return no-store success.');
    const httpCommentReopenedState = await state('comment', commentId);
    const commentReopenedAudit = await verifyDomainAudit(ownerId, 'inbox.comment_reopened', commentId);

    await client.mcpApiKey.update({ where: { id: keyId }, data: { writeFeatures: [] } });
    const readOnlyDenied = await rpc('set_inbox_resolved', { kind: 'message', id: conversationId, resolved: true, confirmation: `RESOLVE message ${conversationId}` });
    const readOnlyKeyDenied = readOnlyDenied.status === 200 && readOnlyDenied.data.result?.structuredContent?.code === 'forbidden' && !await state('message', conversationId);

    const viewerWriteDenied = await httpResolve('message', conversationId, true, viewerToken);
    const viewerUnassignedDenied = await httpResolve('message', conversationId, false, viewerToken);
    const ownerMissing = await httpResolve('message', `${id}_missing`, true);

    const mcpAudits = await client.$queryRaw<Array<{ tool: string; itemId: string }>>`
      SELECT detail->>'tool' AS "tool", detail->>'itemId' AS "itemId"
      FROM root_activities
      WHERE "actorId" = ${ownerId} AND action = 'mcp.write' AND detail->>'workspaceId' = ${workspaceId}
        AND detail->>'tool' = 'set_inbox_resolved' AND detail->>'itemId' = ANY(${itemIds})`;
    const mcpWriteAuditMatched = mcpAudits.length === 2 && mcpAudits.every(row => row.tool === 'set_inbox_resolved' && itemIds.includes(row.itemId));
    aggregate = {
      httpMessageResolveAndDomainAudit: httpMessageResolve.status === 200 && httpMessageResolve.noStore && httpMessageResolvedState && messageResolvedAudit,
      mcpMessageReopenAndDomainAudit: mcpMessageReopen.status === 200 && !mcpMessageReopenedState && messageReopenedAudit,
      mcpCommentResolveAndDomainAudit: mcpCommentResolve.status === 200 && mcpCommentResolvedState && commentResolvedAudit,
      httpCommentReopenAndDomainAudit: httpCommentReopen.status === 200 && httpCommentReopen.noStore && !httpCommentReopenedState && commentReopenedAudit,
      mcpReceiptsAuditSameItems: mcpWriteAuditMatched,
      readOnlyKeyDenied: readOnlyKeyDenied,
      viewerWriteDenied: viewerWriteDenied.status === 403 && viewerWriteDenied.noStore,
      viewerUnassignedItemDenied: viewerUnassignedDenied.status === 403 && viewerUnassignedDenied.noStore,
      missingItemNotFound: ownerMissing.status === 404 && ownerMissing.noStore,
    };
    check(Object.values(aggregate).every(Boolean), 'One or more Inbox workflow checks failed.');
  } finally {
    await client.$transaction(async tx => {
      await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId" IN (${ownerId}, ${viewerId}) AND action = ANY(${knownActions}) AND detail->>'workspaceId' = ${workspaceId} AND detail->>'itemId' = ANY(${itemIds})`;
      await tx.mcpApiKey.deleteMany({ where: { id: keyId } });
      await tx.session.deleteMany({ where: { id: { in: [ownerSessionId, viewerSessionId] } } });
      await tx.postComment.deleteMany({ where: { id: commentId, postTargetId } });
      await tx.postTarget.deleteMany({ where: { id: postTargetId, postId, targetId } });
      await tx.post.deleteMany({ where: { id: postId, workspaceId, authorId: ownerId } });
      await tx.conversationMessage.deleteMany({ where: { conversationId } });
      await tx.conversation.deleteMany({ where: { id: conversationId, targetId } });
      await tx.target.deleteMany({ where: { id: targetId, workspaceId, socialAccountId: socialId } });
      await tx.socialAccount.deleteMany({ where: { id: socialId, workspaceId } });
      await tx.membership.deleteMany({ where: { id: viewerMembershipId, userId: viewerId, workspaceId } });
      await tx.user.deleteMany({ where: { id: viewerId, email: `${id}@example.test` } });
    });
    const [users, memberships, sessions, keys, socials, targets, conversations, posts, postTargets, comments, audits] = await Promise.all([
      client.user.count({ where: { id: viewerId } }), client.membership.count({ where: { id: viewerMembershipId } }), client.session.count({ where: { id: { in: [ownerSessionId, viewerSessionId] } } }),
      client.mcpApiKey.count({ where: { id: keyId } }), client.socialAccount.count({ where: { id: socialId } }), client.target.count({ where: { id: targetId } }),
      client.conversation.count({ where: { id: conversationId } }), client.post.count({ where: { id: postId } }), client.postTarget.count({ where: { id: postTargetId } }),
      client.postComment.count({ where: { id: commentId } }), client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" IN (${ownerId}, ${viewerId}) AND action = ANY(${knownActions}) AND detail->>'workspaceId' = ${workspaceId} AND detail->>'itemId' = ANY(${itemIds})`,
    ]);
    check([users, memberships, sessions, keys, socials, targets, conversations, posts, postTargets, comments].every(count => count === 0) && Number(audits[0]?.count ?? -1) === 0, 'Disposable Inbox workflow data and matching probe audit rows must be absent after cleanup.');
    if (Object.keys(aggregate).length) { aggregate.cleanupVerified = true; console.log(JSON.stringify(aggregate)); }
    await client.$disconnect();
  }
}

main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected isolated Inbox workflow probe failure.'); process.exitCode = 1; });
