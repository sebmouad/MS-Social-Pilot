import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { createFacebookEngine } from '../src/platforms/facebook/publishing';
import { facebookMediaJournal } from '../src/platforms/facebook/media-journal';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'guards';
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL, rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production' && rawDatabase === process.env.DATABASE_URL, 'Explicit matching isolated preview database and origin required.');
  const database = new URL(rawDatabase), origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host','hostaddr','socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview databases are permitted.');
  check(rawOrigin === 'http://localhost:3200' && origin.origin === rawOrigin, 'Only explicit localhost:3200 is permitted.');
  const db = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const prefix = `preview_media_evidence_${randomUUID().replaceAll('-', '')}`;
  const ownerId = 'preview_qa_user', workspaceId = prefix, userId = `${prefix}_user`, targetId = `${prefix}_target`, postId = `${prefix}_post`, postTargetId = `${prefix}_delivery`, operationId = randomUUID();
  const remoteTargetId = `${prefix}_page`, remotePostId = `${prefix}_feed`;
  const rootToken = randomBytes(32).toString('base64url'), memberToken = randomBytes(32).toString('base64url'), key = `mcp_${randomBytes(32).toString('base64url')}`;
  const sessionIds = [`${prefix}_root_session`, `${prefix}_member_session`], keyId = `${prefix}_key`, expiresAt = new Date(Date.now() + 300000);
  const rootCookie = `msp_session=${rootToken}; sp_workspace=${workspaceId}`, memberCookie = `msp_session=${memberToken}; sp_workspace=${workspaceId}`;
  const rpc = async (method: string, params: object, workspaceKey = false) => {
    const response = await fetch(`${origin.origin}/api/mcp?scope=${workspaceKey ? 'workspace' : 'installation'}`, { method: 'POST', headers: { 'content-type':'application/json', origin:origin.origin, ...(workspaceKey ? { authorization:`Bearer ${key}` } : { cookie:rootCookie }) }, body:JSON.stringify({ jsonrpc:'2.0', id:randomUUID(), method, params }), redirect:'manual' });
    const body = await response.json();
    return { response, body, data:body.result?.structuredContent };
  };
  const rootWrite = async (body: object) => fetch(`${origin.origin}/api/root/publication-attempts`, { method:'POST', headers:{ cookie:rootCookie, origin:origin.origin, 'content-type':'application/json' }, body:JSON.stringify(body), redirect:'manual' });
  let providerFixtureCalls = 0;
  try {
    check(await db.user.count({ where:{ id:ownerId, isInstanceOwner:true, disabledAt:null } }) === 1, 'Seeded active preview installation owner required.');
    const setting = await db.appSetting.findUnique({ where:{ key:'meta.graphBaseUrl' } });
    check(setting?.encrypted === false && setting.value === 'https://provider-preview.invalid', 'Synthetic unusable provider endpoint required.');
    stage = 'workspace fixture';
    await db.workspace.create({ data:{ id:workspaceId, slug:workspaceId, name:'Disposable media evidence workspace', timezone:'UTC' } });
    stage = 'user fixture';
    await db.user.create({ data:{ id:userId, email:`${prefix}@example.test`, name:'Disposable ordinary workspace owner', passwordHash:'unusable-preview-password' } });
    stage = 'membership fixture';
    await db.membership.create({ data:{ id:`${prefix}_membership`, userId, workspaceId, role:'owner' } });
    stage = 'session fixture';
    for (const [index, token] of [rootToken, memberToken].entries()) await db.session.create({ data:{ id:sessionIds[index]!, userId:index === 0 ? ownerId : userId, tokenHash:hashSessionToken(token)!, expiresAt, pending:null } });
    stage = 'key fixture';
    await db.mcpApiKey.create({ data:{ id:keyId, workspaceId, createdById:userId, name:'Disposable media evidence key', tokenHash:createHash('sha256').update(key).digest('hex'), tokenPrefix:key.slice(0,12), readFeatures:['publishing/posts'], writeFeatures:[], expiresAt } });
    stage = 'target fixture';
    await db.target.create({ data:{ id:targetId, workspaceId, providerId:remoteTargetId, type:'page', name:'Synthetic media evidence Page', enabled:true, canPublish:true, createdAt:new Date() } });
    stage = 'post fixture';
    await db.post.create({ data:{ id:postId, workspaceId, authorId:userId, message:'Disposable synthetic media evidence', media:[], status:'publishing', createdAt:new Date(), updatedAt:new Date(), targets:{ create:{ id:postTargetId, targetId, status:'processing' } } } });
    stage = 'parent intent fixture';
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state) VALUES (${operationId},${workspaceId},${postId},${postTargetId},${targetId},'facebook',${ownerId},'started')`;
    const fakeFetch: typeof fetch = async input => {
      check(new URL(String(input)).origin === 'https://provider-preview.invalid', 'Only synthetic transport fixture calls are allowed.');
      providerFixtureCalls++;
      return new Response(JSON.stringify({ id:providerFixtureCalls < 3 ? `${prefix}_photo_${providerFixtureCalls}` : remotePostId }), { status:200, headers:{ 'content-type':'application/json' } });
    };
    const engine = createFacebookEngine({ graphBaseUrl:'https://provider-preview.invalid', oauthBaseUrl:'https://provider-preview.invalid', graphVersion:'v99.0', requestTimeoutMs:2000, maxPages:2, pageSize:10, pageInsightMetrics:[], adInsightFields:[], maxImageUploadBytes:1024, allowedImageMimeTypes:['image/png'], appSecretProofEnabled:false }, fakeFetch, facebookMediaJournal);
    stage = 'durable engine';
    await engine.publish({ targetId:remoteTargetId, accessToken:'synthetic-unusable-token', operationId, text:'', media:[{ kind:'image', url:'https://example.test/first.png' },{ kind:'image', url:'https://example.test/second.png' }] });
    check(providerFixtureCalls === 3, 'One fixture request per photo and feed required.');
    const path = `/api/root/platform-publication-evidence?providerId=facebook&operationId=${operationId}`;
    stage = 'Root HTTP read';
    const read = await fetch(`${origin.origin}${path}`, { headers:{ cookie:rootCookie }, redirect:'manual' });
    check(read.headers.get('content-type')?.includes('application/json'), `Root HTTP returned non-JSON status ${read.status}; check preview server health.`);
    const evidence = await read.json();
    check(read.ok && read.headers.get('cache-control') === 'no-store' && evidence.items?.length === 3 && evidence.items.some((row: {remoteId:string}) => row.remoteId === remotePostId), 'Private Root HTTP must expose exact durable photo/feed receipts without workspace membership.');
    const serialized = JSON.stringify(evidence);
    check(!serialized.includes('synthetic-unusable-token') && !serialized.includes('https://example.test') && !serialized.includes('Disposable synthetic media evidence'), 'Evidence must exclude credentials, media URLs and post content.');
    check((await fetch(`${origin.origin}${path}`, { redirect:'manual' })).status === 401, 'Anonymous evidence read must be denied.');
    check((await fetch(`${origin.origin}${path}`, { headers:{ cookie:memberCookie }, redirect:'manual' })).status === 403, 'Workspace ownership must not confer installation evidence access.');
    stage = 'Root MCP tool';
    const tool = await rpc('tools/call', { name:'get_root_platform_publication_evidence', arguments:{ providerId:'facebook', operationId } });
    check(tool.response.ok && !tool.body.error && !tool.body.result?.isError && tool.data?.items?.length === 3, 'Private MCP evidence tool must match HTTP receipts.');
    stage = 'Root MCP resource';
    const resource = await rpc('resources/read', { uri:'msp://root/platform-publication-evidence' });
    check(!resource.body.error && JSON.parse(resource.body.result?.contents?.[0]?.text ?? '{}').providers?.some((panel: {providerId:string;items:Array<{operationId:string}>}) => panel.providerId === 'facebook' && panel.items.some(row => row.operationId === operationId)), 'Private aggregate MCP resource must expose the same evidence.');
    stage = 'workspace key denial';
    const workspaceIdentity = await rpc('initialize', {}, true);
    check(workspaceIdentity.response.ok && workspaceIdentity.body.result?.serverInfo && !workspaceIdentity.body.error, 'The workspace key must authenticate successfully before its Root access denial is tested.');
    const denied = await rpc('tools/call', { name:'get_root_platform_publication_evidence', arguments:{ providerId:'facebook', operationId } }, true);
    check(denied.body.error || denied.body.result?.isError || !denied.response.ok, 'A valid workspace key must never read private Root receipt evidence.');
    stage = 'absence denial';
    const absent = await rootWrite({ operationId, outcome:'ABSENT', verifiedExternally:true, confirmation:`ROOT RECORD PUBLICATION ${operationId} ABSENT` });
    check(absent.status === 409, 'External absence cannot override a durable feed receipt.');
    stage = 'mismatch denial';
    const wrong = await rootWrite({ operationId, outcome:'PUBLISHED', remotePostId:`${prefix}_wrong`, verifiedExternally:true, confirmation:`ROOT RECORD PUBLICATION ${operationId} PUBLISHED` });
    check(wrong.status === 409, 'A mismatched feed identity must be refused.');
    stage = 'receipt recovery';
    const recorded = await rootWrite({ operationId, outcome:'PUBLISHED', remotePostId, verifiedExternally:true, confirmation:`ROOT RECORD PUBLICATION ${operationId} PUBLISHED` });
    check(recorded.ok, 'Matching synthetic feed receipt must permit explicit local recovery.');
    stage = 'local projection';
    const finish = await rootWrite({ action:'finish', operationId, confirmation:`ROOT FINISH PUBLICATION ${operationId}` });
    check(finish.ok && (await db.postTarget.findUnique({ where:{ id:postTargetId }, select:{ remotePostId:true, status:true } }))?.remotePostId === remotePostId, 'Local projection must use the existing durable identity.');
    check(providerFixtureCalls === 3, 'Read and local recovery must never resend provider content.');
    console.log(JSON.stringify({ durableEngineReceipts:true, privateHttpMcpResourceParity:true, rootIndependentOfMembership:true, anonymousAndWorkspaceOwnerDenied:true, workspaceKeyDenied:true, absenceAndMismatchedReceiptDenied:true, matchingLocalRecovery:true, noProviderResend:true, realProviderRequests:false }));
  } finally {
    try {
      await db.$executeRaw`DELETE FROM rebuild_facebook_media_steps WHERE "workspaceId"=${workspaceId}`;
      await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
      await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
      await db.post.deleteMany({ where:{ workspaceId } });
      await db.target.deleteMany({ where:{ workspaceId } });
      await db.mcpApiKey.deleteMany({ where:{ id:keyId, workspaceId } });
      await db.session.deleteMany({ where:{ id:{ in:sessionIds } } });
      await db.membership.deleteMany({ where:{ workspaceId } });
      await db.workspace.deleteMany({ where:{ id:workspaceId } });
      await db.user.deleteMany({ where:{ id:userId } });
      check(await db.workspace.count({ where:{ id:workspaceId } }) === 0 && await db.user.count({ where:{ id:userId } }) === 0 && await db.session.count({ where:{ id:{ in:sessionIds } } }) === 0, 'Disposable media evidence fixtures must be removed.');
      console.log(JSON.stringify({ fixturesCleaned:true, globalSettingsChanged:false, noSecretsPrinted:true }));
    } finally { await db.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : `Facebook media evidence probe failed at ${stage}; sensitive details withheld.`); if (!(error instanceof ProbeFailure)) console.error(JSON.stringify({ errorType: error instanceof Error ? error.name : 'unknown', missingField: error instanceof Error ? /Argument `([A-Za-z0-9]+)` is missing/.exec(error.message)?.[1] ?? null : null })); process.exitCode=1; });
