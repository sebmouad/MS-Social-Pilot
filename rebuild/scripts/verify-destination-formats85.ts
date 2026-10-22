/** Guarded local-only browser verification. Synthetic drafts only; no provider calls. */
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Prisma,PrismaClient} from '../generated/client';
import {hashSessionToken} from '../src/server/auth';
import {CONFIG_BY_KEY} from '../src/lib/config/registry';
function check(value:unknown,label:string):asserts value{if(!value)throw Error(label);}
async function main(){
 const raw=process.env.REBUILD_PREVIEW_DATABASE_URL,origin=process.env.REBUILD_PREVIEW_ORIGIN;
 check(raw&&raw===process.env.DATABASE_URL&&origin==='http://localhost:3200'&&process.env.NODE_ENV!=='production','Explicit local preview required');
 const url=new URL(raw);check(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname.endsWith('_preview')&&!['host','hostaddr','socket'].some(k=>url.searchParams.has(k)),'Guarded synthetic database required');
 const db=new PrismaClient({datasources:{db:{url:raw}}});
 const owner='preview_qa_user',workspace='preview_workspace',channel='preview_target_north';
 const tag=`preview_formats85_${randomUUID()}`,sessionId=`${tag}_session`,token=randomBytes(32).toString('base64url');
 const proofKey='meta.appSecretProofEnabled';let changed=false,original:Awaited<ReturnType<typeof db.appSetting.findUnique>>=null;
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  check(await db.user.findFirst({where:{id:owner,isInstanceOwner:true,disabledAt:null}}),'Synthetic installation owner required');
  const endpoint=await db.appSetting.findUnique({where:{key:'meta.graphBaseUrl'}});
  check(typeof endpoint?.value==='string'&&new URL(endpoint.value).hostname.endsWith('.invalid'),'A synthetic unusable provider endpoint is required');
  const target=await db.target.findFirst({where:{id:channel,workspaceId:workspace,enabled:true},select:{name:true}});check(target,'Synthetic channel required');
  check(await db.post.count({where:{message:{startsWith:tag}}})===0,'Fixture namespace must be unused');
  original=await db.appSetting.findUnique({where:{key:proofKey}});
  await db.appSetting.upsert({where:{key:proofKey},create:{key:proofKey,value:false,encrypted:false,updatedAt:new Date()},update:{value:false,encrypted:false,updatedAt:new Date()}});changed=true;
  await db.session.create({data:{id:sessionId,userId:owner,tokenHash:hashSessionToken(token)!,pending:null,expiresAt:new Date(Date.now()+600000)}});
  const labelRow=await db.appSetting.findUnique({where:{key:'meta.feedFormatLabel'}});
  const label=typeof labelRow?.value==='string'?labelRow.value:String(CONFIG_BY_KEY.get('meta.feedFormatLabel')!.defaultValue);
  browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'localhost,127.0.0.1,[::1]'}});
  let views=0,created=0,recovery=false;
  for(const width of [1440,390])for(const theme of ['grove','coast','clay','nightfall']){
   const context=await browser.newContext({viewport:{width,height:950}});
   try{
    await context.addCookies([{name:'msp_session',value:token,url:origin,httpOnly:true,sameSite:'Lax'},{name:'sp_workspace',value:workspace,url:origin,httpOnly:true,sameSite:'Lax'}]);
    // A dead loopback proxy blocks external traffic without intercepting local action streams.
    // The deliberate failed save below uses a separate one-shot route, removed before retry.
    const page=await context.newPage();page.on('requestfailed',request=>{if(new URL(request.url()).origin!==origin)console.error(JSON.stringify({blockedOrigin:new URL(request.url()).origin}));});const networkEvents:Array<Record<string,unknown>>=[];
    const tracked=(request:import('playwright').Request)=>['document','fetch','xhr'].includes(request.resourceType());
    page.on('request',request=>{if(tracked(request))networkEvents.push({event:'request',method:request.method(),path:new URL(request.url()).pathname,type:request.resourceType(),action:Boolean(request.headers()['next-action'])});});
    page.on('response',response=>{if(tracked(response.request()))networkEvents.push({event:'response',method:response.request().method(),path:new URL(response.url()).pathname,status:response.status(),contentType:response.headers()['content-type'],actionRedirect:response.headers()['x-action-redirect']});});
    page.on('requestfailed',request=>{if(tracked(request))networkEvents.push({event:'failed',method:request.method(),path:new URL(request.url()).pathname,error:request.failure()?.errorText});});
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())networkEvents.push({event:'navigation',path:new URL(frame.url()).pathname});});
    page.on('pageerror',error=>networkEvents.push({event:'page-error',message:error.message.slice(0,150)}));
    console.log(JSON.stringify({view:{width,theme}}));await page.goto(`${origin}/publishing/compose`,{waitUntil:'networkidle'});
    await page.locator('#composer-message').waitFor();await page.evaluate(()=>{(window as any).__formatResetProbe=[];document.addEventListener('reset',event=>{queueMicrotask(()=>{(window as any).__formatResetProbe.push({prevented:event.defaultPrevented,checked:[...document.querySelectorAll<HTMLInputElement>('input[name=targetIds]')].map(input=>({value:input.value,checked:input.checked,defaultChecked:input.defaultChecked}))});});});});await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
    const message=`${tag}_${width}_${theme}`;await page.locator('#composer-message').fill(message);await page.locator('#composer-first-comment').fill('Synthetic first comment');
    if(width<600)await page.getByRole('button',{name:'Menu & filters',exact:true}).click();
    await page.getByRole('checkbox',{name:target.name,exact:true}).check();
    const formats=page.locator('fieldset').filter({has:page.locator('legend').getByText('Formats',{exact:true})});
    check(await formats.locator('strong').getByText(label,{exact:true}).count()===1,'Chosen module label must appear in sidebar');
    check(await formats.locator('select').count()===0,'Single-format choice must not create a redundant picker');
    const saved=JSON.parse(await page.locator('input[name="destinationFormatsJson"]').inputValue());check(saved[channel]==='post'&&Object.keys(saved).length===1,'Only selected destination intent must be serialized');
    check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'Layout must fit desktop and phone');
    check(await page.getByRole('button',{name:'Save draft',exact:true}).isEnabled(),'A fresh valid composer must allow saving in every theme');
    await page.screenshot({path:`/private/tmp/formats85-${width}-${theme}.png`,fullPage:true,animations:'disabled'});views++;
    if(width===1440&&theme==='grove'){
     await page.route('**/publishing/compose',route=>route.request().method()==='POST'?route.abort():route.continue(),{times:1});
     await page.getByRole('button',{name:'Save draft',exact:true}).click();
     await page.locator('[data-composer-error]').filter({hasText:'We could not confirm whether this post was saved.'}).waitFor();
     check(await page.locator('#composer-message').inputValue()===message&&JSON.parse(await page.locator('input[name="destinationFormatsJson"]').inputValue())[channel]==='post','Transport failure must retain text and format');
     check(await page.evaluate(()=>(window as any).__formatResetProbe.some((event:{prevented:boolean})=>event.prevented)),'Managed form must intercept the native reset');
     check(await page.getByRole('checkbox',{name:target.name,exact:true}).isChecked(),'Failed save must retain the actual destination checkbox, not only preview state');
     check(await db.post.count({where:{message}})===0,'Aborted test save must have no draft');recovery=true;await page.unrouteAll({behavior:'wait'});
    }
    if(theme==='grove'){
     await page.getByRole('button',{name:'Save draft',exact:true}).click();
     try{await page.waitForURL('**/publishing/posts?notice=created',{timeout:30000});}
     catch(error){
      const alertText=(await page.locator('[role="alert"]').allTextContents().catch(()=>[])).join(' ').slice(0,500);
      console.error(JSON.stringify({saveFailure:{url:page.url(),alertText,networkEvents:networkEvents.slice(-30)}}));
      await page.screenshot({path:'/private/tmp/formats85-save-failure.png',fullPage:true,animations:'disabled'}).catch(()=>{});
      throw error;
     }
     check(await db.post.count({where:{workspaceId:workspace,authorId:owner,message}})===1,'A confirmed save must create exactly one draft');
     const draft=await db.post.findFirst({where:{workspaceId:workspace,authorId:owner,message},include:{targets:true}});
     check(draft?.firstComment==='Synthetic first comment'&&draft.targets.length===1&&draft.targets[0]?.formatId==='post','Browser save must persist first comment and destination format');created++;
    }
   }finally{await context.close();}
  }
  console.log(JSON.stringify({views,themes:4,desktopAndPhone:true,createdDrafts:created,transportRecovery:recovery,providerDispatch:false}));
 }finally{
  const cleanupFailures:string[]=[];
  try{await browser?.close();}catch{cleanupFailures.push('browser-close');}
  try{
   const posts=await db.post.findMany({where:{workspaceId:workspace,authorId:owner,message:{startsWith:tag}},select:{id:true}});const ids=posts.map(p=>p.id);
   if(ids.length)await db.$transaction(async tx=>{await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${owner} AND detail->>'workspaceId'=${workspace} AND detail->>'postId'=ANY(${ids}::text[])`;await tx.postTarget.deleteMany({where:{postId:{in:ids},post:{workspaceId:workspace}}});await tx.post.deleteMany({where:{id:{in:ids},workspaceId:workspace,authorId:owner}});});
   const remaining=await db.post.count({where:{message:{startsWith:tag}}});if(remaining!==0)cleanupFailures.push('fixture-verification');
  }catch{cleanupFailures.push('fixture-cleanup');}
  try{await db.session.deleteMany({where:{id:sessionId,userId:owner}});if(await db.session.count({where:{id:sessionId}})!==0)cleanupFailures.push('session-verification');}catch{cleanupFailures.push('session-cleanup');}
  try{
   if(changed){if(original)await db.appSetting.update({where:{key:proofKey},data:{value:original.value as Prisma.InputJsonValue,encrypted:original.encrypted,updatedAt:original.updatedAt}});else await db.appSetting.deleteMany({where:{key:proofKey}});}
   const restored=await db.appSetting.findUnique({where:{key:proofKey}});if(changed&&JSON.stringify(restored)!==JSON.stringify(original))cleanupFailures.push('root-setting-verification');
  }catch{cleanupFailures.push('root-setting-restore');}
  try{await db.$disconnect();}catch{cleanupFailures.push('database-disconnect');}
  if(cleanupFailures.length)throw Error(`Verification cleanup incomplete: ${[...new Set(cleanupFailures)].join(', ')}`);
  console.log(JSON.stringify({fixturesCleaned:true,sessionCleaned:true,rootPolicyRestoredExactly:true,databaseDisconnected:true}));
 }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Local format verification failed');process.exitCode=1;});
