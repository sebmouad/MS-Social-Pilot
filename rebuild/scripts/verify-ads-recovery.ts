/** Guarded synthetic-only HTTP/MCP/PostgreSQL probe for Ads operation history/recovery without provider writes. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = ['mcp.enabled','mcp.authenticatedRoles','entitlements.features.ads/campaigns','ads.managementEnabled','platforms.facebook.enabled'] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required.');
  const dbUrl = new URL(databaseUrl), base = new URL(origin);
  check(['postgres:','postgresql:'].includes(dbUrl.protocol) && ['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname) && decodeURIComponent(dbUrl.pathname).endsWith('_preview') && !['host','hostaddr','socket'].some(k => dbUrl.searchParams.has(k)), 'Only loopback PostgreSQL databases ending in _preview are allowed.');
  check(base.origin === origin && base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '3200', 'Only localhost:3200 HTTP preview is allowed.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_ads_recovery_${randomUUID().replaceAll('-','')}`, userId = `${prefix}_user`, token = randomBytes(32).toString('base64url'), bearer = `mcp_${randomBytes(32).toString('base64url')}`, writeBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now()+1800000), today = new Date(); today.setUTCHours(0,0,0,0); const day = today.toISOString().slice(0,10);
  const recoveryPath = `/private/tmp/${prefix}-recovery.json`; let ledgerWritten = false;
  const settings = new Map<string, Setting|null>(); const previousRootAudits = new Set<string>(); let settingsCaptured = false, rootWrites = false, fixtureStarted = false;
  let workspaceId = '', workspaceBId = '', accountId = '', targetId = '', targetBId = '', socialId = '', socialBId = '', campaignInsightId = '', accountInsightId = '', previousInsightId = '', demoInsightId = '', demoImpressionsInsightId = '', pinInsightId = '';
  const cookie = (ws=workspaceId) => `msp_session=${token}; sp_workspace=${ws}`;
  const hash = (s:string) => createHash('sha256').update(s).digest('hex');
  async function json(r:Response):Promise<any>{try{return await r.json()}catch{return null}}
  async function http(path:string, method='GET', body?:unknown, ws=workspaceId) { return fetch(new URL(path,base),{signal:AbortSignal.timeout(20000),method,redirect:'manual',headers:{origin:origin!,cookie:cookie(ws),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}); }
  async function rpc(name:string,args:unknown={}, auth=bearer) { const r=await fetch(new URL('/api/mcp?scope=workspace',base),{signal:AbortSignal.timeout(20000),method:'POST',redirect:'manual',headers:{origin:origin!,'content-type':'application/json',authorization:`Bearer ${auth}`},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})}); return {r,b:await json(r)}; }
  async function save(key:string,value:unknown){rootWrites=true;const r=await fetch(new URL('/api/root/config',base),{signal:AbortSignal.timeout(20000),method:'PUT',redirect:'manual',headers:{origin:origin!,cookie:cookie(), 'content-type':'application/json'},body:JSON.stringify({key,value})});const b=await json(r);check(r.ok&&b.schemaVersion===CONFIG_SCHEMA_VERSION,`Root setting ${key} did not save.`)}
  try {
    stage='preflight and capture exact Root settings';
    const tables=await db.$queryRaw<Array<{table_name:string}>>`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY(${['workspaces','users','memberships','sessions','mcp_api_keys','app_settings','root_activities','activity_logs','social_accounts','targets','page_insights','ad_accounts','ad_insights','member_page_access','ads_management_operations']}::text[])`;
    check(tables.length===15,`Required preview tables unavailable (${tables.length}/15); no fixtures written.`);
    const pre=await fetch(new URL('/sign-in',base),{redirect:'manual',signal:AbortSignal.timeout(5000)});check(pre.status<500,'Expected local preview did not respond.');
    for(const k of settingKeys){const s=await db.appSetting.findUnique({where:{key:k},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(!s||!s.encrypted,`Setting ${k} unexpectedly encrypted.`);settings.set(k,s)} settingsCaptured=true;
    const oldAudits=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`; oldAudits.forEach(x=>previousRootAudits.add(x.id));
    await writeFile(recoveryPath, JSON.stringify({ prefix, userId, settings: [...settings], capturedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' }); ledgerWritten = true;
    fixtureStarted=true;
    await db.user.create({data:{id:userId,email:`${userId}@example.test`,name:'Disposable read workflow probe',passwordHash:'unusable-preview-password',isInstanceOwner:true,totpEnabledAt:new Date()}});
    workspaceId=`${prefix}_workspace`;workspaceBId=`${prefix}_workspace_b`;socialId=`${prefix}_social`;socialBId=`${prefix}_social_b`;accountId=`${prefix}_account`;targetId=`${prefix}_target`;targetBId=`${prefix}_target_b`;
    await db.workspace.create({data:{id:workspaceId,slug:workspaceId,name:'Disposable read workflow workspace',timezone:'UTC'}});
    await db.workspace.create({data:{id:workspaceBId,slug:workspaceBId,name:'Disposable foreign read workflow workspace',timezone:'UTC'}});
    await db.socialAccount.create({data:{id:socialId,workspaceId,provider:'facebook',providerUserId:`${prefix}_provider`,name:'Disposable Facebook connection',accessToken:'synthetic-no-credential'}});
    await db.socialAccount.create({data:{id:socialBId,workspaceId:workspaceBId,provider:'facebook',providerUserId:`${prefix}_provider_b`,name:'Disposable foreign Facebook connection',accessToken:'synthetic-no-credential'}});
    await db.target.create({data:{id:targetId,workspaceId,socialAccountId:socialId,type:'page',providerId:`${prefix}_page`,name:'Disposable analytics page',enabled:true,canPublish:false,createdAt:new Date()}});
    await db.target.create({data:{id:targetBId,workspaceId:workspaceBId,socialAccountId:socialBId,type:'page',providerId:`${prefix}_page_b`,name:'Foreign disposable analytics page',enabled:true,canPublish:false,createdAt:new Date()}});
    await db.adAccount.create({data:{id:accountId,workspaceId,socialAccountId:socialId,actId:`${prefix}_act`,name:'Disposable ad account',currency:'USD',enabled:true}});
    await db.membership.create({data:{id:`${prefix}_membership`,userId,workspaceId,role:'owner'}});
    await db.session.create({data:{id:`${prefix}_session`,userId,tokenHash:hashSessionToken(token)!,expiresAt,pending:null}});
    await db.mcpApiKey.create({data:{id:`${prefix}_key`,workspaceId,createdById:userId,name:'Disposable read probe',tokenHash:hash(bearer),tokenPrefix:bearer.slice(0,12),readFeatures:['ads/campaigns'],writeFeatures:[],expiresAt}});
    await db.mcpApiKey.create({data:{id:`${prefix}_write_key`,workspaceId,createdById:userId,name:'Disposable Ads recovery writer',tokenHash:hash(writeBearer),tokenPrefix:writeBearer.slice(0,12),readFeatures:['ads/campaigns'],writeFeatures:['ads/campaigns'],expiresAt}});
    stage='enable local history and MCP without enabling provider writes';
    await save('mcp.enabled',true); await save('mcp.authenticatedRoles',['owner','admin']);
    await save('platforms.facebook.enabled',true); await save('entitlements.features.ads/campaigns',true); await save('ads.managementEnabled',false);
    const pendingId=`${prefix}_pending`, uncertainId=`${prefix}_uncertain`, campaignCreationId=`${prefix}_campaign_creation`, adSetCreationId=`${prefix}_adset_creation`;
    for (const [id,status] of [[pendingId,'pending'],[uncertainId,'uncertain']] as const) {
      await db.$executeRaw`INSERT INTO ads_management_operations (id,"workspaceId","adAccountId","actorId","requestId","requestHash","operationType","objectType","objectId",params,status) VALUES (${id},${workspaceId},${accountId},${userId},${id},${'a'.repeat(64)},'rename','ad',${id},${JSON.stringify({type:'rename',objectType:'ad',objectId:id,name:'Disposable recovery fixture'})}::jsonb,${status})`;
    }
    for (const [id, kind, objectId, status] of [[campaignCreationId,'campaign','@create-campaign','pending'],[adSetCreationId,'adset','@create-adset:synthetic-parent','uncertain']] as const) {
      const operationType = `${kind}.create`;
      const params = kind === 'campaign' ? { type: operationType, objectType: kind, name: 'Disposable creation recovery', objective: 'OUTCOME_TRAFFIC' } : { type: operationType, objectType: kind, parentId: 'synthetic-parent', name: 'Disposable creation recovery', dailyBudgetMinor: 100, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' };
      await db.$executeRaw`INSERT INTO ads_management_operations (id,"workspaceId","adAccountId","actorId","requestId","requestHash","operationType","objectType","objectId",params,status) VALUES (${id},${workspaceId},${accountId},${userId},${id},${'b'.repeat(64)},${operationType},${kind},${objectId},${JSON.stringify(params)}::jsonb,${status})`;
    }
    stage='read authenticated history through HTTP and MCP';
    const history=await http('/api/ads/management?view=changes'); const historyBody=await json(history);
    check(history.ok&&historyBody.items?.some((row:any)=>row.id===pendingId&&row.needsResolution&&row.resolutionKind==='pending_recovery'),'HTTP pending recovery metadata missing.');
    const mcpHistory=await rpc('list_ads_changes',{}); check(!mcpHistory.b.result?.isError&&mcpHistory.b.result?.structuredContent?.items?.some((row:any)=>row.id===uncertainId),'MCP history differs from own workspace.');
    stage='verify confirmations, read-only key refusal and cross-workspace scope';
    const wrong=await http('/api/ads/management','POST',{action:'resolve',operationId:pendingId,resolution:'not_applied',confirmation:'RESOLVE ADS CHANGE wrong AS NOT APPLIED'});check(wrong.status===400,'Incorrect pending recovery confirmation accepted.');
    const readonly=await rpc('resolve_ads_change',{operationId:pendingId,resolution:'not_applied',confirmation:`RECOVER ADS CHANGE ${pendingId} AS NOT APPLIED`});check(readonly.b.result?.isError===true,'Read-only key recovered an operation.');
    const foreign=await http('/api/ads/management','POST',{action:'resolve',operationId:`${prefix}_foreign`,resolution:'applied',confirmation:`RESOLVE ADS CHANGE ${prefix}_foreign AS APPLIED`});check(foreign.status>=400,'Foreign/nonexistent operation accepted.');
    stage='retained disabled account remains inspectable and recoverable';
    await db.adAccount.update({where:{id:accountId},data:{enabled:false}});
    await db.socialAccount.update({where:{id:socialId},data:{invalidatedAt:new Date()}});
    const retained=await json(await http('/api/ads/management?view=changes'));check(retained.items?.some((row:any)=>row.id===pendingId),'Retained disconnected account history hidden.');
    const recovered=await http('/api/ads/management','POST',{action:'resolve',operationId:pendingId,resolution:'not_applied',confirmation:`RECOVER ADS CHANGE ${pendingId} AS NOT APPLIED`});const recoveredBody=await json(recovered);check(recovered.ok&&recoveredBody.recoveredPending===true&&recoveredBody.status==='resolved_not_applied','HTTP pending recovery did not settle the retained account.');
    const resolved=await rpc('resolve_ads_change',{operationId:uncertainId,resolution:'applied',confirmation:`RESOLVE ADS CHANGE ${uncertainId} AS APPLIED`},writeBearer);check(!resolved.b.result?.isError&&resolved.b.result?.structuredContent?.status==='resolved_applied','Authorized MCP uncertain attestation failed.');
    stage='recover creation journals through HTTP and MCP without inventing remote receipts';
    const creationRecovered = await http('/api/ads/management','POST',{action:'resolve',operationId:campaignCreationId,resolution:'not_applied',confirmation:`RECOVER ADS CHANGE ${campaignCreationId} AS NOT APPLIED`});
    const creationBody=await json(creationRecovered);
    check(creationRecovered.ok&&creationBody.status==='resolved_not_applied','HTTP creation pending recovery failed.');
    const creationAttested=await rpc('resolve_ads_change',{operationId:adSetCreationId,resolution:'applied',confirmation:`RESOLVE ADS CHANGE ${adSetCreationId} AS APPLIED`},writeBearer);
    const attestedBody=creationAttested.b.result?.structuredContent;
    check(!creationAttested.b.result?.isError&&attestedBody?.status==='resolved_applied'&&!attestedBody.created&&!attestedBody.remoteId,'MCP creation attestation invented a remote creation receipt.');
    const rows=await db.$queryRaw<Array<{id:string;status:string}>>`SELECT id,status FROM ads_management_operations WHERE "workspaceId"=${workspaceId}`;
    check(rows.some(row=>row.id===pendingId&&row.status==='resolved_not_applied')&&rows.some(row=>row.id===uncertainId&&row.status==='resolved_applied'),'Recovery outcomes not stored.');
    const audits=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM root_activities WHERE detail->>'workspaceId'=${workspaceId} AND action='ads.change_resolved'`;
    check(audits[0]?.n===BigInt(4),'Recovery audit count differs from four reviewed changes.');
    stage='feature-off refusal covers HTTP and MCP';
    await save('entitlements.features.ads/campaigns',false);
    const deniedHttp=await http('/api/ads/management?view=changes'), deniedMcp=await rpc('list_ads_changes',{});
    check(!deniedHttp.ok&&deniedMcp.b.result?.isError===true,'Disabled Ads feature did not refuse API and MCP.');
    console.log('PASS: actual HTTP/MCP history, read-only/confirmation/foreign refusals, retained-account pending recovery, uncertain attestation, campaign/ad-set creation recovery without invented remote receipts, persisted states/audits and feature gate; no provider write.');

  } finally {
    stage=`cleanup after ${stage}`; const errors:string[]=[]; async function clean(label:string,fn:()=>Promise<unknown>){try{await fn()}catch{errors.push(label)}}
    if(settingsCaptured&&rootWrites){for(const k of settingKeys){const old=settings.get(k);await clean(`setting ${k}`,async()=>{if(old)await db.appSetting.upsert({where:{key:k},create:{...old,value:old.value===null?Prisma.JsonNull:old.value},update:{value:old.value===null?Prisma.JsonNull:old.value,encrypted:old.encrypted,updatedAt:old.updatedAt}});else await db.appSetting.deleteMany({where:{key:k}})});}}
    if(rootWrites&&fixtureStarted)await clean('synthetic Root config audits',async()=>{const rows=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;const fresh=rows.map(x=>x.id).filter(id=>!previousRootAudits.has(id));if(fresh.length)await db.$executeRaw`DELETE FROM root_activities WHERE id=ANY(${fresh}::text[])`;const remaining=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;check(remaining[0]!.n===BigInt(previousRootAudits.size),'Probe Root config audit rows remain or prior audit rows changed.')});
    if(fixtureStarted)await clean('synthetic workspace records',async()=>{
      await db.mcpApiKey.deleteMany({where:{id:{in:[`${prefix}_key`,`${prefix}_write_key`]}}});await db.session.deleteMany({where:{userId}});
      await db.$executeRaw`DELETE FROM ads_management_operations WHERE "workspaceId"=${workspaceId}`;
      await db.adInsight.deleteMany({where:{id:{in:[campaignInsightId,accountInsightId,previousInsightId]}}});if(demoInsightId)await db.$executeRaw`DELETE FROM page_insights WHERE id=${demoInsightId}`;if(demoImpressionsInsightId)await db.$executeRaw`DELETE FROM page_insights WHERE id=${demoImpressionsInsightId}`;if(pinInsightId)await db.$executeRaw`DELETE FROM page_insights WHERE id=${pinInsightId}`;
      if(workspaceId){
        await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=ANY(${[workspaceId,workspaceBId]}::text[])`;
        await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,workspaceBId]}::text[])`;
        await db.adAccount.deleteMany({where:{id:accountId}});
        await db.target.deleteMany({where:{id:{in:[targetId,targetBId]}}});
        await db.socialAccount.deleteMany({where:{id:{in:[socialId,socialBId]}}});
        await db.membership.deleteMany({where:{userId,workspaceId}});
        await db.workspace.deleteMany({where:{id:{in:[workspaceId,workspaceBId]}}});
      }
      await db.user.deleteMany({where:{id:userId}});
      const logs=await db.$queryRaw<Array<{n:bigint}>>`SELECT ((SELECT COUNT(*) FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,workspaceBId]}::text[]))+(SELECT COUNT(*) FROM root_activities WHERE detail->>'workspaceId'=ANY(${[workspaceId,workspaceBId]}::text[])))::bigint AS n`;
      const residualInsights=await db.$queryRaw<Array<{n:bigint}>>`SELECT (SELECT COUNT(*) FROM ad_insights WHERE id=ANY(${[campaignInsightId,accountInsightId,previousInsightId]}::text[]))+(SELECT COUNT(*) FROM page_insights WHERE id=ANY(${[demoInsightId,demoImpressionsInsightId,pinInsightId]}::text[])) AS n`;
      check(workspaceId!==''&&await db.workspace.count({where:{id:{in:[workspaceId,workspaceBId]}}})===0&&await db.user.count({where:{id:userId}})===0&&await db.session.count({where:{userId}})===0&&await db.mcpApiKey.count({where:{id:{in:[`${prefix}_key`,`${prefix}_write_key`]}}})===0&&await db.membership.count({where:{userId,workspaceId}})===0&&await db.socialAccount.count({where:{id:{in:[socialId,socialBId]}}})===0&&await db.target.count({where:{id:{in:[targetId,targetBId]}}})===0&&await db.adAccount.count({where:{id:accountId}})===0&&logs[0]!.n===BigInt(0)&&residualInsights[0]!.n===BigInt(0),'Synthetic workspace records, insight fixtures or audit rows remain after cleanup.');
    });
    if(settingsCaptured&&rootWrites)await clean('settings restoration verification',async()=>{for(const k of settingKeys){const x=await db.appSetting.findUnique({where:{key:k},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(JSON.stringify(x)===JSON.stringify(settings.get(k)),`Setting ${k} failed exact restoration.`)}});
    if(errors.length===0&&ledgerWritten)await clean('recovery ledger removal',()=>unlink(recoveryPath));
    if(errors.length)console.error('Private recovery ledger retained; cleanup requires review.');
    await db.$disconnect().catch(()=>errors.push('database disconnect'));check(errors.length===0,'Cleanup or exact Root setting restoration failed.');console.log('Both synthetic workspaces, users, sessions, memberships, MCP keys, social accounts, targets, ad account, insight fixtures, activity audits and exact prior Root settings restored and verified.');
  }
}
main().catch(error=>{console.error(`Ads recovery probe failed at ${stage}: ${error instanceof ProbeFailure?error.message:`unexpected ${error instanceof Error ? error.name : 'local'} failure (details withheld)`}`);process.exitCode=1});
