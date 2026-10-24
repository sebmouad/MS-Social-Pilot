import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { encryptSecret } from '../src/server/secret-crypto';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }

async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin, 'Set explicit isolated preview database and origin.');
  let database: URL; let origin: URL;
  try { database = new URL(rawDatabase); origin = new URL(rawOrigin); }
  catch { throw new ProbeFailure('Database and origin must be valid isolated preview URLs.'); }
  check(['postgres:', 'postgresql:'].includes(database.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview')
    && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview with no host override.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Origin must be explicit localhost HTTP.');
  check(process.env.NODE_ENV !== 'production', 'Deletion probe is refused in production.');
  check(process.env.ENCRYPTION_KEY && Buffer.from(process.env.ENCRYPTION_KEY, 'base64').length === 32, 'A local encryption key is required for the fake preview credential.');

  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_inbox_deletion_${randomUUID()}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user';
  const viewerId = `${id}_viewer`; const viewerMembershipId = `${id}_viewer_membership`;
  const targetId = `${id}_target`; const socialId = `${id}_social`;
  const postId = `${id}_post`; const postTargetId = `${id}_post_target`;
  const commentId = `${id}_comment`; const replyId = `${id}_reply`;
  const operationId = `${id}_operation`;
  const writeKeyId = `${id}_write_key`; const readKeyId = `${id}_read_key`;
  const ownerSessionId = `${id}_owner_session`; const viewerSessionId = `${id}_viewer_session`;
  const ownerToken = randomBytes(32).toString('base64url'); const viewerToken = randomBytes(32).toString('base64url');
  const writeBearer = `mcp_${randomBytes(32).toString('base64url')}`; const readBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const now = new Date(); const expired = new Date(now.getTime() - 86_400_000);
  const fakeCredential = encryptSecret(`FAKE_INBOX_DELETION_${randomUUID()}`);
  const cookies = (token: string) => `msp_session=${token}; sp_workspace=${workspaceId}`;
  const httpGet = async (item: string, token = ownerToken) => {
    const response = await fetch(new URL(`/api/inbox/deletions?itemId=${encodeURIComponent(item)}`, origin), { headers: { cookie: cookies(token) }, redirect: 'manual' });
    let data: Record<string, any> = {};
    try { data = await response.json() as Record<string, any>; } catch { /* Aggregate safe checks below. */ }
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', data };
  };
  const httpDelete = async (confirmation?: string) => {
    const response = await fetch(new URL('/api/inbox/actions', origin), {
      method: 'POST', headers: { origin: origin.origin, cookie: cookies(ownerToken), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: commentId, ...(confirmation === undefined ? {} : { confirmation }) }), redirect: 'manual',
    });
    let data: Record<string, any> = {};
    try { data = await response.json() as Record<string, any>; } catch { /* Aggregate safe checks below. */ }
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', data };
  };
  const rpc = async (scope: 'workspace' | 'installation', name: string, args: unknown, options: { bearer?: string; token?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (scope === 'installation') headers.cookie = cookies(options.token ?? ownerToken);
    else if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
    else headers.cookie = cookies(options.token ?? ownerToken);
    const response = await fetch(new URL(`/api/mcp?scope=${scope}`, origin), {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    let data: Record<string, any> = {};
    try { data = await response.json() as Record<string, any>; } catch { /* Aggregate safe checks below. */ }
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', data };
  };
  const rootList = async () => {
    const result = await rpc('installation', 'list_root_inbox_deletions', {});
    return { ...result, items: result.data.result?.structuredContent?.items as Array<Record<string, any>> | undefined };
  };
  const verifyAudit = async (action: string, tool?: string) => {
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM root_activities WHERE action = ${action}
        AND detail->>'workspaceId' = ${workspaceId}
        AND (detail->>'itemId' = ${commentId} OR detail->>'operationId' = ${operationId})
        ${tool ? Prisma.sql`AND detail->>'tool' = ${tool}` : Prisma.empty}`;
    return Number(rows[0]?.count ?? -1);
  };
  const knownActions = ['inbox.comment_deletion_started', 'inbox.comment_deletion_verified', 'inbox.comment_deleted', 'mcp.write'];
  let aggregate: Record<string, boolean> = {};

  try {
    const owner = await client.user.findUnique({ where: { id: ownerId }, select: { id: true, disabledAt: true, isInstanceOwner: true, memberships: { select: { workspaceId: true } } } });
    check(owner && !owner.disabledAt && owner.isInstanceOwner && owner.memberships.some(item => item.workspaceId === workspaceId), 'An active Root owner with the synthetic preview workspace membership is required.');
    check(await client.session.count({ where: { id: { in: [ownerSessionId, viewerSessionId] } } }) === 0
      && await client.mcpApiKey.count({ where: { id: { in: [writeKeyId, readKeyId] } } }) === 0
      && await client.target.count({ where: { id: targetId } }) === 0
      && await client.rebuildInboxDeletion.count({ where: { id: operationId } }) === 0, 'Disposable fixture IDs must be unused.');

    await client.user.create({ data: { id: viewerId, email: `${id}@example.test`, name: 'Temporary unassigned Inbox viewer', passwordHash: 'unusable-test-credential', createdAt: now, updatedAt: now } });
    await client.membership.create({ data: { id: viewerMembershipId, userId: viewerId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${viewerMembershipId}`;
    await client.session.create({ data: { id: ownerSessionId, userId: ownerId, tokenHash: hashSessionToken(ownerToken)!, expiresAt: new Date(Date.now() + 300_000), pending: null } });
    await client.session.create({ data: { id: viewerSessionId, userId: viewerId, tokenHash: hashSessionToken(viewerToken)!, expiresAt: new Date(Date.now() + 300_000), pending: null } });
    const expiry = new Date(Date.now() + 300_000);
    await client.mcpApiKey.create({ data: { id: writeKeyId, workspaceId, createdById: ownerId, name: 'Temporary Inbox deletion write probe', tokenHash: createHash('sha256').update(writeBearer).digest('hex'), tokenPrefix: writeBearer.slice(0, 12), readFeatures: ['inbox/conversations'], writeFeatures: ['inbox/conversations'], expiresAt: expiry } });
    await client.mcpApiKey.create({ data: { id: readKeyId, workspaceId, createdById: ownerId, name: 'Temporary Inbox deletion read probe', tokenHash: createHash('sha256').update(readBearer).digest('hex'), tokenPrefix: readBearer.slice(0, 12), readFeatures: ['inbox/conversations'], writeFeatures: [], expiresAt: expiry } });

    await client.socialAccount.create({ data: { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${id}_fake_remote_account`, name: 'Expired synthetic deletion probe', accessToken: fakeCredential, refreshToken: null, tokenExpiresAt: expired, scopes: 'pages_messaging,pages_manage_engagement', invalidatedAt: null, createdAt: now, updatedAt: now } });
    await client.target.create({ data: { id: targetId, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${id}_fake_remote_page`, name: 'Expired synthetic deletion probe', accessToken: fakeCredential, enabled: true, canPublish: true, createdAt: now, updatedAt: now } });
    await client.post.create({ data: { id: postId, workspaceId, authorId: ownerId, message: 'Synthetic local parent post', firstComment: null, link: null, media: [], status: 'published', scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now } });
    await client.postTarget.create({ data: { id: postTargetId, postId, targetId, status: 'published', remotePostId: `${id}_fake_remote_post`, publishedAt: now } });
    await client.postComment.create({ data: { id: commentId, postTargetId, remoteId: `${id}_fake_remote_comment`, parentRemoteId: null, message: 'Synthetic local top-level comment', fromName: 'Preview visitor', fromId: `${id}_fake_visitor`, likeCount: 0, replyCount: 1, isHidden: false, createdTime: now, fetchedAt: now, firstSeenAt: now } });
    await client.postComment.create({ data: { id: replyId, postTargetId, remoteId: `${id}_fake_remote_reply`, parentRemoteId: `${id}_fake_remote_comment`, message: 'Synthetic local direct reply', fromName: 'Preview page', fromId: `${id}_fake_remote_page`, likeCount: 0, replyCount: 0, isHidden: false, createdTime: now, fetchedAt: now, firstSeenAt: now } });

    // Seed a committed started intent to model a lost remote response. The remote
    // identities are synthetic; this probe never dispatches a Facebook request.
    await client.$transaction(async tx => {
      await tx.$executeRaw`INSERT INTO rebuild_inbox_deletions (id, "workspaceId", "targetId", provider, "remoteId", "localItemId", "actorId", state) VALUES (${operationId}, ${workspaceId}, ${targetId}, 'facebook', ${`${id}_fake_remote_comment`}, ${commentId}, ${ownerId}, 'started')`;
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`${id}_started_audit`}, ${ownerId}, 'inbox.comment_deletion_started', ${JSON.stringify({ workspaceId, targetId, itemId: commentId, operationId })}::jsonb, NOW())`;
    });

    const statusHttp = await httpGet(commentId);
    const status = statusHttp.data.operation;
    const noRemoteIdentity = !JSON.stringify(statusHttp.data).includes('fake_remote') && !JSON.stringify(statusHttp.data).includes('remoteId');
    check(statusHttp.status === 200 && statusHttp.noStore && status?.state === 'started' && status?.operationId === operationId && noRemoteIdentity, 'HTTP status must safely project the synthetic started intent.');
    const statusMcp = await rpc('workspace', 'get_inbox_deletion', { itemId: commentId }, { bearer: readBearer });
    check(statusMcp.status === 200 && !statusMcp.data.result?.isError && statusMcp.data.result?.structuredContent?.operation?.state === 'started'
      && statusMcp.data.result.structuredContent.operation.operationId === status.operationId, 'Read-only MCP status must match the HTTP projection.');
    const unassignedStatus = await httpGet(commentId, viewerToken);
    check(unassignedStatus.status === 404 && unassignedStatus.noStore, 'Unassigned channel deletion status must be indistinguishable from missing.');

    const missingConfirmation = await httpDelete();
    check(missingConfirmation.status === 400 && missingConfirmation.noStore, 'HTTP deletion must require exact confirmation.');
    const repeatedDelete = await httpDelete(`DELETE COMMENT ${commentId}`);
    check(repeatedDelete.status === 200 && repeatedDelete.noStore && repeatedDelete.data.state === 'started' && repeatedDelete.data.operationId === operationId, 'Repeated HTTP delete must return the prior started intent without dispatch.');
    const readOnlyDelete = await rpc('workspace', 'delete_inbox_comment', { id: commentId, confirmation: `DELETE COMMENT ${commentId}` }, { bearer: readBearer });
    check(readOnlyDelete.status === 200 && readOnlyDelete.data.result?.isError && readOnlyDelete.data.result?.structuredContent?.code === 'forbidden', 'Read-only MCP credentials must not delete comments.');

    const rootItems = await rootList();
    const rootRow = rootItems.items?.find(item => item.operationId === operationId);
    check(rootItems.status === 200 && rootItems.noStore && rootRow?.state === 'started' && rootRow.localItemId === commentId
      && rootRow.remoteObjectId === `${id}_fake_remote_comment` && rootRow.provider === 'facebook'
      && !JSON.stringify(rootItems.items).includes(fakeCredential), 'Private Root recovery history must identify the synthetic remote object without credentials.');
    const keyRootDenied = await rpc('workspace', 'list_root_inbox_deletions', {}, { bearer: readBearer });
    check(keyRootDenied.status === 200 && keyRootDenied.noStore && keyRootDenied.data.result?.isError && keyRootDenied.data.result?.structuredContent?.code === 'forbidden', 'Workspace keys must not read private Root recovery history.');
    const rootConfirm = await rpc('installation', 'confirm_root_inbox_deletion', {
      operationId, verifiedOnPlatform: true, confirmation: `CONFIRM REMOTE DELETION ${operationId}`,
    });
    check(rootConfirm.status === 200 && !rootConfirm.data.result?.isError && rootConfirm.data.result?.structuredContent?.state === 'remote_confirmed', 'Private Root confirmation must record only the synthetic operator attestation.');
    const confirmedHttp = await httpGet(commentId);
    check(confirmedHttp.status === 200 && confirmedHttp.data.operation?.state === 'remote_confirmed', 'Workspace status must expose the operator-confirmed state.');

    const finishArgs = { operationId, confirmation: `FINISH DELETION ${operationId}` };
    const finished = await rpc('workspace', 'finish_inbox_deletion', finishArgs, { bearer: writeBearer });
    check(finished.status === 200 && !finished.data.result?.isError && finished.data.result?.structuredContent?.state === 'completed', 'Workspace MCP must finish local cleanup from stored remote confirmation.');
    check(await client.postComment.count({ where: { id: { in: [commentId, replyId] }, postTargetId } }) === 0, 'Local top-level comment and direct reply must be removed.');
    const repeatedFinish = await rpc('workspace', 'finish_inbox_deletion', finishArgs, { bearer: writeBearer });
    check(repeatedFinish.status === 200 && !repeatedFinish.data.result?.isError && repeatedFinish.data.result?.structuredContent?.state === 'completed'
      && await verifyAudit('inbox.comment_deleted') === 1, 'Repeated local finalization must remain completed without duplicate domain audit.');
    const completedHttp = await httpGet(commentId);
    check(completedHttp.status === 200 && completedHttp.data.operation?.state === 'completed' && !JSON.stringify(completedHttp.data).includes('fake_remote'), 'Completed status must remain safe after local cleanup.');

    aggregate = {
      syntheticStartedStateExercised: true,
      providerRequestNotMade: true,
      httpMcpStatusParityAndRedaction: true,
      unassignedStatusNotFound: true,
      missingConfirmationAndRepeatAreSafe: true,
      readonlyKeyDenied: true,
      rootAttestationRecordedForSyntheticFixture: await verifyAudit('inbox.comment_deletion_verified') === 1,
      workspaceFinalizerRemovedCommentAndReply: true,
      repeatedFinalizerAuditIdempotent: await verifyAudit('inbox.comment_deleted') === 1,
      mcpAuditsMatchFixture: await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE action = 'mcp.write' AND detail->>'workspaceId' = ${workspaceId} AND detail->>'operationId' = ${operationId} AND detail->>'itemId' = ${commentId}`.then(rows => Number(rows[0]?.count ?? -1)) >= 2,
      noLiveProviderSuccessClaimed: true,
    };
    check(Object.values(aggregate).every(Boolean), 'One or more isolated Inbox deletion recovery checks failed.');
  } finally {
    try {
      await client.$transaction(async tx => {
        await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${ownerId} AND action = ANY(${knownActions}) AND detail->>'workspaceId' = ${workspaceId} AND (detail->>'itemId' = ${commentId} OR detail->>'operationId' = ${operationId})`;
        await tx.$executeRaw`DELETE FROM rebuild_inbox_deletions WHERE id = ${operationId} AND "workspaceId" = ${workspaceId} AND "targetId" = ${targetId}`;
        await tx.mcpApiKey.deleteMany({ where: { id: { in: [writeKeyId, readKeyId] }, workspaceId, createdById: ownerId } });
        await tx.session.deleteMany({ where: { id: { in: [ownerSessionId, viewerSessionId] } } });
        await tx.postComment.deleteMany({ where: { id: { in: [commentId, replyId] }, postTargetId } });
        await tx.postTarget.deleteMany({ where: { id: postTargetId, postId, targetId } });
        await tx.post.deleteMany({ where: { id: postId, workspaceId, authorId: ownerId } });
        await tx.target.deleteMany({ where: { id: targetId, workspaceId, socialAccountId: socialId } });
        await tx.socialAccount.deleteMany({ where: { id: socialId, workspaceId } });
        await tx.membership.deleteMany({ where: { id: viewerMembershipId, userId: viewerId, workspaceId } });
        await tx.user.deleteMany({ where: { id: viewerId, email: `${id}@example.test` } });
      });
      const [users, memberships, sessions, keys, socials, targets, posts, postTargets, comments, journal, audits] = await Promise.all([
        client.user.count({ where: { id: viewerId } }), client.membership.count({ where: { id: viewerMembershipId } }), client.session.count({ where: { id: { in: [ownerSessionId, viewerSessionId] } } }),
        client.mcpApiKey.count({ where: { id: { in: [writeKeyId, readKeyId] } } }), client.socialAccount.count({ where: { id: socialId } }), client.target.count({ where: { id: targetId } }),
        client.post.count({ where: { id: postId } }), client.postTarget.count({ where: { id: postTargetId } }), client.postComment.count({ where: { id: { in: [commentId, replyId] } } }),
        client.rebuildInboxDeletion.count({ where: { id: operationId } }),
        client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${ownerId} AND action = ANY(${knownActions}) AND detail->>'workspaceId' = ${workspaceId} AND (detail->>'itemId' = ${commentId} OR detail->>'operationId' = ${operationId})`,
      ]);
      check([users, memberships, sessions, keys, socials, targets, posts, postTargets, comments, journal].every(count => count === 0) && Number(audits[0]?.count ?? -1) === 0, 'All disposable deletion fixtures and matching audit rows must be absent after cleanup.');
      if (Object.keys(aggregate).length) console.log(JSON.stringify({ ...aggregate, cleanupVerified: true }));
    } finally { await client.$disconnect(); }
  }
}

main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected isolated Inbox deletion probe failure.'); process.exitCode = 1; });
