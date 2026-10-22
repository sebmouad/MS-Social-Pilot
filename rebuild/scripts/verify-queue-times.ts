/** Guarded synthetic-only HTTP/MCP/PostgreSQL probe for queue times and queued post scheduling. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
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
  'publishing.collab.versionRetention', 'publishing.collab.queueSlotLimit', 'publishing.collab.queueLookaheadDays', 'publishing.queue.defaultSlot',
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
  const prefix = `preview_queue_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `${prefix}_workspace`, foreignWorkspaceId = `${prefix}_foreign_workspace`, ownerId = `${prefix}_owner`, contributorId = `${prefix}_contributor`;
  const ownerMembershipId = `${prefix}_owner_membership`, contributorMembershipId = `${prefix}_contributor_membership`, foreignMembershipId = `${prefix}_foreign_membership`;
  const sessionId = `${prefix}_session`, contributorSessionId = `${prefix}_contributor_session`, socialId = `${prefix}_social`, targetId = `${prefix}_target`, foreignSocialId = `${prefix}_foreign_social`, foreignTargetId = `${prefix}_foreign_target`;
  const ownerKeyId = `${prefix}_owner_key`, readKeyId = `${prefix}_read_key`;
  const createdPostIds: string[] = [], foreignPostId = `${prefix}_foreign_post`;
  const sessionToken = randomBytes(32).toString('base64url'), contributorSessionToken = randomBytes(32).toString('base64url'), ownerBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const readBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000), settings = new Map<string, Setting | null>(), oldRootAudits = new Set<string>();
  let settingsCaptured = false, rootWrites = false, fixtureStarted = false, postCount = 0, recoveryLedgerSaved = false;
  const recoveryLedgerPath = `/private/tmp/${prefix}-recovery.json`;
  async function persistRecoveryLedger(phase: string) {
    let operation = 'serialize';
    const ledger = {
      probe: 'verify-queue-times', phase, prefix, capturedAt: new Date().toISOString(),
      settings: [...settings.values()].filter((row): row is Setting => row !== null).map(row => ({ ...row })),
      absentSettings: [...settings.entries()].filter(([, row]) => row === null).map(([key]) => key),
      priorRootAuditIds: [...oldRootAudits],
      fixtureIds: { workspaceId, foreignWorkspaceId, ownerId, contributorId, sessionId, contributorSessionId, ownerMembershipId, contributorMembershipId, foreignMembershipId, socialId, targetId, foreignSocialId, foreignTargetId, ownerKeyId, readKeyId, foreignPostId, createdPostIds: [...createdPostIds] },
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
    const requiredTables = ['workspaces','users','memberships','sessions','mcp_api_keys','app_settings','root_activities','activity_logs','social_accounts','targets','posts','post_targets','post_versions','queue_slots','member_page_access'];
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY(${requiredTables}::text[])`;
    check(tables.length === requiredTables.length, `Required preview tables unavailable (${tables.length}/${requiredTables.length}); no fixtures written.`);
    stage = 'check localhost preview preflight';
    const preflight = await fetchGuarded(new URL('/sign-in', base), { redirect: 'manual' });
    check(preflight.status < 500, 'Expected localhost preview is not responding.');
    stage = 'capture exact Root setting rows';
    for (const key of settingKeys) {
      const row = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!row || !row.encrypted, `Root setting ${key} unexpectedly contains encrypted data.`); settings.set(key, row);
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
    await db.session.create({ data: { id: sessionId, userId: ownerId, tokenHash: hashSessionToken(sessionToken)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: contributorSessionId, userId: contributorId, tokenHash: hashSessionToken(contributorSessionToken)!, expiresAt, pending: null } });
    await db.socialAccount.create({ data: { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Disposable queue connection', accessToken: 'synthetic-no-credential', scopes: 'pages_manage_posts' } });
    await db.socialAccount.create({ data: { id: foreignSocialId, workspaceId: foreignWorkspaceId, provider: 'facebook', providerUserId: `${prefix}_foreign_provider`, name: 'Disposable foreign queue connection', accessToken: 'synthetic-no-credential', scopes: 'pages_manage_posts' } });
    await db.target.create({ data: { id: targetId, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${prefix}_page`, name: 'Disposable queue channel', accessToken: 'synthetic-no-credential', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.target.create({ data: { id: foreignTargetId, workspaceId: foreignWorkspaceId, socialAccountId: foreignSocialId, type: 'page', providerId: `${prefix}_foreign_page`, name: 'Disposable foreign queue channel', accessToken: 'synthetic-no-credential', enabled: true, canPublish: true, createdAt: new Date() } });
    const features = ['publishing/posts', 'publishing/queue', 'publishing/collaboration'];
    for (const [id, user, token, writable] of [[ownerKeyId, ownerId, ownerBearer, true], [readKeyId, ownerId, readBearer, false]] as const) {
      await db.mcpApiKey.create({ data: { id, workspaceId, createdById: user, name: 'Disposable queue workflow key', tokenHash: sha256(token), tokenPrefix: token.slice(0,12), readFeatures: features, writeFeatures: writable ? features : [], expiresAt } });
    }
    await db.$executeRaw`UPDATE memberships SET "allPages"=true WHERE id=${ownerMembershipId}`;
    await db.$executeRaw`UPDATE memberships SET "allPages"=false WHERE id=${contributorMembershipId}`;

    stage = 'enable the current Root queue policies and publishing features';
    await saveSetting('mcp.enabled', true); await saveSetting('mcp.authenticatedRoles', ['owner','admin']);
    await saveSetting('platforms.facebook.enabled', true);
    await saveSetting('entitlements.features.publishing/posts', true); await saveSetting('entitlements.features.publishing/queue', true); await saveSetting('entitlements.features.publishing/collaboration', true);
    await saveSetting('publishing.collab.versionRetention', 20); await saveSetting('publishing.collab.queueSlotLimit', 100); await saveSetting('publishing.collab.queueLookaheadDays', 30);
    await saveSetting('publishing.queue.defaultSlot', { dayOfWeek: 4, hour: 13, minute: 45 });
    stage = 'verify Root queue default reaches rendered editor HTML';
    const queuePage = await http('/content/queue');
    const queuePageHtml = await queuePage.text();
    const renderedDefaultTime = /<input\b[^>]*\btype="time"[^>]*\bvalue="13:45"|<input\b[^>]*\bvalue="13:45"[^>]*\btype="time"/.test(queuePageHtml);
    const renderedWorkspaceTimezone = queuePageHtml.replace(/<!--[\s\S]*?-->/g, '').includes('The workspace timezone is UTC.');
    check(queuePage.ok && renderedDefaultTime && renderedWorkspaceTimezone,
      `Queue editor HTML did not render Root default and workspace timezone (status=${queuePage.status}, time=${renderedDefaultTime}, timezone=${renderedWorkspaceTimezone}).`);

    stage = 'verify queue time HTTP/MCP reads and saved shared/channel timetables';
    const initialRead = await http(`/api/publishing/queue-slots?targetId=${targetId}`), initialBody = await json(initialRead);
    check(initialRead.ok && initialBody.canEditChannels === true && initialBody.canEditShared === true, 'Queue time HTTP read did not expose the owner channel/shared controls.');
    const mcpRead = await rpc('list_queue_times', { targetId });
    check(!mcpRead.body?.result?.isError && mcpRead.body?.result?.structuredContent?.slots, 'Queue time MCP read failed.');
    const now = new Date();
    const firstDay = new Date(now.getTime() + 2 * 86400000), secondDay = new Date(now.getTime() + 3 * 86400000), thirdDay = new Date(now.getTime() + 4 * 86400000);
    const slot = (date: Date, hour: number, minute: number) => ({ dayOfWeek: date.getUTCDay(), hour, minute });
    const sharedSlots = [slot(firstDay, 13, 7)];
    const fourthDay = new Date(now.getTime() + 5 * 86400000);
    const channelSlots = [slot(firstDay, 13, 11), slot(secondDay, 13, 17), slot(thirdDay, 13, 23), slot(fourthDay, 13, 29)];
    await saveQueue(null, sharedSlots); await saveQueue(targetId, channelSlots);
    const savedRead = await json(await http(`/api/publishing/queue-slots?targetId=${targetId}`));
    check(savedRead.slots.some((row:any)=>row.targetId===null&&row.dayOfWeek===sharedSlots[0]!.dayOfWeek&&row.hour===13&&row.minute===7)
      && savedRead.slots.filter((row:any)=>row.targetId===targetId).length===4, 'Shared and channel queue times did not persist via the HTTP service.');
    const mcpSaved = await rpc('list_queue_times', { targetId });
    check(!mcpSaved.body?.result?.isError&&mcpSaved.body?.result?.structuredContent?.slots?.length===5, 'MCP did not return the saved shared and channel times.');
    const mcpReplace = await rpc('replace_queue_times', { targetId, slots: channelSlots, confirmation: `REPLACE QUEUE TIMES ${targetId}` });
    check(!mcpReplace.body?.result?.isError&&await queueSlotCount(targetId)===4, 'MCP queue time replacement did not persist.');
    const mcpSharedReplace = await rpc('replace_queue_times', { targetId: null, slots: sharedSlots, confirmation: 'REPLACE QUEUE TIMES SHARED' });
    check(!mcpSharedReplace.body?.result?.isError&&await queueSlotCount(null)===1, 'MCP shared queue time replacement did not persist.');

    stage = 'verify missing confirmation, read-only denial, and empty timetable leaves draft unchanged';
    const noSlotPost = await createPost('Disposable queue no-slot draft');
    await saveQueue(targetId, []); await saveQueue(null, []);
    const wrong = await queueMcp(noSlotPost, ownerBearer, 'QUEUE POST wrong');
    check(wrong.body?.result?.isError===true&&(await postState(noSlotPost))?.status==='draft', 'Queue action accepted a wrong confirmation or changed the draft.');
    const readOnly = await queueMcp(noSlotPost, readBearer);
    check(readOnly.body?.result?.isError===true&&JSON.stringify(readOnly.body).includes('forbidden')&&(await postState(noSlotPost))?.status==='draft', 'Read-only MCP key queued a post.');
    const noSlot = await queueMcp(noSlotPost);
    check(noSlot.body?.result?.isError===true&&JSON.stringify(noSlot.body).includes('conflict')&&(await postState(noSlotPost))?.status==='draft'
      &&(await postState(noSlotPost))?.scheduledAt===null, 'Queue with no available slots did not fail without changing the draft.');
    await saveQueue(null, sharedSlots); await saveQueue(targetId, channelSlots);

    stage = 'queue two posts concurrently without channel slot collision';
    const firstPost = await createPost('Disposable concurrent queue A'), secondPost = await createPost('Disposable concurrent queue B');
    const concurrent = await Promise.all([queueMcp(firstPost), queueMcp(secondPost)]);
    const concurrentEntries = [{ id: firstPost, result: concurrent[0]! }, { id: secondPost, result: concurrent[1]! }];
    const retries: Array<{ id: string; result: Awaited<ReturnType<typeof queueMcp>> }> = [];
    for (const entry of concurrentEntries) {
      if (!entry.result.body?.result?.isError) continue;
      const code = entry.result.body?.result?.structuredContent?.code ?? entry.result.body?.error?.data?.code;
      const state = await postState(entry.id);
      const attempts = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action='publishing.post_queued' AND detail->>'postId'=${entry.id}`;
      check(code==='conflict'&&state?.status==='draft'&&state.scheduledAt===null&&attempts[0]?.count===BigInt(0), 'Concurrent queue returned an unexpected or ambiguous failure; refusing automatic retry.');
      const retried = await queueMcp(entry.id);
      check(!retried.body?.result?.isError, 'Queue retry after a clear conflict did not complete.');
      retries.push({ id: entry.id, result: retried });
    }
    check(concurrentEntries.every(entry=>!entry.result.body?.result?.isError||retries.some(retry=>retry.id===entry.id)), 'A concurrent queue request neither succeeded nor received a safe conflict retry.');
    const firstState = await postState(firstPost), secondState = await postState(secondPost);
    check(firstState?.status==='scheduled'&&secondState?.status==='scheduled'&&firstState.scheduledAt instanceof Date&&secondState.scheduledAt instanceof Date
      && firstState.scheduledAt.getTime()!==secondState.scheduledAt.getTime(), 'Concurrent queue actions selected colliding or invalid slots.');
    const successfulReceipts=[...concurrentEntries.filter(entry=>!entry.result.body?.result?.isError).map(entry=>entry.result),...retries.map(retry=>retry.result)];
    check(successfulReceipts.some(result=>result.body?.result?.structuredContent?.scheduledAt===firstState.scheduledAt?.toISOString())
      && successfulReceipts.some(result=>result.body?.result?.structuredContent?.scheduledAt===secondState.scheduledAt?.toISOString()), 'MCP queue receipts do not match persisted scheduled times.');
    const concurrencyAudit=await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action='publishing.post_queued' AND detail->>'postId'=ANY(${[firstPost,secondPost]}::text[])`;
    check(concurrencyAudit[0]?.count===BigInt(2), 'Concurrent queue/retry lifecycle did not persist exactly one audit per post.');

    stage = 'deny foreign workspace and unauthorized channel posts';
    await db.post.create({ data: { id: foreignPostId, workspaceId: foreignWorkspaceId, authorId: ownerId, message: 'Foreign disposable draft', status: 'draft', createdAt: new Date(), updatedAt: new Date() } });
    await persistRecoveryLedger('foreign draft created');
    const foreignDenied = await queueMcp(foreignPostId);
    check(foreignDenied.body?.result?.isError===true&&(await postState(foreignPostId))?.status==='draft', 'MCP queue accepted a post from another workspace.');
    const contributorPost = await createPost('Disposable contributor queue draft');
    await db.post.update({ where: { id: contributorPost }, data: { authorId: contributorId } });
    await db.$executeRaw`DELETE FROM member_page_access WHERE "membershipId"=${contributorMembershipId} AND "targetId"=${targetId}`;
    const scopeDenied = await contributorHttp('/api/publishing/queue', 'POST', { postId: contributorPost, confirmation: `QUEUE POST ${contributorPost}` });
    check(!scopeDenied.ok&&(await postState(contributorPost))?.status==='draft', 'Contributor queue ignored the current channel grant.');
    await db.$executeRaw`INSERT INTO member_page_access ("membershipId","targetId") VALUES (${contributorMembershipId},${targetId})`;

    stage = 'queue approval-required contributor post and verify snapshot, audit and no publication';
    const contributorQueued = await contributorHttp('/api/publishing/queue', 'POST', { postId: contributorPost, confirmation: `QUEUE POST ${contributorPost}` });
    const queuedReceipt = await json(contributorQueued), contributorState = await postState(contributorPost);
    check(contributorQueued.ok&&queuedReceipt?.status==='pending_approval'&&contributorState?.status==='pending_approval'
      &&contributorState.approvalStatus==='pending'&&contributorState.scheduledAt instanceof Date,
      'Approval-required contributor queue must remain pending approval with its future reserved time.');
    const queueVersions = await db.$queryRaw<Array<{ message:string; scheduledAt:Date|null }>>`SELECT message,"scheduledAt" FROM post_versions WHERE "postId"=${contributorPost} ORDER BY "createdAt" DESC,id DESC LIMIT 3`;
    check(queueVersions.some(row=>row.message==='Disposable contributor queue draft'&&row.scheduledAt===null)
      && queueVersions.some(row=>row.message==='Disposable contributor queue draft'&&row.scheduledAt?.getTime()===contributorState.scheduledAt?.getTime()), 'Queue lifecycle did not persist before/after version snapshots.');
    const queueAudit = await db.$queryRaw<Array<{ count:bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action='publishing.post_queued' AND detail->>'postId'=${contributorPost}`;
    check(queueAudit[0]?.count===BigInt(1), 'Queue action did not persist exactly one domain audit.');
    const httpPost = await createPost('Disposable HTTP queue draft');
    const httpQueuedResponse = await http('/api/publishing/queue', 'POST', { postId: httpPost, confirmation: `QUEUE POST ${httpPost}` });
    const httpQueued = await json(httpQueuedResponse), httpQueuedState = await postState(httpPost);
    check(httpQueuedResponse.ok&&httpQueued?.postId===httpPost&&httpQueued?.status==='scheduled'&&typeof httpQueued?.scheduledAt==='string'
      &&httpQueuedState?.scheduledAt?.toISOString()===httpQueued.scheduledAt, 'HTTP queue action did not return and persist its scheduled result.');
    const allQueued = [...createdPostIds];
    const publicationAttempts=await db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM rebuild_publication_attempts WHERE "postId"=ANY(${allQueued}::text[])`;
    const deliveryRows=await db.$queryRaw<Array<{status:string;remotePostId:string|null;publishedAt:Date|null}>>`SELECT status::text AS status,"remotePostId","publishedAt" FROM post_targets WHERE "postId"=ANY(${allQueued}::text[])`;
    check(publicationAttempts[0]?.count===BigInt(0)&&deliveryRows.every(row=>row.status==='pending'&&row.remotePostId===null&&row.publishedAt===null), 'Queue operation initiated publication or changed provider delivery state.');
    console.log('PASS: queue policy, HTTP/MCP saved shared/channel slots, exact confirmation, no-slot immutability, read-only/cross-workspace/channel-scope denial, concurrent non-colliding allocation, contributor approval hold, snapshots/audit and no publication verified.');
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
main().catch(error=>{console.error(`Queue time probe failed at ${stage}: ${error instanceof ProbeFailure?error.message:`unexpected ${error instanceof Error?error.name:'local'} failure (details withheld)`}`);process.exitCode=1});
