/** Guarded synthetic-only HTTP/MCP/PostgreSQL and worker lifecycle proof. Never publishes. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { encryptSecret } from '../src/server/secret-crypto';
import { runPublishingMix, runPublishingRecycle } from '@/modules/publishing/server/automation';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'preview guards';
const stopController = new AbortController();
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { interrupted = true; stopController.abort(); });
async function fetchGuarded(input: string | URL, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([stopController.signal, init.signal, timeout]) : AbortSignal.any([stopController.signal, timeout]);
  return fetch(input, { ...init, signal });
}
const settingKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles', 'platforms.facebook.enabled',
  'entitlements.features.publishing/posts', 'entitlements.features.publishing/queue', 'entitlements.features.publishing/collaboration',
  'publishing.collab.versionRetention', 'publishing.collab.queueSlotLimit', 'publishing.collab.queueLookaheadDays', 'publishing.queue.defaultSlot', 'meta.appSecret',
] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required; production is refused.');
  const database = new URL(databaseUrl), base = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview PostgreSQL is allowed.');
  check(base.origin === origin && base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '3200', 'Only localhost:3200 HTTP preview is allowed.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_automation_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `${prefix}_workspace`, foreignWorkspaceId = `${prefix}_foreign_workspace`, ownerId = `${prefix}_owner`, contributorId = `${prefix}_contributor`;
  const ownerMembershipId = `${prefix}_owner_membership`, contributorMembershipId = `${prefix}_contributor_membership`, foreignMembershipId = `${prefix}_foreign_membership`;
  const sessionId = `${prefix}_session`, contributorSessionId = `${prefix}_contributor_session`, socialId = `${prefix}_social`, targetId = `${prefix}_target`, foreignSocialId = `${prefix}_foreign_social`, foreignTargetId = `${prefix}_foreign_target`;
  const ownerKeyId = `${prefix}_owner_key`, readKeyId = `${prefix}_read_key`;
  const labelId = `${prefix}_label`;
  const createdPostIds: string[] = [], foreignPostId = `${prefix}_foreign_post`;
  const sessionToken = randomBytes(32).toString('base64url'), contributorSessionToken = randomBytes(32).toString('base64url'), ownerBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const readBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000), settings = new Map<string, Setting | null>(), oldRootAudits = new Set<string>();
  let settingsCaptured = false, rootWrites = false, fixtureStarted = false, postCount = 0, recoveryLedgerSaved = false;
  const recoveryLedgerPath = `/private/tmp/${prefix}-recovery.json`;
  async function persistRecoveryLedger(phase: string) {
    let operation = 'serialize';
    const ledger = {
      probe: 'verify-publishing-automation', phase, prefix, capturedAt: new Date().toISOString(),
      settings: [...settings.values()].filter((row): row is Setting => row !== null).map(row => ({ ...row })),
      absentSettings: [...settings.entries()].filter(([, row]) => row === null).map(([key]) => key),
      priorRootAuditIds: [...oldRootAudits],
      fixtureIds: { workspaceId, foreignWorkspaceId, ownerId, contributorId, sessionId, contributorSessionId, ownerMembershipId, contributorMembershipId, foreignMembershipId, socialId, targetId, foreignSocialId, foreignTargetId, ownerKeyId, readKeyId, foreignPostId, labelId, createdPostIds: [...createdPostIds] },
    };
    try {
      const serialized = JSON.stringify(ledger);
      operation = 'open private temporary file';
      const temporaryPath = `${recoveryLedgerPath}.${randomUUID()}.tmp`;
      const handle = await open(temporaryPath, 'wx', 0o600);
      try { operation = 'write and flush private temporary file'; await handle.writeFile(serialized, { encoding: 'utf8' }); await handle.sync(); }
      finally { await handle.close(); }
      operation = 'atomically install private recovery ledger';
      await rename(temporaryPath, recoveryLedgerPath);
      recoveryLedgerSaved = true;
    } catch {
      throw new ProbeFailure(`Private recovery ledger could not complete: ${operation}.`);
    }
  }
  function checkpoint() { if (stopController.signal.aborted) throw new ProbeFailure('Probe interrupted; guarded cleanup is running.'); }
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const cookie = (ws = workspaceId) => `msp_session=${sessionToken}; sp_workspace=${ws}`;
  const contributorCookie = `msp_session=${contributorSessionToken}; sp_workspace=${workspaceId}`;
  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function http(path: string, method = 'GET', body?: unknown, ws = workspaceId) {
    return fetchGuarded(new URL(path, base), { method, redirect: 'manual', headers: { origin: base.origin, cookie: cookie(ws), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function contributorHttp(path: string, method = 'GET', body?: unknown) {
    return fetchGuarded(new URL(path, base), { method, redirect: 'manual', headers: { origin: base.origin, cookie: contributorCookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function rpc(name: string, args: unknown = {}, bearer = ownerBearer) {
    const response = await fetchGuarded(new URL('/api/mcp?scope=workspace', base), { method: 'POST', redirect: 'manual', headers: { origin: base.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    return { response, body: await json(response) };
  }
  async function saveSetting(key: string, value: unknown) {
    checkpoint();
    rootWrites = true;
    const response = await http('/api/root/config', 'PUT', { key, value }); const result = await json(response);
    check(response.ok && result?.schemaVersion === CONFIG_SCHEMA_VERSION, `Root setting ${key} did not apply.`);
  }
  async function createPost(message: string, bearer = ownerBearer) {
    checkpoint();
    const result = await rpc('create_post', { message, firstComment: '', targetIds: [targetId], confirmation: 'CREATE POST' }, bearer);
    const id = result.body?.result?.structuredContent?.id;
    check(result.response.ok && !result.body?.result?.isError && typeof id === 'string', 'Synthetic queue draft creation failed safely.');
    postCount++; createdPostIds.push(id as string); await persistRecoveryLedger('synthetic draft created');
    return id as string;
  }
  async function postState(id: string) {
    return (await db.$queryRaw<Array<{ id: string; workspaceId: string; status: string; scheduledAt: Date | null; timezone: string; approvalStatus: string; publishedAt: Date | null }>>`
      SELECT id,"workspaceId",status::text AS status,"scheduledAt",timezone,"approvalStatus"::text AS "approvalStatus","publishedAt" FROM posts WHERE id=${id}`)[0] ?? null;
  }
  async function queueMcp(id: string, bearer = ownerBearer, confirmation = `QUEUE POST ${id}`) {
    return rpc('queue_post', { postId: id, confirmation }, bearer);
  }
  async function saveQueue(target: string | null, slots: Array<{ dayOfWeek: number; hour: number; minute: number }>) {
    checkpoint();
    const confirmation = `REPLACE QUEUE TIMES ${target ?? 'SHARED'}`;
    const response = await http('/api/publishing/queue-slots', 'PUT', { targetId: target, slots, confirmation });
    const result = await json(response);
    check(response.ok && result?.count === slots.length, `Could not save ${target ? 'channel' : 'shared'} synthetic queue times.`);
  }
  async function queueSlotCount(target: string | null) {
    return Number((await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM queue_slots WHERE "workspaceId"=${workspaceId} AND "targetId" IS NOT DISTINCT FROM ${target}`)[0]?.count ?? 0);
  }
  try {
    stage = 'check required preview tables';
    const requiredTables = ['workspaces','users','memberships','sessions','mcp_api_keys','app_settings','root_activities','activity_logs','social_accounts','targets','posts','post_targets','post_versions','queue_slots','member_page_access','labels','post_labels','content_mix_rules'];
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY(${requiredTables}::text[])`;
    check(tables.length === requiredTables.length, `Required preview tables unavailable (${tables.length}/${requiredTables.length}); no fixtures written.`);
    stage = 'check localhost preview preflight';
    const preflight = await fetchGuarded(new URL('/sign-in', base), { redirect: 'manual' });
    check(preflight.status < 500, 'Expected localhost preview is not responding.');
    stage = 'capture exact Root setting rows';
    for (const key of settingKeys) {
      const row = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!row || !row.encrypted || key === 'meta.appSecret', `Root setting ${key} unexpectedly contains encrypted data.`); settings.set(key, row);
    }
    settingsCaptured = true;
    stage = 'capture preexisting Root audit IDs';
    const audits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${ownerId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;
    audits.forEach(row => oldRootAudits.add(row.id));

    stage = 'create disposable owner/contributor workspaces, Facebook channels, and scoped MCP keys';
    await persistRecoveryLedger('before first Root setting or fixture write');
    fixtureStarted = true;
    await db.user.create({ data: { id: ownerId, email: `${ownerId}@example.test`, name: 'Disposable queue probe owner', passwordHash: 'unusable-preview-password', isInstanceOwner: true, totpEnabledAt: new Date() } });
    await db.user.create({ data: { id: contributorId, email: `${contributorId}@example.test`, name: 'Disposable queue probe contributor', passwordHash: 'unusable-preview-password' } });
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable queue workspace', timezone: 'UTC' } });
    await db.$executeRaw`UPDATE workspaces SET "requiresApproval"=true WHERE id=${workspaceId}`;
    await db.workspace.create({ data: { id: foreignWorkspaceId, slug: foreignWorkspaceId, name: 'Disposable foreign queue workspace', timezone: 'UTC' } });
    await db.membership.create({ data: { id: ownerMembershipId, userId: ownerId, workspaceId, role: 'owner' } });
    await db.membership.create({ data: { id: contributorMembershipId, userId: contributorId, workspaceId, role: 'contributor' } });
    await db.membership.create({ data: { id: foreignMembershipId, userId: ownerId, workspaceId: foreignWorkspaceId, role: 'owner' } });
    await db.session.create({ data: { id: sessionId, userId: ownerId, tokenHash: hashLegacySessionToken(sessionToken)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: contributorSessionId, userId: contributorId, tokenHash: hashLegacySessionToken(contributorSessionToken)!, expiresAt, pending: null } });
    await db.socialAccount.create({ data: { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Disposable queue connection', accessToken: encryptSecret('synthetic-no-provider-credential'), scopes: 'pages_manage_posts' } });
    await db.socialAccount.create({ data: { id: foreignSocialId, workspaceId: foreignWorkspaceId, provider: 'facebook', providerUserId: `${prefix}_foreign_provider`, name: 'Disposable foreign queue connection', accessToken: encryptSecret('synthetic-no-provider-credential'), scopes: 'pages_manage_posts' } });
    await db.target.create({ data: { id: targetId, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${prefix}_page`, name: 'Disposable queue channel', accessToken: encryptSecret('synthetic-no-provider-credential'), enabled: true, canPublish: true, createdAt: new Date() } });
    await db.target.create({ data: { id: foreignTargetId, workspaceId: foreignWorkspaceId, socialAccountId: foreignSocialId, type: 'page', providerId: `${prefix}_foreign_page`, name: 'Disposable foreign queue channel', accessToken: encryptSecret('synthetic-no-provider-credential'), enabled: true, canPublish: true, createdAt: new Date() } });
    const features = ['publishing/posts', 'publishing/queue', 'publishing/collaboration'];
    for (const [id, user, token, writable] of [[ownerKeyId, ownerId, ownerBearer, true], [readKeyId, ownerId, readBearer, false]] as const) {
      await db.mcpApiKey.create({ data: { id, workspaceId, createdById: user, name: 'Disposable queue workflow key', tokenHash: sha256(token), tokenPrefix: token.slice(0,12), readFeatures: features, writeFeatures: writable ? features : [], expiresAt } });
    }
    await db.$executeRaw`UPDATE memberships SET "allPages"=true WHERE id=${ownerMembershipId}`;
    await db.$executeRaw`UPDATE memberships SET "allPages"=false WHERE id=${contributorMembershipId}`;

    stage = 'enable the current Root queue policies and publishing features';
    await saveSetting('mcp.enabled', true); await saveSetting('mcp.authenticatedRoles', ['owner','admin']);
    await saveSetting('platforms.facebook.enabled', true);
    await saveSetting('meta.appSecret', `synthetic-automation-${randomUUID()}`);
    await saveSetting('entitlements.features.publishing/posts', true); await saveSetting('entitlements.features.publishing/queue', true); await saveSetting('entitlements.features.publishing/collaboration', true);
    await saveSetting('publishing.collab.versionRetention', 20); await saveSetting('publishing.collab.queueSlotLimit', 100); await saveSetting('publishing.collab.queueLookaheadDays', 30);
    await saveSetting('publishing.queue.defaultSlot', { dayOfWeek: 4, hour: 13, minute: 45 });
    stage = 'verify Root queue default reaches rendered editor HTML';
    const queuePage = await http('/publishing/collaboration?view=queue');
    const queuePageHtml = await queuePage.text();
    const renderedDefaultTime = /<input\b[^>]*\btype="time"[^>]*\bvalue="13:45"|<input\b[^>]*\bvalue="13:45"[^>]*\btype="time"/.test(queuePageHtml);
    const renderedWorkspaceTimezone = queuePageHtml.replace(/<!--[\s\S]*?-->/g, '').includes('The workspace timezone is UTC.');
    check(queuePage.ok && renderedDefaultTime && renderedWorkspaceTimezone,
      `Queue editor HTML did not render Root default and workspace timezone (status=${queuePage.status}, time=${renderedDefaultTime}, timezone=${renderedWorkspaceTimezone}).`);

    stage = 'create synthetic label, timetable and mix rules';
    await db.$executeRaw`INSERT INTO labels (id,"workspaceId",name,color,"createdAt") VALUES (${labelId},${workspaceId},'Disposable automation category','#43795C',NOW())`;
    const slots = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, hour: 12, minute: 0 }));
    const slotWrite = await http('/api/publishing/queue-slots','PUT',{targetId:null,slots,confirmation:'REPLACE QUEUE TIMES SHARED'});
    check(slotWrite.ok,'Synthetic timetable could not be saved.');
    const mixWrite = await http('/api/publishing/content-mix','PUT',{scope:{targetId},rules:[{labelId,perWeek:1}],confirmation:`SAVE CONTENT MIX ${targetId}`});
    check(mixWrite.ok,'Scoped mix rule could not be saved.');
    const draft = await createPost('Disposable content mix candidate');
    await db.$executeRaw`INSERT INTO post_labels ("postId","labelId") VALUES (${draft},${labelId})`;
    stage = 'verify opt-in and current permissions through HTTP/MCP';
    const before = await runPublishingMix(new Date(),workspaceId);
    check(before.scheduled===0&&(await postState(draft))?.status==='draft','Mix scheduled without explicit workspace opt-in.');
    const wrong = await http('/api/publishing/content-mix','PUT',{action:'setAutoFill',enabled:true,confirmation:'incorrect'});
    check(wrong.status===400,'Autofill accepted an incorrect confirmation.');
    const readOnly = await rpc('set_content_mix_autofill',{enabled:true,confirmation:'ENABLE CONTENT MIX'},readBearer);
    check(readOnly.response.status===403||readOnly.body?.result?.isError||readOnly.body?.error,'Read-only MCP key enabled automatic scheduling.');
    const enabled = await rpc('set_content_mix_autofill',{enabled:true,confirmation:'ENABLE CONTENT MIX'});
    check(enabled.response.ok&&!enabled.body?.result?.isError&&!enabled.body?.error,'Authorized MCP autofill opt-in failed.');
    stage = 'run content mix and verify lifecycle history, system audit and idempotency';
    const mix = await runPublishingMix(new Date(),workspaceId);
    check(mix.scheduled===1&&mix.failed===0&&(await postState(draft))?.status==='scheduled','Content mix did not schedule exactly one candidate.');
    const again = await runPublishingMix(new Date(),workspaceId);
    check(again.scheduled===0&&again.failed===0,'Repeated content mix duplicated scheduling.');
    const history = await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM post_versions WHERE "postId"=${draft}`;
    const audit = await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=${workspaceId} AND "actorId" IS NULL AND action='publishing.post_scheduled_by_mix' AND detail->>'postId'=${draft}`;
    check(history[0]?.count>=BigInt(2)&&audit[0]?.count===BigInt(1),'Mix did not preserve history and truthful system attribution.');
    const paused = await http('/api/publishing/content-mix','PUT',{action:'setAutoFill',enabled:false,confirmation:'DISABLE CONTENT MIX'});
    check(paused.ok,'Explicit HTTP autofill pause failed.');
    stage = 'create labelled synthetic published source and configure recycling';
    const source = await createPost('Disposable previously published original');
    await db.$executeRaw`UPDATE posts SET status='published'::"PostStatus","publishedAt"=NOW(),"approvalStatus"='approved'::"ApprovalStatus" WHERE id=${source} AND "workspaceId"=${workspaceId}`;
    await db.$executeRaw`UPDATE post_targets SET status='published'::"PostTargetStatus" WHERE "postId"=${source}`;
    await db.$executeRaw`INSERT INTO post_labels ("postId","labelId") VALUES (${source},${labelId})`;
    const repeat = await http('/api/publishing/recycle','PUT',{postId:source,enabled:true,everyDays:1,limit:2,variants:['Disposable changed wording requires review'],confirmation:`SET RECYCLE ${source}`});
    check(repeat.ok,'Authorized recycle configuration failed.');
    await db.$executeRaw`UPDATE posts SET "recycleNextAt"=NOW()-interval '1 minute' WHERE id=${source} AND "workspaceId"=${workspaceId}`;
    const copyId = `rc_${source}_1`;
    createdPostIds.push(copyId); await persistRecoveryLedger('before scoped recycle worker');
    stage = 'verify recycle approval hold, copy history, labels and exact replay behavior';
    const recycle = await runPublishingRecycle(new Date(),workspaceId);
    const copy = await postState(copyId);
    check(recycle.failed===0&&recycle.created===1&&copy?.status==='pending_approval'&&copy.approvalStatus==='pending','Changed wording bypassed review or recycle did not create its single copy.');
    const copyLabels = await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM post_labels WHERE "postId"=${copyId} AND "labelId"=${labelId}`;
    const copyHistory = await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM post_versions WHERE "postId"=${copyId}`;
    check(copyLabels[0]?.count===BigInt(1)&&copyHistory[0]?.count===BigInt(1),'Recycled post lost labels or initial history.');
    const recycledAgain = await runPublishingRecycle(new Date(),workspaceId);
    check(recycledAgain.created===0&&recycledAgain.failed===0,'Recycle retried a completed cadence.');
    stage = 'verify author revocation leaves due source unchanged';
    await db.$executeRaw`UPDATE posts SET "recycleNextAt"=NOW()-interval '1 minute' WHERE id=${source}`;
    const beforeDenied = await db.$queryRaw<Array<{recycleCount:number;recycleNextAt:Date}>>`SELECT "recycleCount","recycleNextAt" FROM posts WHERE id=${source}`;
    await db.user.update({where:{id:ownerId},data:{disabledAt:new Date()}});
    const denied = await runPublishingRecycle(new Date(),workspaceId);
    const afterDenied = await db.$queryRaw<Array<{recycleCount:number;recycleNextAt:Date}>>`SELECT "recycleCount","recycleNextAt" FROM posts WHERE id=${source}`;
    check(denied.created===0&&JSON.stringify(beforeDenied)===JSON.stringify(afterDenied),'Revoked author/owner consumed a repeat.');
    await db.user.update({where:{id:ownerId},data:{disabledAt:null}});
    stage = 'verify last disabled destination stops a due repeat without consuming it';
    await db.target.update({where:{id:targetId},data:{enabled:false}});
    const stopped = await runPublishingRecycle(new Date(),workspaceId);
    const stoppedSource = await db.$queryRaw<Array<{recycleEnabled:boolean;recycleCount:number;recycleNextAt:Date|null}>>`SELECT "recycleEnabled","recycleCount","recycleNextAt" FROM posts WHERE id=${source}`;
    check(stopped.failed===0&&stopped.finished===1&&stopped.created===0&&stoppedSource[0]?.recycleEnabled===false&&stoppedSource[0]?.recycleNextAt===null&&stoppedSource[0]?.recycleCount===1,'Disabled destination did not stop repeat safely without consuming a new run.');
    const attempts = await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
    const remote = await db.postTarget.count({where:{postId:{in:createdPostIds},remotePostId:{not:null}}});
    check(attempts[0]?.count===BigInt(0)&&remote===0,'Automation initiated provider publication.');
    console.log('PASS: scoped worker mix/recycle, HTTP/MCP opt-in and refusals, Root defaults, approval hold, history/labels/system audits, repeat replay, revocation immutability, disabled-destination stop and no provider publication.');
  } finally {
    stage=`cleanup after ${stage}`; const errors:string[]=[];
    if (interrupted) await new Promise(resolve => setTimeout(resolve, 6000));
    async function cleanup(label:string, action:()=>Promise<unknown>){try{await action()}catch{errors.push(label)}}
    if(settingsCaptured&&rootWrites){
      for(const key of settingKeys){const old=settings.get(key);await cleanup(`Root setting ${key}`,async()=>{if(old)await db.appSetting.upsert({where:{key},create:{...old,value:old.value===null?Prisma.JsonNull:old.value as Prisma.InputJsonValue},update:{value:old.value===null?Prisma.JsonNull:old.value as Prisma.InputJsonValue,encrypted:old.encrypted,updatedAt:old.updatedAt}});else await db.appSetting.deleteMany({where:{key}})});}
      await cleanup('Root config audits',async()=>{const rows=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${ownerId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;const fresh=rows.map(row=>row.id).filter(id=>!oldRootAudits.has(id));if(fresh.length)await db.$executeRaw`DELETE FROM root_activities WHERE id=ANY(${fresh}::text[])`;const remaining=await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM root_activities WHERE "actorId"=${ownerId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;check(remaining[0]?.count===BigInt(oldRootAudits.size),'Synthetic Root config audit rows remain or prior rows changed.')});
    }
    const allFixturePostIds=[...createdPostIds,foreignPostId];
    if(fixtureStarted){
      await cleanup('workspace audit rows',()=>db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,foreignWorkspaceId]}::text[])`);
      await cleanup('content mix rules',()=>db.$executeRaw`DELETE FROM content_mix_rules WHERE \"workspaceId\"=${workspaceId}`);
      await cleanup('post labels',()=>db.$executeRaw`DELETE FROM post_labels WHERE \"postId\"=ANY(${allFixturePostIds}::text[])`);
      await cleanup('labels',()=>db.$executeRaw`DELETE FROM labels WHERE id=${labelId} AND \"workspaceId\"=${workspaceId}`);
      await cleanup('queue slots',()=>db.$executeRaw`DELETE FROM queue_slots WHERE "workspaceId"=${workspaceId}`);
      await cleanup('member page grants',()=>db.$executeRaw`DELETE FROM member_page_access WHERE "membershipId"=ANY(${[ownerMembershipId,contributorMembershipId,foreignMembershipId]}::text[])`);
      await cleanup('post version rows',()=>db.$executeRaw`DELETE FROM post_versions WHERE "postId"=ANY(${allFixturePostIds}::text[])`);
      await cleanup('post target rows',()=>db.postTarget.deleteMany({where:{postId:{in:allFixturePostIds}}}));
      await cleanup('synthetic posts',()=>db.post.deleteMany({where:{id:{in:allFixturePostIds}}}));
      await cleanup('MCP keys',()=>db.mcpApiKey.deleteMany({where:{id:{in:[ownerKeyId,readKeyId]}}}));
      await cleanup('sessions',()=>db.session.deleteMany({where:{id:{in:[sessionId,contributorSessionId]}}}));
      await cleanup('targets',()=>db.target.deleteMany({where:{id:{in:[targetId,foreignTargetId]}}}));
      await cleanup('social accounts',()=>db.socialAccount.deleteMany({where:{id:{in:[socialId,foreignSocialId]}}}));
      await cleanup('memberships',()=>db.membership.deleteMany({where:{userId:{in:[ownerId,contributorId]},workspaceId:{in:[workspaceId,foreignWorkspaceId]}}}));
      await cleanup('workspaces',()=>db.workspace.deleteMany({where:{id:{in:[workspaceId,foreignWorkspaceId]}}}));
      await cleanup('users',()=>db.user.deleteMany({where:{id:{in:[ownerId,contributorId]}}}));
      await cleanup('synthetic fixture verification',async()=>{
        const residual=await db.$queryRaw<Array<{count:bigint}>>`SELECT (SELECT COUNT(*) FROM posts WHERE id=ANY(${allFixturePostIds}::text[]))+(SELECT COUNT(*) FROM post_versions WHERE "postId"=ANY(${allFixturePostIds}::text[]))+(SELECT COUNT(*) FROM queue_slots WHERE "workspaceId"=${workspaceId})+(SELECT COUNT(*) FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,foreignWorkspaceId]}::text[])) AS count`;
        check(residual[0]?.count===BigInt(0)&&await db.user.count({where:{id:{in:[ownerId,contributorId]}}})===0&&await db.workspace.count({where:{id:{in:[workspaceId,foreignWorkspaceId]}}})===0
          &&await db.mcpApiKey.count({where:{id:{in:[ownerKeyId,readKeyId]}}})===0&&await db.session.count({where:{id:{in:[sessionId,contributorSessionId]}}})===0,
          'Synthetic queue identities, posts, versions, slots or audit rows remain after cleanup.');
      });
    }
    if(settingsCaptured&&rootWrites)await cleanup('exact Root setting restoration',async()=>{for(const key of settingKeys){const row=await db.appSetting.findUnique({where:{key},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(JSON.stringify(row)===JSON.stringify(settings.get(key)),`Root setting ${key} did not restore exactly.`)}});
    await db.$disconnect().catch(()=>errors.push('database disconnect'));
    if(errors.length===0&&recoveryLedgerSaved){await unlink(recoveryLedgerPath).catch(()=>errors.push('recovery ledger removal'));}
    check(errors.length===0, 'Cleanup or exact Root setting restoration failed.');
    console.log(`${postCount} synthetic draft fixture(s), queue slots, identities, memberships, MCP keys, audit rows, and exact prior Root settings restored and verified.`);
  }
}
main().catch(error=>{console.error(`Publishing automation probe failed at ${stage}: ${error instanceof ProbeFailure?error.message:`unexpected ${error instanceof Error?error.name:'local'} failure (details withheld)`}`);process.exitCode=1});
