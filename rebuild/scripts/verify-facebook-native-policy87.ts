/** Synthetic local Root/API/MCP/browser verification; never calls a provider. */
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Prisma,PrismaClient} from '../generated/client';
import {hashSessionToken} from '../src/server/auth';
function check(value:unknown,label:string):asserts value {if(!value)throw Error(label);}
async function main(){
 const raw=process.env.REBUILD_PREVIEW_DATABASE_URL,origin=process.env.REBUILD_PREVIEW_ORIGIN;
 check(raw&&raw===process.env.DATABASE_URL&&origin==='http://localhost:3200'&&process.env.NODE_ENV!=='production','Explicit synthetic preview required');
 const u=new URL(raw);check(['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.port==='55432'&&u.pathname.endsWith('_preview')&&!['host','hostaddr','socket'].some(k=>u.searchParams.has(k)),'Guarded preview database required');
 const db=new PrismaClient({datasources:{db:{url:raw}}});
 const owner='preview_qa_user',tag=`preview_native87_${randomUUID()}`,token=randomBytes(32).toString('base64url'),key='facebook.native.maxResponseBytes';
 let original:Awaited<ReturnType<typeof db.appSetting.findUnique>>=null,changed=false,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 const baseline=new Set<string>(),diagnosticIds=new Set<string>();let sessionCreated=false,baselineCaptured=false;
 const cookie=`msp_session=${token}; sp_workspace=preview_workspace`;
 const rpc=async(name:string,args:object={},scope='installation')=>{
  const response=await fetch(`${origin}/api/mcp?scope=${scope}`,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})});
  check(response.headers.get('cache-control')==='no-store','MCP responses must not cache');return await response.json();
 };
 try{
  check(await db.user.findFirst({where:{id:owner,isInstanceOwner:true,disabledAt:null}}),'Synthetic Root owner required');
  original=await db.appSetting.findUnique({where:{key}});
  for(const row of await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`)baseline.add(row.id);
  baselineCaptured=true;
  await db.session.create({data:{id:tag,userId:owner,tokenHash:hashSessionToken(token)!,pending:null,expiresAt:new Date(Date.now()+600000)}});sessionCreated=true;
  check((await fetch(`${origin}/api/root/config`)).status===401,'Unauthenticated Root settings must be denied');
  const metadata=await rpc('get_root_config');const config=metadata.result?.structuredContent;
  check(config?.schemaVersion>=76&&Array.isArray(config.definitions),'MCP must expose current Root registry');
  const native=config.definitions.filter((d:{key:string})=>d.key.startsWith('facebook.native.'));
  check(native.length===25&&native.every((d:{owner:{kind:string;id:string};consumption:string})=>d.owner.kind==='platform'&&d.owner.id==='facebook'&&d.consumption==='configured'),'Every native setting must belong to Facebook with honest availability');
  check((await rpc('set_root_config',{key,value:2048,confirmation:'wrong'})).result?.isError===true,'MCP write requires exact confirmation');
  check((await rpc('set_root_config',{key,value:0,confirmation:`SET ROOT CONFIG ${key}`})).result?.isError===true,'Invalid transport limit must be refused');
  check((await rpc('get_root_config',{},'workspace')).result?.isError===true,'Workspace MCP must not discover installation configuration');
  changed=true;check((await rpc('set_root_config',{key,value:2048,confirmation:`SET ROOT CONFIG ${key}`})).result?.structuredContent?.saved===true,'Root MCP must save validated transport policy');
  check((await db.appSetting.findUnique({where:{key}}))?.value===2048,'MCP change must persist');
  const bad=await fetch(`${origin}/api/root/config`,{method:'PUT',headers:{origin:'https://outside.invalid',cookie,'content-type':'application/json'},body:JSON.stringify({key,value:4096})});check(bad.status===403,'Cross-origin config writes must be refused');
  const audits=await db.$queryRaw<Array<{id:string;detail:Prisma.JsonValue}>>`SELECT id,detail FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`;
  check(audits.some(row=>!baseline.has(row.id)&&(row.detail as Record<string,unknown>).schemaVersion===76),'Configuration change needs a versioned audit');
  const diagnostic=await rpc('run_root_diagnostics',{scope:'platform:facebook',confirmation:'RUN DIAGNOSTICS platform:facebook'});
  const receipt=diagnostic.result?.structuredContent;
  if(typeof receipt?.id==='string'){diagnosticIds.add(`${receipt.id}_started`);diagnosticIds.add(`${receipt.id}_completed`);}
  check(receipt?.auditRecorded===true&&receipt.checks?.some((c:{id:string;code:string})=>c.id==='native_configuration'&&c.code==='native_policy_valid'),'Root diagnostics must validate native policy without a connection');
  check(receipt.checks.filter((c:{id:string})=>['identity','grants','channels','ad_accounts'].includes(c.id)).every((c:{status:string})=>c.status==='skipped'),'Provider reads must remain skipped without connection selection');
  browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'localhost,127.0.0.1,[::1]'}});
  let views=0;
  for(const [width,theme] of [[1440,'nightfall'],[390,'grove']] as const){
   const context=await browser.newContext({viewport:{width,height:950}});
   try{
    await context.addCookies([{name:'msp_session',value:token,url:origin,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();await page.goto(`${origin}/root/platforms/facebook`,{waitUntil:'networkidle'});
    await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
    if(width<600)await page.getByRole('button',{name:'Menu & filters',exact:true}).click();
    await page.getByLabel('Find a setting',{exact:true}).fill(key);
    if(width<600)await page.locator('.shell-context-close').click();
    const input=page.getByRole('spinbutton',{name:'Native response maximum (bytes)',exact:true});await input.waitFor();
    check(await input.inputValue()==='2048','Root UI must reflect the MCP-saved value');
    check(await page.getByText('Stored; runtime wiring pending',{exact:false}).count()>0,'Root must not advertise customer readiness');
    const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,className:el.className,right:el.getBoundingClientRect().right}))}));
    if(overflow.scrollWidth>width+1){console.error(JSON.stringify({overflow}));await page.screenshot({path:'/private/tmp/native87-overflow.png',fullPage:true,animations:'disabled'});}
    check(overflow.scrollWidth<=width+1,'Root policy UI must fit the viewport');
    await page.screenshot({path:`/private/tmp/native87-root-${width}.png`,fullPage:true,animations:'disabled'});views++;
   }finally{await context.close();}
  }
  console.log(JSON.stringify({rootPolicyOwned:true,mcpConfirmedWrite:true,invalidAndCrossOriginDenied:true,workspaceScopeDenied:true,versionedAudit:true,localDiagnostic:true,providerReadsSkipped:true,browserViews:views,providerWrites:false}));
 }finally{
  const errors:string[]=[];
  try{await browser?.close();}catch{errors.push('browser');}
  try{if(changed){if(original)await db.appSetting.update({where:{key},data:{value:original.value as Prisma.InputJsonValue,encrypted:original.encrypted,updatedAt:original.updatedAt}});else await db.appSetting.deleteMany({where:{key}});}
   check(JSON.stringify(await db.appSetting.findUnique({where:{key}}))===JSON.stringify(original),'Root setting restore failed');}catch{errors.push('setting');}
  try{if(baselineCaptured){const rows=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`;const ids=[...rows.filter(row=>!baseline.has(row.id)).map(row=>row.id),...diagnosticIds];if(ids.length)await db.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${owner} AND id=ANY(${ids}::text[])`;const remaining=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`;check(remaining.length===baseline.size&&remaining.every(row=>baseline.has(row.id)),'Audit cleanup failed');if(diagnosticIds.size){const left=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM root_activities WHERE "actorId"=${owner} AND id=ANY(${[...diagnosticIds]}::text[])`;check(left[0]?.n===BigInt(0),'Diagnostic audit cleanup failed');}}}catch{errors.push('audit');}
  try{if(sessionCreated)await db.session.deleteMany({where:{id:tag,userId:owner}});check(await db.session.count({where:{id:tag}})===0,'Session cleanup failed');}catch{errors.push('session');}
  try{await db.$disconnect();}catch{errors.push('database');}
  check(errors.length===0,`Synthetic cleanup incomplete: ${errors.join(',')}`);console.log(JSON.stringify({rootSettingRestoredExactly:true,syntheticSessionAndAuditsCleaned:true}));
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Native policy verification failed');process.exitCode=1;});
