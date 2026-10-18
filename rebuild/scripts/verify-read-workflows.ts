/** Guarded synthetic-only HTTP/MCP/PostgreSQL probe for Ads directory and Analytics read workflows. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = ['mcp.enabled','mcp.authenticatedRoles','entitlements.features.ads/objects','entitlements.features.ads/compare','entitlements.features.analytics/demographics','entitlements.features.analytics/compare','entitlements.features.analytics/pins','platforms.facebook.enabled'] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required.');
  const dbUrl = new URL(databaseUrl), base = new URL(origin);
  check(['postgres:','postgresql:'].includes(dbUrl.protocol) && ['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname) && decodeURIComponent(dbUrl.pathname).endsWith('_preview') && !['host','hostaddr','socket'].some(k => dbUrl.searchParams.has(k)), 'Only loopback PostgreSQL databases ending in _preview are allowed.');
  check(base.origin === origin && base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '3200', 'Only localhost:3200 HTTP preview is allowed.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_read_${randomUUID().replaceAll('-','')}`, userId = `${prefix}_user`, token = randomBytes(32).toString('base64url'), bearer = `mcp_${randomBytes(32).toString('base64url')}`, writeBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now()+1800000), today = new Date(); today.setUTCHours(0,0,0,0); const day = today.toISOString().slice(0,10);
  const settings = new Map<string, Setting|null>(); const previousRootAudits = new Set<string>(); let settingsCaptured = false, rootWrites = false, fixtureStarted = false;
  let workspaceId = '', workspaceBId = '', accountId = '', targetId = '', targetBId = '', socialId = '', socialBId = '', campaignInsightId = '', accountInsightId = '', previousInsightId = '', demoInsightId = '', pinInsightId = '';
  const cookie = (ws=workspaceId) => `msp_session=${token}; sp_workspace=${ws}`;
  const hash = (s:string) => createHash('sha256').update(s).digest('hex');
  async function json(r:Response):Promise<any>{try{return await r.json()}catch{return null}}
  async function http(path:string, method='GET', body?:unknown, ws=workspaceId) { return fetch(new URL(path,base),{method,redirect:'manual',headers:{origin:origin!,cookie:cookie(ws),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}); }
  async function rpc(name:string,args:unknown={}, auth=bearer) { const r=await fetch(new URL('/api/mcp?scope=workspace',base),{method:'POST',redirect:'manual',headers:{origin:origin!,'content-type':'application/json',authorization:`Bearer ${auth}`},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})}); return {r,b:await json(r)}; }
  async function save(key:string,value:unknown){rootWrites=true;const r=await fetch(new URL('/api/root/config',base),{method:'PUT',redirect:'manual',headers:{origin:origin!,cookie:cookie(), 'content-type':'application/json'},body:JSON.stringify({key,value})});const b=await json(r);check(r.ok&&b.schemaVersion===CONFIG_SCHEMA_VERSION,`Root setting ${key} did not save.`)}
  try {
    stage='preflight and capture exact Root settings';
    const tables=await db.$queryRaw<Array<{table_name:string}>>`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY(${['workspaces','users','memberships','sessions','mcp_api_keys','app_settings','root_activities','activity_logs','social_accounts','targets','page_insights','ad_accounts','ad_insights','member_page_access']}::text[])`;
    check(tables.length===14,`Required preview tables unavailable (${tables.length}/14); no fixtures written.`);
    const pre=await fetch(new URL('/sign-in',base),{redirect:'manual',signal:AbortSignal.timeout(5000)});check(pre.status<500,'Expected local preview did not respond.');
    for(const k of settingKeys){const s=await db.appSetting.findUnique({where:{key:k},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(!s||!s.encrypted,`Setting ${k} unexpectedly encrypted.`);settings.set(k,s)} settingsCaptured=true;
    const oldAudits=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`; oldAudits.forEach(x=>previousRootAudits.add(x.id));
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
    await db.session.create({data:{id:`${prefix}_session`,userId,tokenHash:hashLegacySessionToken(token)!,expiresAt,pending:null}});
    await db.mcpApiKey.create({data:{id:`${prefix}_key`,workspaceId,createdById:userId,name:'Disposable read probe',tokenHash:hash(bearer),tokenPrefix:bearer.slice(0,12),readFeatures:['ads/objects','ads/compare','analytics/demographics','analytics/compare','analytics/pins'],writeFeatures:[],expiresAt}});
    await db.mcpApiKey.create({data:{id:`${prefix}_write_key`,workspaceId,createdById:userId,name:'Disposable pins writer',tokenHash:hash(writeBearer),tokenPrefix:writeBearer.slice(0,12),readFeatures:['analytics/pins'],writeFeatures:['analytics/pins'],expiresAt}});
    stage='enable modules and seed synthetic stored insights';
    await save('mcp.enabled',true); await save('mcp.authenticatedRoles',['owner','admin']); await save('platforms.facebook.enabled',true);
    await save('entitlements.features.ads/objects',true); await save('entitlements.features.ads/compare',true); await save('entitlements.features.analytics/demographics',true); await save('entitlements.features.analytics/compare',true); await save('entitlements.features.analytics/pins',true);
    const fetchedAt=new Date(), at=new Date(`${day}T12:00:00.000Z`), previousDay=new Date(at.getTime()-86400000); campaignInsightId=`${prefix}_campaign`;accountInsightId=`${prefix}_account_current`;previousInsightId=`${prefix}_account_previous`;demoInsightId=`${prefix}_demo`;pinInsightId=`${prefix}_pin`;
    await db.adInsight.create({data:{id:campaignInsightId,adAccountId:accountId,level:'campaign',objectId:`${prefix}_campaign_obj`,objectName:'Synthetic campaign',date:at,spend:12.5,impressions:500,clicks:10,reach:400,cpc:1.25,cpm:25,cpp:null,ctr:2,frequency:1.25,actions:Prisma.JsonNull,fields:Prisma.JsonNull,fetchedAt}});
    await db.adInsight.createMany({data:[{id:accountInsightId,adAccountId:accountId,level:'account',objectId:`${prefix}_act`,objectName:'Synthetic ad account',date:at,spend:12.5,impressions:500,clicks:10,reach:400,cpc:1.25,cpm:25,cpp:null,ctr:2,frequency:1.25,actions:Prisma.JsonNull,fields:Prisma.JsonNull,fetchedAt},{id:previousInsightId,adAccountId:accountId,level:'account',objectId:`${prefix}_act`,objectName:'Synthetic ad account',date:previousDay,spend:9.5,impressions:400,clicks:8,reach:350,cpc:1.1875,cpm:23.75,cpp:null,ctr:2,frequency:1.1429,actions:Prisma.JsonNull,fields:Prisma.JsonNull,fetchedAt}]});
    await db.$executeRaw`INSERT INTO page_insights (id,"targetId",metric,period,"endTime",value,numeric,"fetchedAt") VALUES (${demoInsightId},${targetId},'page_fans_country', 'lifetime',${at},${JSON.stringify({US:12,CA:8})}::jsonb,NULL,${fetchedAt})`;
    await db.$executeRaw`INSERT INTO page_insights (id,"targetId",metric,period,"endTime",value,numeric,"fetchedAt") VALUES (${pinInsightId},${targetId},'page_fans', 'day',${at},${JSON.stringify(37)}::jsonb,37,${fetchedAt})`;
    stage='Ads directory HTTP/MCP read and input validation';
    const dir=await json(await http(`/api/ads/directory?level=campaign&period=custom&start=${day}&end=${day}&accountId=${accountId}`));check(dir.items?.some((x:any)=>x.objectId===`${prefix}_campaign_obj`&&x.spend===12.5),'Ads directory HTTP did not return stored synthetic campaign data.');
    const malformed=await http('/api/ads/directory?unknownFilter=1');check(malformed.status===400,'Ads directory accepted malformed filters.');
    const foreign=await http(`/api/ads/directory?level=campaign&period=custom&start=${day}&end=${day}&accountId=${prefix}_foreign`);check(foreign.status===409&&(await json(foreign))?.code==='unavailable','Ads directory did not deny an unavailable foreign account filter.');
    const mdir=await rpc('list_ads_objects',{level:'campaign',period:'custom',start:day,end:day,accountId});check(!mdir.b.result?.isError&&JSON.stringify(mdir.b).includes(`${prefix}_campaign_obj`),'Ads directory MCP read did not return stored synthetic data.');
    stage='Ads comparison HTTP/MCP read and filter denial';
    const adsCompareArgs={period:'custom',start:day,end:day,compare:'previous',accountId};
    const adsCompare=await json(await http(`/api/ads/compare?${new URLSearchParams(adsCompareArgs)}`));check(Array.isArray(adsCompare.groups)&&adsCompare.groups.some((g:any)=>g.totals?.spend===12.5&&g.previous?.spend===9.5),'Ads comparison HTTP did not return stored current and previous synthetic totals.');
    const adsCompareMcp=await rpc('compare_ads_performance',adsCompareArgs);check(!adsCompareMcp.b.result?.isError&&JSON.stringify(adsCompareMcp.b).includes('12.5')&&JSON.stringify(adsCompareMcp.b).includes('9.5'),'Ads comparison MCP did not return stored synthetic totals.');
    const badAdsCompare=await http(`/api/ads/compare?${new URLSearchParams({...adsCompareArgs,unexpected:'1'})}`);check(badAdsCompare.status===400,'Ads comparison accepted malformed filters.');
    const foreignAdsCompare=await http(`/api/ads/compare?${new URLSearchParams({...adsCompareArgs,accountId:`${prefix}_foreign_account`})}`);check(foreignAdsCompare.status===409&&(await json(foreignAdsCompare))?.code==='unavailable','Ads comparison accepted a foreign account filter.');
    stage='Analytics demographics/comparison and pins HTTP/MCP';
    const demo=await json(await http(`/api/analytics/demographics?start=${day}&end=${day}&filter=1&channel=${targetId}`));
    check(demo.ok===true&&JSON.stringify(demo).includes('page_fans_country')&&JSON.stringify(demo).includes('US'),'Demographics HTTP did not read stored breakdown rows.');
    const compare=await http('/api/analytics/comparison','POST',{mode:'period',a:{start:day,end:day},b:{start:day,end:day},channel:[targetId]});const cb=await json(compare);check(compare.ok&&cb.ok===true&&Array.isArray(cb.metrics)&&cb.metrics.length>0&&JSON.stringify(cb.metrics).includes('page_fans_country'),'Analytics comparison HTTP did not return the stored synthetic metric collection.');
    const mc=await rpc('compare_analytics',{mode:'period',a:{start:day,end:day},b:{start:day,end:day},channel:[targetId]});check(!mc.b.result?.isError&&mc.b.result?.structuredContent?.ok===true&&Array.isArray(mc.b.result?.structuredContent?.metrics)&&JSON.stringify(mc.b.result?.structuredContent?.metrics).includes('page_fans_country'),'Comparison MCP read failed.');
    const badCompare=await http('/api/analytics/comparison','POST',{mode:'period',a:{start:'bad',end:day},b:{start:day,end:day}});check(badCompare.status===400,'Comparison accepted malformed date filter.');
    const foreignCompare=await http('/api/analytics/comparison','POST',{mode:'period',a:{start:day,end:day},b:{start:day,end:day},channel:[targetBId]});check([400,403,404].includes(foreignCompare.status),'Comparison accepted a channel outside the authorized workspace.');
    const foreignDemographics=await http(`/api/analytics/demographics?start=${day}&end=${day}&filter=1&channel=${targetBId}`);check([400,403,404].includes(foreignDemographics.status),'Demographics exposed a channel outside the authorized workspace.');
    await save('entitlements.features.ads/compare',false);const gateHttp=await http(`/api/ads/compare?${new URLSearchParams(adsCompareArgs)}`);check(!gateHttp.ok,'Ads comparison HTTP ignored the disabled Root feature gate.');
    const gateMcp=await rpc('compare_ads_performance',adsCompareArgs);check(gateMcp.b.result?.isError===true,'Ads comparison MCP ignored the disabled Root feature gate.');
    await save('entitlements.features.ads/compare',true);
    const md=await rpc('get_analytics_demographics',{start:day,end:day,filter:'1',channel:[targetId]});check(!md.b.result?.isError&&JSON.stringify(md.b).includes('page_fans_country'),'Demographics MCP did not return stored breakdown.');
    const pinsBefore=await json(await http('/api/analytics/pins'));const metric=(pinsBefore.pinnable??[]).find((x:any)=>x.key?.includes('page_fans'))?.key;check(typeof metric==='string','No pinnable stored page metric was available.');
    const wrong=await http('/api/analytics/pins','POST',{action:'pin',key:metric,confirmation:'wrong'});check(wrong.status===400,'Pins accepted an incorrect confirmation.');
    const pinned=await http('/api/analytics/pins','POST',{action:'pin',key:metric,confirmation:`PIN ANALYTICS METRIC ${metric}`});check(pinned.ok&& (await db.$queryRaw<Array<{pinned:string[]}>>`SELECT "pinnedMetrics" AS pinned FROM users WHERE id=${userId}`)[0]?.pinned.includes(`v2:${metric}`),'Confirmed pin did not persist to user storage.');
    const pinRead=await rpc('get_analytics_pins',{});check(!pinRead.b.result?.isError&&JSON.stringify(pinRead.b).includes(metric),'Analytics pins MCP read did not include persisted pin.');
    stage='read-only and cross-tenant denial';
    const readOnly=await rpc('pin_analytics_metric',{key:metric,confirmation:`PIN ANALYTICS METRIC ${metric}`});check(readOnly.b.result?.isError===true&&JSON.stringify(readOnly.b).includes('forbidden'),'Read-only MCP key was allowed to pin a metric.');
    const mcpWrite=await rpc('pin_analytics_metric',{key:metric,confirmation:`PIN ANALYTICS METRIC ${metric}`},writeBearer);check(!mcpWrite.b.result?.isError&&await db.$queryRaw<Array<{pinned:string[]}>>`SELECT "pinnedMetrics" AS pinned FROM users WHERE id=${userId}`.then(x=>x[0]?.pinned.includes(`v2:${metric}`)),'Authorized MCP pin write did not persist the metric.');
    const mcpUnpin=await rpc('unpin_analytics_metric',{key:metric,confirmation:`UNPIN ANALYTICS METRIC ${metric}`},writeBearer);check(!mcpUnpin.b.result?.isError&&await db.$queryRaw<Array<{pinned:string[]}>>`SELECT "pinnedMetrics" AS pinned FROM users WHERE id=${userId}`.then(x=>!x[0]?.pinned.includes(`v2:${metric}`)),'Authorized MCP unpin did not remove the persisted metric.');
    check(await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action='analytics.pins_changed'`.then(x=>x[0]!.n>BigInt(0)),'Pin change was not durably audited.');
    console.log('PASS: localhost HTTP/MCP Ads directory and comparison, Analytics demographics/comparison/pins, Ads feature gates, malformed and foreign filters, pin confirmation/persistence, read-only MCP denial, authorized MCP pin/unpin, and cross-workspace resource scope verified.');
  } finally {
    stage=`cleanup after ${stage}`; const errors:string[]=[]; async function clean(label:string,fn:()=>Promise<unknown>){try{await fn()}catch{errors.push(label)}}
    if(settingsCaptured&&rootWrites){for(const k of settingKeys){const old=settings.get(k);await clean(`setting ${k}`,async()=>{if(old)await db.appSetting.upsert({where:{key:k},create:{...old,value:old.value===null?Prisma.JsonNull:old.value},update:{value:old.value===null?Prisma.JsonNull:old.value,encrypted:old.encrypted,updatedAt:old.updatedAt}});else await db.appSetting.deleteMany({where:{key:k}})});}}
    if(rootWrites&&fixtureStarted)await clean('synthetic Root config audits',async()=>{const rows=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;const fresh=rows.map(x=>x.id).filter(id=>!previousRootAudits.has(id));if(fresh.length)await db.$executeRaw`DELETE FROM root_activities WHERE id=ANY(${fresh}::text[])`;const remaining=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;check(remaining[0]!.n===BigInt(previousRootAudits.size),'Probe Root config audit rows remain or prior audit rows changed.')});
    if(fixtureStarted)await clean('synthetic workspace records',async()=>{
      await db.mcpApiKey.deleteMany({where:{id:{in:[`${prefix}_key`,`${prefix}_write_key`]}}});await db.session.deleteMany({where:{userId}});
      await db.adInsight.deleteMany({where:{id:{in:[campaignInsightId,accountInsightId,previousInsightId]}}});if(demoInsightId)await db.$executeRaw`DELETE FROM page_insights WHERE id=${demoInsightId}`;if(pinInsightId)await db.$executeRaw`DELETE FROM page_insights WHERE id=${pinInsightId}`;
      if(workspaceId){
        await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,workspaceBId]}::text[])`;
        await db.adAccount.deleteMany({where:{id:accountId}});
        await db.target.deleteMany({where:{id:{in:[targetId,targetBId]}}});
        await db.socialAccount.deleteMany({where:{id:{in:[socialId,socialBId]}}});
        await db.membership.deleteMany({where:{userId,workspaceId}});
        await db.workspace.deleteMany({where:{id:{in:[workspaceId,workspaceBId]}}});
      }
      await db.user.deleteMany({where:{id:userId}});
      const logs=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,workspaceBId]}::text[])`;
      const residualInsights=await db.$queryRaw<Array<{n:bigint}>>`SELECT (SELECT COUNT(*) FROM ad_insights WHERE id=ANY(${[campaignInsightId,accountInsightId,previousInsightId]}::text[]))+(SELECT COUNT(*) FROM page_insights WHERE id=ANY(${[demoInsightId,pinInsightId]}::text[])) AS n`;
      check(workspaceId!==''&&await db.workspace.count({where:{id:{in:[workspaceId,workspaceBId]}}})===0&&await db.user.count({where:{id:userId}})===0&&await db.session.count({where:{userId}})===0&&await db.mcpApiKey.count({where:{id:{in:[`${prefix}_key`,`${prefix}_write_key`]}}})===0&&await db.membership.count({where:{userId,workspaceId}})===0&&await db.socialAccount.count({where:{id:{in:[socialId,socialBId]}}})===0&&await db.target.count({where:{id:{in:[targetId,targetBId]}}})===0&&await db.adAccount.count({where:{id:accountId}})===0&&logs[0]!.n===BigInt(0)&&residualInsights[0]!.n===BigInt(0),'Synthetic workspace records, insight fixtures or audit rows remain after cleanup.');
    });
    if(settingsCaptured&&rootWrites)await clean('settings restoration verification',async()=>{for(const k of settingKeys){const x=await db.appSetting.findUnique({where:{key:k},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(JSON.stringify(x)===JSON.stringify(settings.get(k)),`Setting ${k} failed exact restoration.`)}});
    await db.$disconnect().catch(()=>errors.push('database disconnect'));check(errors.length===0,'Cleanup or exact Root setting restoration failed.');console.log('Both synthetic workspaces, users, sessions, memberships, MCP keys, social accounts, targets, ad account, insight fixtures, activity audits and exact prior Root settings restored and verified.');
  }
}
main().catch(error=>{console.error(`Read workflow probe failed at ${stage}: ${error instanceof ProbeFailure?error.message:`unexpected ${error instanceof Error ? error.name : 'local'} failure (details withheld)`}`);process.exitCode=1});
