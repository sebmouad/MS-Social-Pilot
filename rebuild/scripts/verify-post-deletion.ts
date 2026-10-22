import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { encryptSecret } from '../src/server/secret-crypto';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production', 'Explicit isolated preview database and origin required.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Origin must be explicit localhost HTTP.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_post_deletion_${randomUUID()}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user';
  const targetId = `${id}_target`; const socialId = `${id}_social`; const postId = `${id}_post`; const aliasId = `${id}_alias`;
  const deliveryId = `${id}_delivery`; const aliasDeliveryId = `${id}_alias_delivery`; const operationId = `${id}_operation`;
  const viewerId = `${id}_viewer`; const viewerMembershipId = `${id}_membership`;
  const readKeyId = `${id}_read_key`; const writeKeyId = `${id}_write_key`; const sessionId = `${id}_session`;
  const token = randomBytes(32).toString('base64url'); const readKey = `mcp_${randomBytes(32).toString('base64url')}`; const writeKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const now = new Date(); const expires = new Date(Date.now() + 300000); const remoteId = `${id}_fake_remote_post`;
  const cookie = `msp_session=${token}; sp_workspace=${workspaceId}`;
  const rpc = async (name: string, args: object, options: { key?: string; root?: boolean } = {}) => {
    const response = await fetch(new URL(`/api/mcp?scope=${options.root ? 'installation' : 'workspace'}`, origin), { method: 'POST',
      headers: { 'content-type': 'application/json', origin: origin.origin, ...(options.key ? { authorization: `Bearer ${options.key}` } : { cookie }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual' });
    const body = await response.json();
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', body, data: body.result?.structuredContent };
  };
  try {
    const owner = await client.user.findUnique({ where: { id: ownerId }, select: { isInstanceOwner: true, disabledAt: true, memberships: { select: { workspaceId: true } } } });
    check(owner?.isInstanceOwner && !owner.disabledAt && owner.memberships.some(row => row.workspaceId === workspaceId), 'Seeded synthetic preview owner required.');
    await client.session.create({ data: { id: sessionId, userId: ownerId, tokenHash: hashSessionToken(token)!, expiresAt: expires, pending: null } });
    await client.user.create({ data: { id: viewerId, email: `${id}@example.test`, name: 'Unassigned deletion probe reader', passwordHash: 'unusable-test-credential' } });
    await client.membership.create({ data: { id: viewerMembershipId, userId: viewerId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${viewerMembershipId}`;
    for (const [keyId, key, writes] of [[readKeyId, readKey, false], [writeKeyId, writeKey, true]] as const) {
      await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: ownerId, name: 'Disposable post deletion probe', tokenHash: createHash('sha256').update(key).digest('hex'), tokenPrefix: key.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: writes ? ['publishing/posts'] : [], expiresAt: expires } });
    }
    const encrypted = encryptSecret(`FAKE_POST_DELETION_${id}`);
    await client.socialAccount.create({ data: { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${id}_source`, name: 'Expired synthetic post deletion source', accessToken: encrypted, scopes: '', tokenExpiresAt: new Date(0), createdAt: now, updatedAt: now } });
    await client.target.create({ data: { id: targetId, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${id}_channel`, name: 'Synthetic deletion channel', accessToken: encrypted, enabled: true, canPublish: true, createdAt: now, updatedAt: now } });
    for (const [localId, targetRowId] of [[postId, deliveryId], [aliasId, aliasDeliveryId]]) {
      await client.post.create({ data: { id: localId, workspaceId, authorId: ownerId, message: 'Identifiable synthetic deletion probe', status: 'published', media: [], createdAt: now, updatedAt: now, publishedAt: now, targets: { create: { id: targetRowId, targetId, status: 'published', remotePostId: remoteId } } } });
    }
    const empty = await rpc('get_post_deletion_status', { postId }, { key: readKey });
    check(empty.noStore && empty.data?.state === 'none' && empty.data.localConfirmed === false, 'Read-only key must see honest empty deletion status.');
    const deniedStart = await rpc('delete_post', { postId, deleteRemote: true, confirmation: `DELETE POST ${postId} REMOTE` }, { key: writeKey });
    check(deniedStart.body.result?.isError && await client.rebuildPostDeletion.count({ where: { workspaceId, targetId } }) === 0, 'Expired source must prevent dispatch and intent creation.');
    await client.rebuildPostDeletion.create({ data: { id: operationId, workspaceId, targetId, provider: 'facebook', remoteId, actorId: ownerId,
      localPostIds: [postId, aliasId], localPostTargetIds: [deliveryId, aliasDeliveryId], state: 'uncertain', reason: 'transport_unconfirmed' } });
    const uncertain = await rpc('get_post_deletion_status', { postId }, { key: readKey });
    check(uncertain.data?.state === 'needs_review' && uncertain.data.operations[0].operationId === operationId && !JSON.stringify(uncertain.data).includes('FAKE_POST_DELETION'), 'Uncertain status must be scoped and credential-free.');
    const readDenied = await rpc('record_post_deletion_outcome', { postId, operationId, outcome: 'deleted', verifiedOnPlatform: true, confirmation: `RECORD POST DELETION ${operationId} DELETED` }, { key: readKey });
    check(readDenied.body.result?.isError, 'Read-only key must not attest writes.');
    const wrong = await rpc('record_post_deletion_outcome', { postId, operationId, outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'wrong' }, { key: writeKey });
    check(wrong.data?.code === 'invalid_request', 'Attestation must require exact confirmation.');
    const repeated = await rpc('delete_post', { postId, deleteRemote: true, confirmation: `DELETE POST ${postId} REMOTE` }, { key: writeKey });
    check(repeated.data?.state === 'needs_review' && await client.rebuildPostDeletion.count({ where: { targetId, workspaceId } }) === 1, 'Repeated deletion must reuse the uncertain operation.');
    const keyRoot = await rpc('list_root_post_deletions', {}, { root: true, key: writeKey });
    check(keyRoot.status === 401, 'Workspace key must not enter private Root recovery.');
    const rootRead = await fetch(new URL('/api/root/post-deletions', origin), { headers: { cookie } });
    const rootBody = await rootRead.json();
    check(rootRead.ok && rootRead.headers.get('cache-control') === 'no-store' && rootBody.items.some((row: { operationId: string }) => row.operationId === operationId), 'Private HTTP must expose the same operation.');
    const attested = await rpc('record_post_deletion_outcome', { postId, operationId, outcome: 'deleted', verifiedOnPlatform: true, confirmation: `RECORD POST DELETION ${operationId} DELETED` }, { key: writeKey });
    check(attested.data?.state === 'local_pending' && attested.data.localConfirmed === false && await client.post.count({ where: { id: postId } }) === 1, 'Manual attestation must not dispatch or silently remove local data.');
    const finished = await rpc('finish_post_deletion', { postId, confirmation: `FINISH POST DELETION ${postId}` }, { key: writeKey });
    check(finished.data?.localConfirmed === true && finished.data.state === 'completed' && await client.post.count({ where: { id: postId } }) === 0, 'Provider-free finish must remove only the requested local post.');
    const retained = await client.post.findUnique({ where: { id: aliasId }, select: { status: true, targets: { select: { remotePostId: true, status: true } } } });
    check(retained?.status === 'cancelled' && retained.targets[0]?.remotePostId === null && retained.targets[0]?.status === 'cancelled', 'Other alias content must remain with reconciled delivery status.');
    const after = await rpc('get_post_deletion_status', { postId }, { key: readKey });
    check(after.data?.localConfirmed === true && after.data.operations[0].localConfirmed === true, 'Status must remain readable after local deletion.');
    const again = await rpc('finish_post_deletion', { postId, confirmation: `FINISH POST DELETION ${postId}` }, { key: writeKey });
    check(again.data?.localConfirmed === true && await client.rebuildPostDeletion.count({ where: { targetId, workspaceId } }) === 1, 'Repeated finish must be provider-free and idempotent.');
    const audits = await client.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE detail->>'workspaceId' = ${workspaceId} AND (detail->>'postId' = ${postId} OR detail->>'operationId' = ${operationId})`;
    check(audits.some(row => row.action === 'publishing.post_deletion_outcome_recorded') && audits.some(row => row.action === 'publishing.post_deleted'), 'Attestation and local removal require domain audits.');
    console.log(JSON.stringify({ emptyRead: true, expiredSourcePreflight: true, uncertainNoRepeat: true, exactConfirmation: true, readKeyWriteDenied: true, rootKeyDenied: true, rootHttp: true, humanAttestation: true, localFinish: true, aliasContentRetained: true, statusAfterRemoval: true, idempotentFinish: true, domainAudits: true, realProviderDispatch: false }));
  } finally {
    await client.$transaction(async tx => {
      await tx.rebuildPostDeletion.deleteMany({ where: { targetId, workspaceId } });
      await tx.postComment.deleteMany({ where: { postTarget: { postId: { in: [postId, aliasId] } } } });
      await tx.postTarget.deleteMany({ where: { postId: { in: [postId, aliasId] } } });
      await tx.post.deleteMany({ where: { id: { in: [postId, aliasId] }, workspaceId } });
      await tx.target.deleteMany({ where: { id: targetId, workspaceId } });
      await tx.socialAccount.deleteMany({ where: { id: socialId, workspaceId } });
      await tx.mcpApiKey.deleteMany({ where: { id: { in: [readKeyId, writeKeyId] } } });
      await tx.session.deleteMany({ where: { id: sessionId } });
      await tx.membership.deleteMany({ where: { id: viewerMembershipId } });
      await tx.user.deleteMany({ where: { id: viewerId } });
    });
    await client.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Post deletion probe failed; inspect isolated service logs without displaying secrets.'); process.exitCode = 1; });
