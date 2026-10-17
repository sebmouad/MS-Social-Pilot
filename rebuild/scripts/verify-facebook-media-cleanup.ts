import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'guards';
async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && origin && process.env.NODE_ENV !== 'production' && databaseUrl === process.env.DATABASE_URL, 'Explicit matching isolated preview database and origin required.');
  const database = new URL(databaseUrl);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview databases are permitted.');
  check(origin === 'http://localhost:3200', 'Only explicit localhost:3200 is permitted.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_media_cleanup_${randomUUID().replaceAll('-', '')}`;
  const ownerId = 'preview_qa_user', workspaceId = prefix, userId = `${prefix}_user`, targetId = `${prefix}_target`, postId = `${prefix}_post`, postTargetId = `${prefix}_delivery`, operationId = randomUUID();
  const stepId = randomUUID(), deletionId = randomUUID(), heldStepId = randomUUID(), heldDeletionId = randomUUID();
  const remoteTargetId = `${prefix}_page`, remotePhotoId = `${prefix}_photo`;
  const rootToken = randomBytes(32).toString('base64url'), memberToken = randomBytes(32).toString('base64url'), key = `mcp_${randomBytes(32).toString('base64url')}`;
  const sessionIds = [`${prefix}_root_session`, `${prefix}_member_session`], keyId = `${prefix}_key`, expiresAt = new Date(Date.now() + 300000);
  const rootCookie = `msp_session=${rootToken}; sp_workspace=${workspaceId}`, memberCookie = `msp_session=${memberToken}; sp_workspace=${workspaceId}`;
  const rpc = async (name: string, args: object, workspaceKey = false) => {
    const response = await fetch(`${origin}/api/mcp?scope=${workspaceKey ? 'workspace' : 'installation'}`, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(workspaceKey ? { authorization: `Bearer ${key}` } : { cookie: rootCookie }) }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual' });
    const body = await response.json();
    return { response, body, data: body.result?.structuredContent };
  };
  const action = (subjectId: string) => ({ providerId: 'facebook', actionId: 'delete_staged_photo', subjectId, confirmation: `DELETE STAGED PHOTO ${subjectId}`, acknowledged: true });
  const write = (body: object, cookie: string | null = rootCookie, requestOrigin: string = origin) => fetch(`${origin}/api/root/platform-publication-evidence`, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: 'manual' });
  let settingChanged = false;
  let originalSetting: { value: unknown; encrypted: boolean } | null = null;
  const configKey = 'meta.manualMediaCleanupEnabled';
  const setEnabled = async (value: boolean) => {
    const result = await rpc('set_root_config', { key: configKey, value, confirmation: `SET ROOT CONFIG ${configKey}` });
    check(result.response.ok && !result.body.error && !result.body.result?.isError, 'Audited preview cleanup policy change failed.');
  };
  try {
    check(await db.user.count({ where: { id: ownerId, isInstanceOwner: true, disabledAt: null } }) === 1, 'Seeded active preview installation owner required.');
    const endpoint = await db.appSetting.findUnique({ where: { key: 'meta.graphBaseUrl' } });
    check(endpoint?.encrypted === false && endpoint.value === 'https://provider-preview.invalid', 'Synthetic unusable provider endpoint required.');
    originalSetting = await db.appSetting.findUnique({ where: { key: configKey }, select: { value: true, encrypted: true } });
    check(!originalSetting || originalSetting.encrypted === false && typeof originalSetting.value === 'boolean', 'Cleanup policy must be absent or a plain boolean.');
    stage = 'fixtures';
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable cleanup evidence workspace', timezone: 'UTC' } });
    await db.user.create({ data: { id: userId, email: `${prefix}@example.test`, name: 'Disposable ordinary workspace owner', passwordHash: 'unusable-preview-password' } });
    await db.membership.create({ data: { id: `${prefix}_membership`, userId, workspaceId, role: 'owner' } });
    for (const [index, token] of [rootToken, memberToken].entries()) await db.session.create({ data: { id: sessionIds[index]!, userId: index === 0 ? ownerId : userId, tokenHash: hashLegacySessionToken(token)!, expiresAt, pending: null } });
    await db.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Disposable media cleanup key', tokenHash: createHash('sha256').update(key).digest('hex'), tokenPrefix: key.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: ['publishing/posts'], expiresAt } });
    await db.target.create({ data: { id: targetId, workspaceId, providerId: remoteTargetId, type: 'page', name: 'Synthetic cleanup Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason) VALUES (${operationId},${workspaceId},${postId},${postTargetId},${targetId},'facebook',${ownerId},'uncertain','outcome_unknown')`;
    for (const [index, id] of [stepId, heldStepId].entries()) {
      const photoId = `${remotePhotoId}_${index}`;
      await db.$executeRaw`INSERT INTO rebuild_facebook_media_steps (id,"workspaceId","operationId","postId","postTargetId","targetId","actorId","remoteTargetId",phase,ordinal,state,"remoteId","receiptAt") VALUES (${id},${workspaceId},${operationId},${postId},${postTargetId},${targetId},${ownerId},${remoteTargetId},'photo',${index + 1},'recorded',${photoId},CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO rebuild_facebook_media_deletions (id,"workspaceId","mediaStepId","operationId","postId","postTargetId","targetId","remoteTargetId","remotePhotoId","actorId",state,"receiptAt") VALUES (${index === 0 ? deletionId : heldDeletionId},${workspaceId},${id},${operationId},${postId},${postTargetId},${targetId},${remoteTargetId},${photoId},${ownerId},${index === 0 ? 'confirmed' : 'uncertain'},CASE WHEN ${index === 0} THEN CURRENT_TIMESTAMP ELSE NULL END)`;
    }
    stage = 'default policy denial';
    settingChanged = true;
    await setEnabled(false);
    check((await write(action(stepId))).status === 403, 'Disabled cleanup must deny even confirmed replay.');
    stage = 'authorization';
    await setEnabled(true);
    check((await write(action(stepId), null)).status === 401, 'Anonymous Root write must be denied.');
    check((await write(action(stepId), memberCookie)).status === 403, 'Workspace owner must not gain Root writes.');
    check((await write(action(stepId), rootCookie, 'https://untrusted.example.test')).status === 403, 'Cross-origin Root write must be denied.');
    check((await write({ ...action(stepId), acknowledged: false })).status === 400, 'Risk acknowledgment must be explicit.');
    check((await write({ ...action(stepId), confirmation: 'wrong' })).status === 400, 'Exact step confirmation must be checked by the module.');
    stage = 'confirmed HTTP replay';
    const confirmed = await write(action(stepId));
    const receipt = await confirmed.json();
    check(confirmed.ok && confirmed.headers.get('cache-control') === 'no-store' && receipt.ok === true && receipt.state === 'confirmed' && receipt.operationId === deletionId, 'HTTP must replay only the exact durable confirmed deletion.');
    stage = 'confirmed MCP replay';
    const tool = await rpc('run_root_platform_publication_action', action(stepId));
    check(tool.response.ok && !tool.body.error && !tool.body.result?.isError && tool.data?.operationId === deletionId && tool.data.state === 'confirmed', 'Installation MCP must replay the same durable deletion.');
    stage = 'held outcome';
    check((await write(action(heldStepId))).status === 409, 'Uncertain deletion must refuse another dispatch.');
    const held = await rpc('run_root_platform_publication_action', action(heldStepId));
    check(held.body.error || held.body.result?.isError || held.data?.ok === false, 'MCP must also hold uncertain deletion.');
    stage = 'key denial';
    const initialized = await fetch(`${origin}/api/mcp?scope=workspace`, { method: 'POST', headers: { 'content-type': 'application/json', origin, authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'initialize', params: {} }), redirect: 'manual' });
    const identity = await initialized.json();
    check(initialized.ok && identity.result?.serverInfo && !identity.error, 'Workspace key must authenticate before its private action denial is tested.');
    const denied = await rpc('run_root_platform_publication_action', action(stepId), true);
    check(denied.body.error || denied.body.result?.isError || !denied.response.ok, 'Workspace API keys must never execute private Root actions.');
    stage = 'evidence';
    const read = await fetch(`${origin}/api/root/platform-publication-evidence?providerId=facebook&operationId=${operationId}`, { headers: { cookie: rootCookie }, redirect: 'manual' });
    const evidence = await read.json();
    check(read.ok && evidence.items?.length === 2 && evidence.items.some((item: { cleanupState: string }) => item.cleanupState === 'confirmed') && !evidence.actions?.length, 'Evidence must retain confirmed/uncertain outcomes without a new cleanup action.');
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${workspaceId}`;
    check(Number(rows[0]?.count) === 2, 'Replay and uncertainty denial must not create new deletion intents.');
    console.log(JSON.stringify({ privateHttpMcpConfirmedReplayParity: true, exactConfirmationAndAcknowledgment: true, policyAndOriginEnforced: true, rootIndependentOfMembership: true, anonymousWorkspaceOwnerAndKeyDenied: true, uncertainOutcomeHeld: true, noNewIntentOrProviderDispatch: true, realProviderRequests: false }));
  } finally {
    try {
      if (settingChanged) {
        stage = 'policy restoration';
        await setEnabled(originalSetting ? originalSetting.value as boolean : false);
        if (!originalSetting) await db.appSetting.deleteMany({ where: { key: configKey, encrypted: false, value: { equals: false } } });
        const restored = await db.appSetting.findUnique({ where: { key: configKey }, select: { value: true, encrypted: true } });
        check(JSON.stringify(restored) === JSON.stringify(originalSetting), 'Original cleanup policy must be exactly restored.');
      }
    } finally {
      try {
        await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_facebook_media_steps WHERE "workspaceId"=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
        await db.target.deleteMany({ where: { workspaceId } });
        await db.mcpApiKey.deleteMany({ where: { id: keyId, workspaceId } });
        await db.session.deleteMany({ where: { id: { in: sessionIds } } });
        await db.membership.deleteMany({ where: { workspaceId } });
        await db.workspace.deleteMany({ where: { id: workspaceId } });
        await db.user.deleteMany({ where: { id: userId } });
        check(await db.workspace.count({ where: { id: workspaceId } }) === 0 && await db.user.count({ where: { id: userId } }) === 0 && await db.session.count({ where: { id: { in: sessionIds } } }) === 0, 'Disposable cleanup fixtures must be removed.');
        console.log(JSON.stringify({ fixturesCleaned: true, originalPolicyRestored: true, noSecretsPrinted: true }));
      } finally { await db.$disconnect(); }
    }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : `Facebook media cleanup probe failed at ${stage}; sensitive details withheld.`); process.exitCode = 1; });
