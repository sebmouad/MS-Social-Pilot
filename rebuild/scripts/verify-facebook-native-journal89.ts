/** Guarded synthetic local HTTP/MCP/browser probe. No real provider requests. */
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {PrismaClient,Prisma} from '../generated/client';
import {hashSessionToken} from '../src/server/auth';
import {executeFacebookNativeWithJournal,type FacebookNativeJournalBinding} from '../src/platforms/facebook/formats/journal';
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
async function main(){
 const raw=process.env.REBUILD_PREVIEW_DATABASE_URL,origin=process.env.REBUILD_PREVIEW_ORIGIN;
 check(raw&&raw===process.env.DATABASE_URL&&origin==='http://localhost:3200'&&process.env.NODE_ENV!=='production','Explicit synthetic preview required');
 const url=new URL(raw);check(url.port==='55432'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname.endsWith('_preview')&&!['host','hostaddr','socket'].some(k=>url.searchParams.has(k)),'Guarded loopback database required');
 const db=new PrismaClient({datasources:{db:{url:raw}}});
 const owner='preview_qa_user',tag=`preview_native89_${randomUUID().replaceAll('-','')}`,operationId=randomUUID();
 const token=randomBytes(32).toString('base64url'),regularToken=randomBytes(32).toString('base64url'),key='platforms.facebook.enabled';
 const cookie=`msp_session=${token}; sp_workspace=preview_workspace`;
 const regularCookie=`msp_session=${regularToken}; sp_workspace=${tag}`;
 const scope:FacebookNativeJournalBinding={workspaceId:tag,operationId,postId:`${tag}_post`,postTargetId:`${tag}_pt`,targetId:`${tag}_target`,actorId:owner,remoteTargetId:`synthetic_${tag}`,sourceFormatId:'future_reel'};
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,settingsChanged=false,baselineCaptured=false;
 let original:Awaited<ReturnType<typeof db.appSetting.findUnique>>=null;const auditBaseline=new Set<string>();
 const rpc=async(name:string,args:object={},scope='installation',selectedCookie=cookie)=>{
  const res=await fetch(`${origin}/api/mcp?scope=${scope}`,{method:'POST',headers:{origin,cookie:selectedCookie,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})});
  check(res.headers.get('cache-control')==='no-store','MCP must not cache');return res.json();
 };
 try{
  check(await db.user.findFirst({where:{id:owner,isInstanceOwner:true,disabledAt:null}}),'Synthetic Root owner required');
  check((await fetch(`${origin}/api/root/platform-publication-evidence?providerId=facebook`)).status===401,'Anonymous Root read refused');
  original=await db.appSetting.findUnique({where:{key}});
  for(const row of await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`)auditBaseline.add(row.id);
  baselineCaptured=true;
  await db.workspace.create({data:{id:tag,name:'Disposable native receipt probe',slug:tag,timezone:'UTC'}});
  await db.user.create({data:{id:`${tag}_user`,email:`${tag}@example.invalid`,name:'Synthetic ordinary owner',passwordHash:'not-a-login'}});
  await db.membership.createMany({data:[{id:`${tag}_m1`,workspaceId:tag,userId:owner,role:'owner'},{id:`${tag}_m2`,workspaceId:tag,userId:`${tag}_user`,role:'owner'}]});
  await db.socialAccount.create({data:{id:`${tag}_source`,workspaceId:tag,provider:'facebook',providerUserId:tag,name:'Synthetic source',accessToken:'synthetic-not-a-provider-credential'}});
  await db.target.create({data:{id:scope.targetId,workspaceId:tag,socialAccountId:`${tag}_source`,type:'page',providerId:scope.remoteTargetId,name:'Synthetic native test Page',enabled:true,canPublish:true,createdAt:new Date()}});
  await db.post.create({data:{id:scope.postId,workspaceId:tag,authorId:owner,message:'Identifiable disposable native journal probe',status:'publishing',createdAt:new Date(),updatedAt:new Date()}});
  await db.postTarget.create({data:{id:scope.postTargetId,postId:scope.postId,targetId:scope.targetId,status:'processing',formatId:scope.sourceFormatId}});
  await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state) VALUES (${operationId},${tag},${scope.postId},${scope.postTargetId},${scope.targetId},'facebook',${owner},'started')`;
  let starts=0,uploads=0;
  const outcome=await executeFacebookNativeWithJournal(scope,{format:'reel',targetId:scope.remoteTargetId,description:'Synthetic test',media:{kind:'video',url:'https://example.invalid/synthetic.mp4',sizeBytes:3}},
   {database:db,limits:async()=>({timeout:10000,maxWait:5000}),transport:{postGraph:async()=>{starts++;return {video_id:'native89_synthetic_upload',upload_url:'https://example.invalid/upload'};},upload:async()=>{uploads++;throw Error('Identifiable synthetic uncertain transfer');}}});
  check(outcome.status==='uncertain'&&starts===1&&uploads===1,'Synthetic uncertain phase must remain held');
  await db.$executeRaw`UPDATE rebuild_publication_attempts SET state='uncertain',reason='outcome_unknown' WHERE id=${operationId}`;
  await db.session.createMany({data:[{id:`${tag}_session`,userId:owner,tokenHash:hashSessionToken(token)!,pending:null,expiresAt:new Date(Date.now()+600000)},
   {id:`${tag}_regular_session`,userId:`${tag}_user`,tokenHash:hashSessionToken(regularToken)!,pending:null,expiresAt:new Date(Date.now()+600000)}]});
  const endpoint=`${origin}/api/root/platform-publication-evidence?providerId=facebook&operationId=${operationId}`;
  check((await fetch(endpoint,{headers:{cookie:regularCookie}})).status===403,'Workspace owner must not acquire Root access');
  const response=await fetch(endpoint,{headers:{cookie}});check(response.ok&&response.headers.get('cache-control')==='no-store','Root API must return no-store evidence');
  const evidence=await response.json();check(evidence.items?.length===1&&evidence.items[0].recordType==='native'&&evidence.items[0].knownIds==='native89_synthetic_upload','Root API must expose held native evidence');
  const rows=await db.$queryRaw<Array<{ownerToken:string;revision:number}>>`SELECT "ownerToken",revision FROM rebuild_facebook_native_journal WHERE "workspaceId"=${tag} AND "operationId"=${operationId}`;
  check(rows.length===1&&!JSON.stringify(evidence).includes(rows[0].ownerToken)&&!JSON.stringify(evidence).includes('synthetic-not-a-provider-credential'),'Root output must withhold fences and credentials');
  const mcp=await rpc('get_root_platform_publication_evidence',{providerId:'facebook',operationId});
  check(mcp.result?.structuredContent?.items?.[0]?.knownIds==='native89_synthetic_upload','Installation MCP must match Root API evidence');
  check((await rpc('get_root_platform_publication_evidence',{providerId:'facebook',operationId},'workspace')).result?.isError===true,'Workspace MCP must not read Root evidence');
  const rejected=await rpc('run_root_platform_publication_action',{providerId:'facebook',actionId:'resolve_native_post',subjectId:operationId,confirmation:'INVALID TEST ACTION',acknowledged:true});
  check(rejected.result?.isError===true,'Undeclared native write action must be refused');
  check((await fetch(endpoint,{method:'POST',headers:{origin:'https://outside.invalid',cookie,'content-type':'application/json'},body:'{}'})).status===403,'Cross-origin Root action refused');
  settingsChanged=true;
  check((await rpc('set_root_config',{key,value:false,confirmation:`SET ROOT CONFIG ${key}`})).result?.structuredContent?.saved===true,'Disable fixture platform with audited Root control');
  check((await fetch(endpoint,{headers:{cookie}})).ok,'Installed safety evidence must remain visible while platform disabled');
  browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'localhost,127.0.0.1,[::1]'}});
  let views=0;
  for(const {width,theme} of (['grove','coast','clay','nightfall'] as const).flatMap(theme=>[1440,390].map(width=>({width,theme})))){
   const context=await browser.newContext({viewport:{width,height:950}});
   try{
    await context.addCookies([{name:'msp_session',value:token,url:origin,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();await page.goto(`${origin}/root/platforms/facebook?operationId=${operationId}`,{waitUntil:'networkidle'});
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    const heading=page.getByRole('heading',{name:'Facebook publication evidence',exact:true});await heading.waitFor();
    const section=page.locator('section').filter({has:heading}).last();await section.scrollIntoViewIfNeeded();
    check(await section.getByText('native89_synthetic_upload',{exact:true}).count()===1,'Root browser must show the native receipt');
    check(await section.getByText('uncertain',{exact:true}).count()>0,'Root browser must show the held outcome');
    check(await section.locator('.root-publication-evidence__actions button').count()===0,'Unimplemented native write controls stay absent');
    check(await section.getByRole('columnheader',{name:'Evidence row',exact:true}).count()===0,'Opaque row IDs must stay in receipt details');
    await page.screenshot({path:`/private/tmp/native89-root-${theme}-${width}-summary.png`,animations:'disabled'});
    const summary=section.locator('summary').filter({hasText:'View receipt details'});await summary.focus();await summary.press('Enter');
    check(await summary.evaluate(element=>element.parentElement?.hasAttribute('open')),'Receipt details must open from keyboard');
    check(await section.getByText('native89_synthetic_upload',{exact:true}).isVisible(),'Expanded receipt details must show the retained upload ID');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);check(!overflow,'Root evidence must not widen document');
    if(width===390){const filter=page.getByLabel('Publication operation ID',{exact:true});await filter.scrollIntoViewIfNeeded();check(await filter.inputValue()===operationId,'Operation filter must keep its value in-page');check(await filter.evaluate(element=>Boolean(element.closest('main'))),'Operation filter must live in the page, not the menu drawer');}
    await page.screenshot({path:`/private/tmp/native89-root-${theme}-${width}.png`,animations:'disabled'});views++;
   }finally{await context.close();}
  }
  const final=await db.$queryRaw<Array<{revision:number}>>`SELECT revision FROM rebuild_facebook_native_journal WHERE "workspaceId"=${tag} AND "operationId"=${operationId}`;
  check(final[0].revision===rows[0].revision,'Read/refusal checks must not mutate native evidence');
  console.log(JSON.stringify({rootApi:true,installationMcp:true,workspaceAndAnonymousDenied:true,fenceAndCredentialPrivacy:true,unknownWritesAndCrossOriginDenied:true,evidenceSurvivesPlatformDisable:true,browserViews:views,providerRequests:false}));
 }finally{
  const errors:string[]=[];
  try{await browser?.close();}catch{errors.push('browser');}
  try{if(settingsChanged){const restored=await rpc('set_root_config',{key,value:original?.value??true,confirmation:`SET ROOT CONFIG ${key}`});check(restored.result?.structuredContent?.saved===true,'Runtime setting restore failed');
    if(original)await db.appSetting.update({where:{key},data:{value:original.value as Prisma.InputJsonValue,encrypted:original.encrypted,updatedAt:original.updatedAt}});else await db.appSetting.deleteMany({where:{key}});
    check(JSON.stringify(await db.appSetting.findUnique({where:{key}}))===JSON.stringify(original),'Exact setting restore failed');}}catch{errors.push('setting');}
  try{if(baselineCaptured){const entries=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`;const ids=entries.filter(row=>!auditBaseline.has(row.id)).map(row=>row.id);
    if(ids.length)await db.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${owner} AND id=ANY(${ids}::text[])`;
    const remaining=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM root_activities WHERE "actorId"=${owner} AND action='config.changed' AND detail->>'key'=${key}`;check(remaining.length===auditBaseline.size&&remaining.every(row=>auditBaseline.has(row.id)),'Scoped audit cleanup failed');}}catch{errors.push('audit');}
  try{await db.session.deleteMany({where:{id:{in:[`${tag}_session`,`${tag}_regular_session`]}}});
   await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${tag}`;
   await db.postTarget.deleteMany({where:{post:{workspaceId:tag}}});await db.post.deleteMany({where:{workspaceId:tag}});await db.target.deleteMany({where:{workspaceId:tag}});
   await db.socialAccount.deleteMany({where:{workspaceId:tag}});await db.membership.deleteMany({where:{workspaceId:tag}});await db.workspace.deleteMany({where:{id:tag}});await db.user.deleteMany({where:{id:`${tag}_user`}});
   check(await db.workspace.count({where:{id:tag}})===0&&await db.session.count({where:{id:{startsWith:tag}}})===0,'Fixture cleanup failed');}catch{errors.push('fixtures');}
  await db.$disconnect();check(errors.length===0,`Synthetic cleanup incomplete: ${errors.join(',')}`);
  console.log(JSON.stringify({syntheticFixturesCleaned:true,rootSettingAndAuditsRestoredExactly:true}));
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Native journal probe failed');process.exitCode=1;});
