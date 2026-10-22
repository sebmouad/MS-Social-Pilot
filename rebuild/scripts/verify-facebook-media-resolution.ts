import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { facebookMediaJournal } from '../src/platforms/facebook/media-journal';

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
  const prefix = `preview_media_resolution_${randomUUID().replaceAll('-', '')}`;
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
  let policyRestored = true;
  let originalSetting: { value: unknown; encrypted: boolean } | null = null;
  const configKey = 'meta.manualMediaAttestationEnabled';
  const setEnabled = async (value: boolean) => {
    const result = await rpc('set_root_config', { key: configKey, value, confirmation: `SET ROOT CONFIG ${configKey}` });
    check(result.response.ok && !result.body.error && !result.body.result?.isError, 'Audited preview attestation policy change failed.');
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
    for (const [index, token] of [rootToken, memberToken].entries()) await db.session.create({ data: { id: sessionIds[index]!, userId: index === 0 ? ownerId : userId, tokenHash: hashSessionToken(token)!, expiresAt, pending: null } });
    await db.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Disposable media cleanup key', tokenHash: createHash('sha256').update(key).digest('hex'), tokenPrefix: key.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: ['publishing/posts'], expiresAt } });
    await db.target.create({ data: { id: targetId, workspaceId, providerId: remoteTargetId, type: 'page', name: 'Synthetic cleanup Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason) VALUES (${operationId},${workspaceId},${postId},${postTargetId},${targetId},'facebook',${ownerId},'uncertain','outcome_unknown')`;
    for (const [index, id] of [stepId, heldStepId].entries()) {
      const photoId = `${remotePhotoId}_${index}`;
      await db.$executeRaw`INSERT INTO rebuild_facebook_media_steps (id,"workspaceId","operationId","postId","postTargetId","targetId","actorId","remoteTargetId",phase,ordinal,state,"remoteId","receiptAt") VALUES (${id},${workspaceId},${operationId},${postId},${postTargetId},${targetId},${ownerId},${remoteTargetId},'photo',${index + 1},'recorded',${photoId},CURRENT_TIMESTAMP)`;
      await db.$executeRaw`INSERT INTO rebuild_facebook_media_deletions (id,"workspaceId","mediaStepId","operationId","postId","postTargetId","targetId","remoteTargetId","remotePhotoId","actorId",state,"receiptAt") VALUES (${index === 0 ? deletionId : heldDeletionId},${workspaceId},${id},${operationId},${postId},${postTargetId},${targetId},${remoteTargetId},${photoId},${ownerId},${index === 0 ? 'confirmed' : 'uncertain'},CASE WHEN ${index === 0} THEN CURRENT_TIMESTAMP ELSE NULL END)`;
    }
    stage = 'resolution fixtures';
    await db.post.create({ data: { id: postId, workspaceId, authorId: userId, message: 'Disposable resolution example', media: [], status: 'publishing', createdAt: new Date(), updatedAt: new Date(), targets: { create: { id: postTargetId, targetId, status: 'processing' } } } });
    const absentStepId = randomUUID();
    await db.$executeRaw`INSERT INTO rebuild_facebook_media_steps (id,"workspaceId","operationId","postId","postTargetId","targetId","actorId","remoteTargetId",phase,ordinal,state) VALUES (${absentStepId},${workspaceId},${operationId},${postId},${postTargetId},${targetId},${ownerId},${remoteTargetId},'photo',3,'started')`;
    const feedOperationId = randomUUID(), feedStepId = randomUUID(), feedPostId = `${prefix}_feed_post`, feedDeliveryId = `${prefix}_feed_delivery`, feedRemoteId = `${prefix}_feed_remote`;
    await db.post.create({ data: { id: feedPostId, workspaceId, authorId: userId, message: 'Disposable feed recovery example', media: [], status: 'publishing', createdAt: new Date(), updatedAt: new Date(), targets: { create: { id: feedDeliveryId, targetId, status: 'processing' } } } });
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason) VALUES (${feedOperationId},${workspaceId},${feedPostId},${feedDeliveryId},${targetId},'facebook',${ownerId},'uncertain','outcome_unknown')`;
    for (const ordinal of [1,2]) await db.$executeRaw`INSERT INTO rebuild_facebook_media_steps (id,"workspaceId","operationId","postId","postTargetId","targetId","actorId","remoteTargetId",phase,ordinal,state,"remoteId","receiptAt") VALUES (${randomUUID()},${workspaceId},${feedOperationId},${feedPostId},${feedDeliveryId},${targetId},${ownerId},${remoteTargetId},'photo',${ordinal},'recorded',${`${prefix}_feed_photo_${ordinal}`},CURRENT_TIMESTAMP)`;
    await db.$executeRaw`INSERT INTO rebuild_facebook_media_steps (id,"workspaceId","operationId","postId","postTargetId","targetId","actorId","remoteTargetId",phase,ordinal,state) VALUES (${feedStepId},${workspaceId},${feedOperationId},${feedPostId},${feedDeliveryId},${targetId},${ownerId},${remoteTargetId},'feed',0,'started')`;
    const evidence = async (id: string) => {
      const response = await fetch(`${origin}/api/root/platform-publication-evidence?providerId=facebook&operationId=${id}`, { headers: { cookie: rootCookie }, redirect:'manual' });
      check(response.ok, 'Root evidence must be available.');
      return response.json();
    };
    const moduleAction = async (id: string, actionId: string, subjectId: string) => {
      const panel = await evidence(id);
      const metadata = panel.actions?.find((item: { actionId:string; subjectId:string }) => item.actionId === actionId && item.subjectId === subjectId);
      check(metadata, 'Module must declare the current action.');
      return { providerId: 'facebook', actionId, subjectId, confirmation: metadata.confirmation, acknowledged: true };
    };
    const workspaceCall = async (name:string, args:object = {}) => {
      const response = await fetch(`${origin}/api/mcp?scope=workspace`, { method:'POST', headers:{ 'content-type':'application/json', origin, cookie:memberCookie }, body:JSON.stringify({ jsonrpc:'2.0', id:randomUUID(), method:'tools/call', params:{ name, arguments:args } }), redirect:'manual' });
      const body = await response.json();
      return { response, body, data:body.result?.structuredContent };
    };
    stage = 'policy denial';
    settingChanged = true; policyRestored = false;
    await setEnabled(false);
    const absentInput = { providerId:'facebook', actionId:'record_step_absent', subjectId:absentStepId, confirmation:`ATTEST FACEBOOK STEP ${absentStepId} ABSENT`, acknowledged:true };
    check((await write(absentInput)).status === 403, 'Disabled manual policy must deny writes.');
    await setEnabled(true);
    const feedInput = await moduleAction(feedOperationId, 'record_feed_present', feedStepId);
    if (process.env.REBUILD_PREVIEW_BROWSER_HOLD === '1') {
      console.log(JSON.stringify({ browserFixtureReady:true, operationId:feedOperationId, stepId:feedStepId, remoteId:feedRemoteId, url:`${origin}/root/platforms/facebook?operationId=${feedOperationId}`, realProviderRequests:false }));
      await new Promise<void>(resolve => { const timer=setTimeout(resolve,180000);process.stdin.resume();process.stdin.once('data',()=>{clearTimeout(timer);resolve();}); });
      process.stdin.pause();
      return;
    }
    stage = 'private authority and validation';
    check((await write(feedInput, null)).status === 401, 'Anonymous Root write must be denied.');
    check((await write(feedInput, memberCookie)).status === 403, 'Workspace owner must not gain Root writes.');
    check((await write(feedInput, rootCookie, 'https://untrusted.example.test')).status === 403, 'Cross-origin Root write must be denied.');
    check((await write({ ...feedInput, acknowledged:false })).status === 400, 'External risk acknowledgment must be explicit.');
    check((await write({ ...feedInput, confirmation:'wrong' })).status === 400, 'Module exact confirmation must be enforced.');
    check((await write(feedInput)).status === 400, 'Required external identifier must be enforced by the module.');
    check((await write({ ...feedInput, fieldValues:{ remoteId:feedRemoteId, unexpected:'not allowed' } })).status === 400, 'Module must reject unexpected fields.');
    check((await write({ ...feedInput, fieldValues:{ remoteId:{ nested:true } } })).status === 400, 'Shared service must reject nested field values.');
    stage = 'feed HTTP attestation';
    const feedResponse = await write({ ...feedInput, fieldValues:{ remoteId:feedRemoteId } });
    const feedReceipt = await feedResponse.json();
    check(feedResponse.ok && feedResponse.headers.get('cache-control') === 'no-store' && feedReceipt.ok === true && feedReceipt.state === 'attested', 'Human feed report must return attested, never provider-confirmed.');
    check((await write({ ...feedInput, fieldValues:{ remoteId:feedRemoteId } })).status === 409, 'A resolved step must not be overwritten by repeat submission.');
    stage = 'MCP absence and deletion attestation';
    const absentMetadata = await moduleAction(operationId, 'record_step_absent', absentStepId);
    const absent = await rpc('run_root_platform_publication_action', absentMetadata);
    check(absent.response.ok && !absent.body.error && !absent.body.result?.isError && absent.data?.state === 'attested', 'MCP must use the same local attestation service.');
    const deletedInput = await moduleAction(operationId, 'record_photo_deleted', heldDeletionId);
    const deleted = await rpc('run_root_platform_publication_action', deletedInput);
    check(deleted.response.ok && !deleted.body.error && !deleted.body.result?.isError && deleted.data?.state === 'attested', 'Unknown deletion must retain human provenance through MCP.');
    const rootPublication = (body:object) => fetch(`${origin}/api/root/publication-attempts`, { method:'POST', headers:{ cookie:rootCookie, origin, 'content-type':'application/json' }, body:JSON.stringify(body), redirect:'manual' });
    stage = 'local publication projection';
    check((await rootPublication({ operationId:feedOperationId, outcome:'ABSENT', verifiedExternally:true, confirmation:`ROOT RECORD PUBLICATION ${feedOperationId} ABSENT` })).status === 409, 'Known feed presence must block parent absence.');
    check((await rootPublication({ operationId:feedOperationId, outcome:'PUBLISHED', remotePostId:feedRemoteId, verifiedExternally:true, confirmation:`ROOT RECORD PUBLICATION ${feedOperationId} PUBLISHED` })).ok, 'Matching feed evidence must permit a separate explicit parent receipt.');
    check((await rootPublication({ action:'finish', operationId:feedOperationId, confirmation:`ROOT FINISH PUBLICATION ${feedOperationId}` })).ok, 'Known receipt must finish locally without publishing again.');
    check((await db.postTarget.findUnique({ where:{ id:feedDeliveryId }, select:{ status:true,remotePostId:true } }))?.remotePostId === feedRemoteId, 'Projection must use the exact human-reported feed identity.');
    check((await rootPublication({ operationId, outcome:'ABSENT', verifiedExternally:true, confirmation:`ROOT RECORD PUBLICATION ${operationId} ABSENT` })).ok, 'All settled photo effects must permit separate parent absence recording.');
    stage = 'late provider receipt';
    await facebookMediaJournal(operationId, remoteTargetId).recordPhoto(3, `${prefix}_late_photo`);
    const late = await evidence(operationId);
    check(late.items?.some((item:{recordType:string;state:string})=>item.recordType==='step' && item.state==='conflict') && late.items?.some((item:{recordType:string;source:string;remoteId:string})=>item.recordType==='event' && item.source==='provider' && item.remoteId===`${prefix}_late_photo`), 'Contradictory late receipt must remain visible and held after parent absence.');
    stage = 'workspace export and erase hold';
    const exported = await workspaceCall('export_workspace_data');
    check(exported.response.ok && !exported.body.error && !exported.body.result?.isError && JSON.stringify(exported.data).includes('rebuild_facebook_media_resolutions') && JSON.stringify(exported.data).includes(`${prefix}_late_photo`), 'Workspace export must include its FK-owned resolution evidence.');
    const erase = await workspaceCall('delete_workspace_data', { confirmation:`DELETE WORKSPACE DATA ${workspaceId}` });
    check(erase.body.error || erase.body.result?.isError || erase.data?.deleted !== true, 'Unresolved conflict must block workspace erasure.');
    check(await db.workspace.count({ where:{ id:workspaceId } })===1 && await db.target.count({ where:{ id:targetId } })===1, 'Denied erasure must preserve fixture records.');
    const initialized = await fetch(`${origin}/api/mcp?scope=workspace`, { method:'POST', headers:{ 'content-type':'application/json',origin,authorization:`Bearer ${key}` }, body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'initialize',params:{}}),redirect:'manual'});
    check(initialized.ok && (await initialized.json()).result?.serverInfo, 'Workspace key must authenticate before Root denial.');
    const denied = await rpc('run_root_platform_publication_action', absentMetadata, true);
    check(denied.body.error || denied.body.result?.isError || !denied.response.ok, 'Workspace keys must never execute Root reports.');
    console.log(JSON.stringify({ privateHttpMcpAttestationParity:true, moduleFieldsAndExactConfirmation:true, anonymousOwnerKeyAndOriginDenied:true, humanProvenanceRetained:true, matchingLocalProjectionNoResend:true, lateReceiptAfterParentAbsenceHeld:true, fkOwnedEvidenceExported:true, conflictBlocksErase:true, realProviderRequests:false }));

  } finally {
    try {
      if (settingChanged) {
        stage = 'policy restoration';
        // Browser/approval waits can outlive this disposable fixture session.
        // Renew only its own session; the MCP service still checks current Root
        // authority before accepting the audited restoration.
        await db.session.updateMany({ where: { id: sessionIds[0], userId: ownerId, tokenHash: hashSessionToken(rootToken)! }, data: { expiresAt: new Date(Date.now() + 300000) } });
        await setEnabled(originalSetting ? originalSetting.value as boolean : false);
        if (!originalSetting) await db.appSetting.deleteMany({ where: { key: configKey, encrypted: false, value: { equals: false } } });
        const restored = await db.appSetting.findUnique({ where: { key: configKey }, select: { value: true, encrypted: true } });
        check(JSON.stringify(restored) === JSON.stringify(originalSetting), 'Original attestation policy must be exactly restored.');
        policyRestored = true;
      }
    } finally {
      try {
        await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_facebook_media_resolutions WHERE "workspaceId"=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_facebook_media_steps WHERE "workspaceId"=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
        await db.post.deleteMany({ where: { workspaceId } });
        await db.target.deleteMany({ where: { workspaceId } });
        await db.mcpApiKey.deleteMany({ where: { id: keyId, workspaceId } });
        await db.session.deleteMany({ where: { id: { in: sessionIds } } });
        await db.membership.deleteMany({ where: { workspaceId } });
        await db.workspace.deleteMany({ where: { id: workspaceId } });
        await db.user.deleteMany({ where: { id: userId } });
        check(await db.workspace.count({ where: { id: workspaceId } }) === 0 && await db.user.count({ where: { id: userId } }) === 0 && await db.session.count({ where: { id: { in: sessionIds } } }) === 0, 'Disposable resolution fixtures must be removed.');
        console.log(JSON.stringify({ fixturesCleaned: true, originalPolicyRestored: policyRestored, noSecretsPrinted: true }));
      } finally { await db.$disconnect(); }
    }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : `Facebook media resolution probe failed at ${stage}; sensitive details withheld.`); process.exitCode = 1; });
