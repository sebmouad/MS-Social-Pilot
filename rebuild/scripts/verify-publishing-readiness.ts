import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '../generated/client';
import { encryptSecret } from '../src/server/secret-crypto';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }

/** Real local HTTP/MCP requests; no usable remote credential or provider request. */
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production', 'Explicit isolated preview database and origin required.');
  check(process.env.DATABASE_URL === rawDatabase, 'DATABASE_URL must exactly match the guarded preview database.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.origin === 'http://localhost:3200', 'Origin must be explicit localhost:3200 HTTP.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_readiness_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user';
  const sourceId = `${id}_source`; const targetId = `${id}_target`; const postId = `${id}_post`; const deliveryId = `${id}_delivery`; const keyId = `${id}_key`;
  const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const rpc = async (method: string, params: object) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), {
      method: 'POST', headers: { origin: origin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), redirect: 'manual',
    });
    const body = await response.json();
    check(response.ok && response.headers.get('cache-control') === 'no-store', 'MCP must succeed without caching.');
    return body;
  };
  const call = (name: string, args: object = {}) => rpc('tools/call', { name, arguments: args });
  try {
    const owner = await client.user.findFirst({ where: { id: ownerId, disabledAt: null, memberships: { some: { workspaceId, role: 'owner' } } }, select: { id: true } });
    check(owner, 'Synthetic preview workspace owner required.');
    const now = new Date();
    const encrypted = encryptSecret(`synthetic-unusable-${randomUUID()}`);
    await client.socialAccount.create({ data: { id: sourceId, workspaceId, provider: 'facebook', providerUserId: sourceId, name: 'Disposable publishing readiness source', accessToken: encrypted, scopes: '', createdAt: now, updatedAt: now } });
    await client.target.create({ data: { id: targetId, workspaceId, socialAccountId: sourceId, type: 'page', providerId: targetId, name: 'Disposable readiness channel — no publishing grant', accessToken: encrypted, enabled: true, canPublish: true, createdAt: now, updatedAt: now } });
    await client.post.create({ data: { id: postId, workspaceId, authorId: ownerId, message: 'Disposable readiness test; must never leave this local app.', media: [], status: 'draft', createdAt: now, updatedAt: now, targets: { create: { id: deliveryId, targetId, status: 'pending' } } } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: ownerId, name: 'Disposable publishing readiness probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['settings/connections', 'publishing/posts'], writeFeatures: ['publishing/posts'], expiresAt: new Date(Date.now() + 600_000) } });

    const list = await call('list_pages');
    check(!list.result?.isError && list.result?.structuredContent?.items?.some((row: { id: string; canPublish: boolean }) => row.id === targetId && row.canPublish === false), 'MCP destination tool must retain selected history but report missing publishing grants as unavailable.');
    const resource = await rpc('resources/read', { uri: 'msp://targets' });
    check(JSON.parse(resource.result.contents[0].text).some((row: { id: string; canPublish: boolean }) => row.id === targetId && row.canPublish === false), 'MCP destination resource must share current readiness.');
    const publish = await call('publish_post', { postId, confirmation: `PUBLISH POST ${postId}` });
    check(!publish.result?.isError && publish.result?.structuredContent?.published === 0 && publish.result?.structuredContent?.failed === 1 && publish.result?.structuredContent?.needsReconciliation === 0, 'Missing grants must fail locally without creating an uncertain publication.');
    check(await client.postTarget.count({ where: { id: deliveryId, status: 'failed', remotePostId: null } }) === 1, 'Local destination must have a failed, unsubmitted result.');
    const attempts = await client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId} AND "postId"=${postId}`;
    check(Number(attempts[0]?.count) === 0, 'Credential rejection must happen before any durable provider intent.');
    const posts = await call('list_posts', { limit: 100 });
    check(posts.result?.structuredContent?.items?.some((row: { id: string }) => row.id === postId), 'Selected history must remain readable without a publishing grant.');
    // Simulated stored publication only: no content was created on Facebook.
    await client.post.update({ where: { id: postId }, data: { status: 'published', publishedAt: now } });
    await client.postTarget.update({ where: { id: deliveryId }, data: { status: 'published', remotePostId: `${id}_synthetic_remote` } });
    const deletion = await call('delete_post', { postId, deleteRemote: true, confirmation: `DELETE POST ${postId} REMOTE` });
    check(deletion.result?.isError && deletion.result?.structuredContent?.code === 'reconnect_required', 'Remote deletion must reject missing deletion grants before dispatch.');
    const deletions = await client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_post_deletions WHERE "workspaceId"=${workspaceId} AND ${postId}=ANY("localPostIds")`;
    check(Number(deletions[0]?.count) === 0 && await client.post.count({ where: { id: postId } }) === 1, 'Rejected remote deletion must preserve the post without a remote-operation intent.');
    console.log(JSON.stringify({ currentToolReadiness: true, currentResourceReadiness: true, missingGrantBlocked: true, noPublicationIntent: true, historyRetained: true, remoteDeletionBlockedBeforeIntent: true, syntheticOnly: true }));
    if (process.env.REBUILD_PREVIEW_INTERACTIVE === '1') {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try { await input.question('Temporary no-grant channel ready for browser inspection. Press Enter to clean up.\n'); } finally { input.close(); }
    }
  } finally {
    try {
      // Revoke probe access even if an unexpected intent requires investigation.
      await client.mcpApiKey.deleteMany({ where: { id: keyId, workspaceId } });
      const [publicationEvidence, deletionEvidence] = await Promise.all([
        client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId} AND "postId"=${postId}`,
        client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_post_deletions WHERE "workspaceId"=${workspaceId} AND ${postId}=ANY("localPostIds")`,
      ]);
      check(Number(publicationEvidence[0]?.count) === 0 && Number(deletionEvidence[0]?.count) === 0,
        `Unexpected operation evidence: retained synthetic post ${postId}, destination ${targetId} and source ${sourceId} for recovery. Temporary MCP key revoked. Do not resend.`);
      await client.$transaction(async tx => {
        await tx.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId} AND (detail->>'postId'=${postId} OR detail->>'postTargetId'=${deliveryId})`;
        await tx.postTarget.deleteMany({ where: { id: deliveryId, postId } });
        await tx.post.deleteMany({ where: { id: postId, workspaceId } });
        await tx.target.deleteMany({ where: { id: targetId, workspaceId } });
        await tx.socialAccount.deleteMany({ where: { id: sourceId, workspaceId } });
        await tx.mcpApiKey.deleteMany({ where: { id: keyId, workspaceId } });
      });
      check(await client.target.count({ where: { id: targetId } }) === 0 && await client.socialAccount.count({ where: { id: sourceId } }) === 0
        && await client.post.count({ where: { id: postId } }) === 0 && await client.mcpApiKey.count({ where: { id: keyId } }) === 0, 'Disposable readiness fixtures must be removed.');
      console.log(JSON.stringify({ fixturesCleaned: true }));
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Publishing readiness probe failed; inspect private preview logs without exposing credentials.'); process.exitCode = 1; });
