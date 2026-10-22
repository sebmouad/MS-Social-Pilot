import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
const asObject = (value: unknown) => value && typeof value === 'object' ? value as Record<string, any> : {};

async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production', 'Explicit isolated preview database and origin required.');
  check(process.env.DATABASE_URL === rawDatabase, 'Prisma DATABASE_URL must exactly match the guarded preview database.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost' && origin.port === '3200', 'Origin must be explicit localhost:3200 HTTP.');

  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_publication_recovery_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user'; const targetId = 'preview_target_north';
  const readerId = `${id}_reader`; const membershipId = `${id}_membership`; const viewerSessionId = `${id}_viewer_session`;
  const rootSessionId = `${id}_root_session`; const readKeyId = `${id}_read_key`; const writeKeyId = `${id}_write_key`;
  const socialId = `${id}_social`; const sessionToken = randomBytes(32).toString('base64url'); const rootToken = randomBytes(32).toString('base64url');
  const readKey = `mcp_${randomBytes(32).toString('base64url')}`; const writeKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 300_000); const now = new Date();
  const cookie = `msp_session=${rootToken}; sp_workspace=${workspaceId}`;
  const viewerCookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const targetIds = [targetId];
  const postSpecs = [
    { key: 'absent', postId: `${id}_absent_post`, targetPostId: `${id}_absent_delivery`, operationId: `${id}_absent_operation`, legacy: false },
    { key: 'published', postId: `${id}_published_post`, targetPostId: `${id}_published_delivery`, operationId: `${id}_published_operation`, legacy: false },
    { key: 'legacy', postId: `${id}_legacy_post`, targetPostId: `${id}_legacy_delivery`, operationId: `${id}_legacy_operation`, legacy: true },
    { key: 'root', postId: `${id}_root_post`, targetPostId: `${id}_root_delivery`, operationId: `${id}_root_operation`, legacy: false },
    { key: 'wrong_binding', postId: `${id}_binding_post`, targetPostId: `${id}_binding_delivery`, operationId: `${id}_binding_operation`, legacy: false },
  ];
  const cookieHeaders = (value = cookie, extra: Record<string, string> = {}) => ({ ...extra, cookie: value });
  const rpc = async (name: string, args: object, options: { key?: string; root?: boolean } = {}) => {
    const response = await fetch(new URL(`/api/mcp?scope=${options.root ? 'installation' : 'workspace'}`, origin), {
      method: 'POST', headers: { 'content-type': 'application/json', origin: origin.origin, ...(options.key ? { authorization: `Bearer ${options.key}` } : { cookie }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    const body = await response.json();
    return { status: response.status, noStore: response.headers.get('cache-control') === 'no-store', body, data: body.result?.structuredContent };
  };
  const httpGet = async (path: string, authCookie = cookie) => fetch(new URL(path, origin), { headers: { cookie: authCookie }, redirect: 'manual' });
  const httpWrite = async (path: string, body: object, authCookie = cookie) => fetch(new URL(path, origin), {
    method: 'POST', headers: { cookie: authCookie, origin: origin.origin, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual',
  });

  try {
    const owner = await client.user.findUnique({ where: { id: ownerId }, select: { isInstanceOwner: true, disabledAt: true, memberships: { select: { workspaceId: true, role: true } } } });
    check(owner?.isInstanceOwner && !owner.disabledAt && owner.memberships.some(row => row.workspaceId === workspaceId && row.role === 'owner'), 'Seeded synthetic preview owner with workspace owner access is required.');
    const channel = await client.target.findFirst({ where: { id: targetId, workspaceId, enabled: true, canPublish: true }, select: { id: true } });
    check(channel, 'Seeded selected synthetic North destination is required.');
    check(!await client.user.findUnique({ where: { id: readerId } }), 'Disposable scoped publication reader identity must be unused.');
    await client.session.create({ data: { id: rootSessionId, userId: ownerId, tokenHash: hashSessionToken(rootToken)!, expiresAt, pending: null } });
    await client.user.create({ data: { id: readerId, email: `${id}@example.test`, name: 'Disposable scoped publication reader', passwordHash: 'unusable-test-credential' } });
    await client.membership.create({ data: { id: membershipId, userId: readerId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${targetId})`;
    await client.session.create({ data: { id: viewerSessionId, userId: readerId, tokenHash: hashSessionToken(sessionToken)!, expiresAt, pending: null } });
    for (const [keyId, key, writes] of [[readKeyId, readKey, false], [writeKeyId, writeKey, true]] as const) {
      await client.mcpApiKey.create({ data: {
        id: keyId, workspaceId, createdById: ownerId, name: 'Disposable publication recovery probe',
        tokenHash: createHash('sha256').update(key).digest('hex'), tokenPrefix: key.slice(0, 12),
        readFeatures: ['publishing/posts'], writeFeatures: writes ? ['publishing/posts'] : [], expiresAt,
      } });
    }
    const encrypted = `synthetic-encrypted-${randomUUID()}`;
    await client.socialAccount.create({ data: {
      id: socialId, workspaceId, provider: 'facebook', providerUserId: `${id}_provider`, name: 'Synthetic recovery source',
      accessToken: encrypted, scopes: '', tokenExpiresAt: new Date(0), createdAt: now, updatedAt: now,
    } });
    for (const spec of postSpecs) {
      await client.post.create({ data: {
        id: spec.postId, workspaceId, authorId: ownerId, message: `Disposable synthetic publication recovery ${spec.key}`,
        status: 'publishing', media: [], firstComment: null, createdAt: now, updatedAt: now,
        targets: { create: { id: spec.targetPostId, targetId, status: 'processing' } },
      } });
      if (!spec.legacy) await client.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason)
        VALUES (${spec.operationId},${workspaceId},${spec.postId},${spec.targetPostId},${targetId},'facebook',${ownerId},'uncertain','outcome_unknown')`;
    }

    const absent = postSpecs.find(row => row.key === 'absent')!;
    const published = postSpecs.find(row => row.key === 'published')!;
    const legacy = postSpecs.find(row => row.key === 'legacy')!;
    const root = postSpecs.find(row => row.key === 'root')!;
    const binding = postSpecs.find(row => row.key === 'wrong_binding')!;

    const status = await httpGet(`/api/publishing/recovery?postId=${encodeURIComponent(absent.postId)}`, viewerCookie);
    const statusBody = asObject(await status.json());
    check(status.ok && status.headers.get('cache-control') === 'no-store' && Array.isArray(statusBody.operations)
      && statusBody.operations.some((row: { id: string; state: string }) => row.id === absent.operationId && row.state === 'uncertain'), 'Scoped HTTP status must expose only safe content-free attempt state without caching.');
    const unknownFilter = await httpGet(`/api/publishing/recovery?postId=${absent.postId}&extra=1`);
    check(unknownFilter.status === 400 && unknownFilter.headers.get('cache-control') === 'no-store', 'Recovery HTTP must reject unknown filters and avoid caching.');

    const mcpStatus = await rpc('get_publication_status', { postId: absent.postId }, { key: readKey });
    check(mcpStatus.status === 200 && mcpStatus.noStore && mcpStatus.data?.operations?.some((row: { id: string }) => row.id === absent.operationId), 'Read-only workspace key must read scoped publication recovery status.');
    const readDenied = await rpc('record_publication_outcome', {
      postId: absent.postId, operationId: absent.operationId, outcome: 'ABSENT', verifiedExternally: true,
      confirmation: `RECORD PUBLICATION ${absent.operationId} ABSENT`,
    }, { key: readKey });
    check(readDenied.body.result?.isError, 'Read-only workspace key must not record publication outcomes.');
    const workspaceRootDenied = await rpc('list_root_publication_attempts', {}, { key: writeKey, root: true });
    check(workspaceRootDenied.status === 401, 'Workspace key must not enter private Root recovery.');
    const rootNoSession = await httpGet('/api/root/publication-attempts', viewerCookie);
    check(rootNoSession.status === 403 || rootNoSession.status === 401, 'Workspace member session must not enter private Root recovery.');

    const wrongConfirmation = await rpc('record_publication_outcome', {
      postId: absent.postId, operationId: absent.operationId, outcome: 'ABSENT', verifiedExternally: true, confirmation: 'wrong',
    }, { key: writeKey });
    check(wrongConfirmation.data?.code === 'invalid_request', 'Workspace attestation must require exact operation and outcome confirmation.');
    const wrongBinding = await rpc('record_publication_outcome', {
      postId: binding.postId, operationId: absent.operationId, outcome: 'ABSENT', verifiedExternally: true,
      confirmation: `RECORD PUBLICATION ${absent.operationId} ABSENT`,
    }, { key: writeKey });
    check(wrongBinding.body.result?.isError && ['not_found', 'conflict'].includes(wrongBinding.data?.code), 'An operation must not be attested through another post identity.');

    const adopted = await rpc('adopt_legacy_publication', { postId: legacy.postId, postTargetId: legacy.targetPostId, confirmation: `ADOPT PUBLICATION ${legacy.targetPostId}` }, { key: writeKey });
    check(!adopted.body.result?.isError && adopted.data?.operations?.some((row: { postTargetId: string; state: string }) => row.postTargetId === legacy.targetPostId && row.state === 'uncertain'), 'Workspace MCP must adopt a legacy processing destination into uncertain recovery.');
    const adoptedOperationId = adopted.data.operations.find((row: { postTargetId: string }) => row.postTargetId === legacy.targetPostId).id;
    const absentResult = await rpc('record_publication_outcome', {
      postId: legacy.postId, operationId: adoptedOperationId, outcome: 'ABSENT', verifiedExternally: true,
      confirmation: `RECORD PUBLICATION ${adoptedOperationId} ABSENT`,
    }, { key: writeKey });
    check(!absentResult.body.result?.isError && absentResult.data?.operations?.some((row: { id: string; state: string }) => row.id === adoptedOperationId && row.state === 'attested_absent'), 'Explicit absence must resolve the adopted legacy attempt.');
    check(await client.postTarget.count({ where: { id: legacy.targetPostId, status: 'failed', remotePostId: null } }) === 1, 'Absence attestation must release the local target without contacting a provider.');

    const publishedResult = await httpWrite('/api/publishing/recovery', {
      action: 'record', postId: published.postId, operationId: published.operationId, outcome: 'PUBLISHED',
      remotePostId: `${id}_manual_remote_receipt`, remoteUrl: 'https://example.test/synthetic-recovery', verifiedExternally: true,
      confirmation: `RECORD PUBLICATION ${published.operationId} PUBLISHED`,
    });
    const publishedBody = asObject(await publishedResult.json());
    check(publishedResult.ok && publishedResult.headers.get('cache-control') === 'no-store' && Array.isArray(publishedBody.operations)
      && publishedBody.operations.some((row: { id: string; state: string }) => row.id === published.operationId && row.state === 'receipt_recorded'), 'HTTP attestation must persist a validated external receipt before local projection.');
    const finished = await rpc('finish_publication_projection', {
      postId: published.postId, operationId: published.operationId, confirmation: `FINISH PUBLICATION ${published.operationId}`,
    }, { key: writeKey });
    check(!finished.body.result?.isError && finished.data?.operations?.some((row: { id: string; state: string; remotePostId: string }) => row.id === published.operationId && row.state === 'projected' && row.remotePostId === `${id}_manual_remote_receipt`), 'Workspace MCP finish must project a saved receipt locally.');
    check(await client.postTarget.count({ where: { id: published.targetPostId, status: 'published', remotePostId: `${id}_manual_remote_receipt` } }) === 1, 'Local finish must bind the manually checked remote ID to the intended target.');

    const rootHistory = await httpGet('/api/root/publication-attempts');
    const rootHistoryBody = asObject(await rootHistory.json());
    check(rootHistory.ok && rootHistory.headers.get('cache-control') === 'no-store'
      && rootHistoryBody.items?.some((row: { operationId: string }) => row.operationId === root.operationId), 'Private Root history must include the content-free attempt.');
    const rootMcpHistory = await rpc('list_root_publication_attempts', {}, { root: true });
    check(!rootMcpHistory.body.result?.isError && rootMcpHistory.data?.items?.some((row: { operationId: string }) => row.operationId === root.operationId), 'Installation-owner MCP must read the private recovery history.');
    const rootRecorded = await rpc('record_root_publication_outcome', {
      operationId: root.operationId, outcome: 'PUBLISHED', remotePostId: `${id}_root_manual_receipt`, verifiedExternally: true,
      confirmation: `ROOT RECORD PUBLICATION ${root.operationId} PUBLISHED`,
    }, { root: true });
    check(!rootRecorded.body.result?.isError && rootRecorded.data?.state === 'receipt_recorded', 'Root MCP must record a human-checked remote receipt.');
    const rootFinished = await httpWrite('/api/root/publication-attempts', { action: 'finish', operationId: root.operationId, confirmation: `ROOT FINISH PUBLICATION ${root.operationId}` });
    check(rootFinished.ok && (await rootFinished.json()).state === 'projected'
      && await client.postTarget.count({ where: { id: root.targetPostId, status: 'published', remotePostId: `${id}_root_manual_receipt` } }) === 1, 'Root local finish must project a recorded receipt without provider dispatch.');

    const viewerRead = await httpGet(`/api/publishing/recovery?postId=${encodeURIComponent(absent.postId)}`, viewerCookie);
    check(viewerRead.ok, 'Scoped reader must initially see the selected destination recovery status.');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    const revoked = await httpGet(`/api/publishing/recovery?postId=${encodeURIComponent(absent.postId)}`, viewerCookie);
    check(revoked.status === 404 && revoked.headers.get('cache-control') === 'no-store', 'Revoking the destination grant must immediately hide recovery history.');
    await client.user.update({ where: { id: readerId }, data: { disabledAt: new Date() } });
    const disabledSession = await httpGet(`/api/publishing/recovery?postId=${encodeURIComponent(absent.postId)}`, viewerCookie);
    check(disabledSession.status === 401 && disabledSession.headers.get('cache-control') === 'no-store', 'Disabling the scoped actor must immediately deny its existing session.');

    console.log(JSON.stringify({ scopedHttpStatus: true, noStoreAndUnknownFilter: true, readKeyReadOnly: true, workspaceKeyRootDenied: true,
      exactConfirmation: true, crossPostBindingDenied: true, legacyAdoption: true, externalAbsence: true, workspaceReceiptAndLocalFinish: true,
      rootHistoryAttestationAndFinish: true, grantRevocationImmediate: true, disabledActorDenied: true, realProviderDispatch: false }));
  } finally {
    try {
      await client.$transaction(async tx => {
        await tx.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${workspaceId} AND ((detail->>'postId') LIKE ${`${id}%`} OR (detail->>'operationId') LIKE ${`${id}%`})`;
        await tx.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId" = ${workspaceId} AND (id LIKE ${`${id}%`} OR "postId" LIKE ${`${id}%`})`;
        await tx.postTarget.deleteMany({ where: { id: { in: targetIds.length ? postSpecs.map(row => row.targetPostId) : [] } } });
        await tx.post.deleteMany({ where: { id: { in: postSpecs.map(row => row.postId) }, workspaceId } });
        await tx.target.deleteMany({ where: { id: `${id}_unused_target`, workspaceId } });
        await tx.socialAccount.deleteMany({ where: { id: socialId, workspaceId } });
        await tx.mcpApiKey.deleteMany({ where: { id: { in: [readKeyId, writeKeyId] } } });
        await tx.session.deleteMany({ where: { id: { in: [rootSessionId, viewerSessionId] } } });
        await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
        await tx.membership.deleteMany({ where: { id: membershipId } });
        await tx.user.deleteMany({ where: { id: readerId } });
      });
      check(await client.user.count({ where: { id: readerId } }) === 0
        && await client.membership.count({ where: { id: membershipId } }) === 0
        && await client.session.count({ where: { id: { in: [rootSessionId, viewerSessionId] } } }) === 0
        && await client.mcpApiKey.count({ where: { id: { in: [readKeyId, writeKeyId] } } }) === 0
        && await client.post.count({ where: { id: { in: postSpecs.map(row => row.postId) } } }) === 0
        && await client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId} AND (id LIKE ${`${id}%`} OR "postId" LIKE ${`${id}%`})`.then(rows => Number(rows[0]?.count ?? 0)) === 0,
      'Disposable publication HTTP/MCP records must be removed and verified.');
      console.log(JSON.stringify({ fixturesCleaned: true, providerDispatches: 0 }));
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Publication recovery probe failed; inspect isolated preview logs without displaying credentials or customer content.'); process.exitCode = 1; });
