/** Synthetic-only local HTTP/MCP/export/erasure probe. Never contacts a provider. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';
class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = ['mcp.enabled','mcp.authenticatedRoles','mcp.maxResultItems','entitlements.modules.tasks','entitlements.features.tasks/board','entitlements.features.publishing/posts','platforms.facebook.enabled'] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };
function workspaceExport(zip: Buffer) {
  let offset=0;
  while(offset+30<=zip.length&&zip.readUInt32LE(offset)===0x04034b50) {
    const method=zip.readUInt16LE(offset+8),size=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),extraLength=zip.readUInt16LE(offset+28);
    const name=zip.subarray(offset+30,offset+30+nameLength).toString(),start=offset+30+nameLength+extraLength;
    if(name==='database/workspace.json')return JSON.parse((method===8?inflateRawSync(zip.subarray(start,start+size)):zip.subarray(start,start+size)).toString());
    offset=start+size;
  }
  throw new ProbeFailure('Workspace JSON missing from export ZIP.');
}
async function main() {
  const raw=process.env.REBUILD_PREVIEW_DATABASE_URL,origin=process.env.REBUILD_PREVIEW_ORIGIN;
  check(raw&&raw===process.env.DATABASE_URL&&origin&&process.env.NODE_ENV!=='production','Explicit matching preview database and origin required.');
  const u=new URL(raw),base=new URL(origin);
  check(['postgres:','postgresql:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&decodeURIComponent(u.pathname).endsWith('_preview')&&!['host','hostaddr','socket'].some(k=>u.searchParams.has(k)),'Only loopback _preview PostgreSQL permitted.');
  check(base.origin===origin&&base.protocol==='http:'&&base.hostname==='localhost'&&base.port==='3200','Only localhost:3200 preview permitted.');
  const db=new PrismaClient({datasources:{db:{url:raw}}}),prefix=`preview_tasks76_${randomUUID().replaceAll('-','')}`;
  const ownerId=`${prefix}_owner`,editorId=`${prefix}_editor`,workspaceId=`${prefix}_workspace`,foreignId=`${prefix}_foreign`,socialId=`${prefix}_social`,allowedId=`${prefix}_allowed`,hiddenId=`${prefix}_hidden`;
  const allowedPost=`${prefix}_allowed_post`,hiddenPost=`${prefix}_hidden_post`,foreignTask=`${prefix}_foreign_task`,editorMembership=`${prefix}_editor_membership`;
  const token=randomBytes(32).toString('base64url'),readKey=`mcp_${randomBytes(32).toString('base64url')}`,writeKey=`mcp_${randomBytes(32).toString('base64url')}`,scopedKey=`mcp_${randomBytes(32).toString('base64url')}`;
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),expiresAt=new Date(Date.now()+1800000),settings=new Map<string,Setting|null>(),ledger=`/private/tmp/${prefix}-recovery.json`;
  let captured=false,fixture=false,rootWrites=false,ledgerSaved=false;
  const cookie=`msp_session=${token}; sp_workspace=${workspaceId}`;
  const http=(path:string,method='GET',body?:unknown)=>fetch(new URL(path,base),{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{origin:base.origin,cookie,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json=async(r:Response):Promise<any>=>r.json().catch(()=>null);
  async function rpc(name:string,args:unknown={},bearer=readKey){const r=await fetch(new URL('/api/mcp?scope=workspace',base),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{origin:base.origin,authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})});return {r,b:await json(r)};}
  async function save(key:string,value:unknown){rootWrites=true;const r=await http('/api/root/config','PUT',{key,value});const b=await json(r);check(r.ok&&b.schemaVersion===CONFIG_SCHEMA_VERSION,`Root setting ${key} did not save.`);}
  async function create(title:string,extra:object={}){const r=await http('/api/tasks','POST',{action:'task.create',title,...extra});const b=await json(r);check(r.ok&&b.ok&&typeof b.id==='string','HTTP task creation failed.');return b.id as string;}
  try {
    stage='preflight and capture exact settings';
    check((await fetch(new URL('/sign-in',base),{redirect:'manual',signal:AbortSignal.timeout(5000)})).status<500,'Local preview unavailable.');
    const objects=await db.$queryRaw<Array<{ready:boolean}>>`SELECT to_regclass('public.task_comments') IS NOT NULL AND to_regprocedure('public.rebuild_reject_purging_workspace_write()') IS NOT NULL AS ready`;
    check(objects[0]?.ready,'Reviewed Tasks schema/gate missing; no fixtures written.');
    for(const key of settingKeys){const value=await db.appSetting.findUnique({where:{key},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(!value?.encrypted,'Unexpected encrypted probe setting.');settings.set(key,value);}captured=true;
    await writeFile(ledger,JSON.stringify({prefix,ownerId,editorId,workspaceId,foreignId,settings:[...settings]}),{mode:0o600,flag:'wx'});ledgerSaved=true;fixture=true;
    for(const [id,role] of [[ownerId,'Owner'],[editorId,'Editor']] as const)await db.user.create({data:{id,email:`${id}@example.test`,name:`Disposable Tasks ${role}`,passwordHash:'unusable-preview-password',...(id===ownerId?{isInstanceOwner:true,totpEnabledAt:new Date()}:{} )}});
    for(const id of [workspaceId,foreignId])await db.workspace.create({data:{id,name:'Disposable Tasks workflow',slug:id,timezone:'UTC'}});
    await db.membership.create({data:{id:`${prefix}_owner_membership`,workspaceId,userId:ownerId,role:'owner'}});
    await db.membership.create({data:{id:editorMembership,workspaceId,userId:editorId,role:'editor'}});
    await db.$executeRaw`UPDATE memberships SET "allPages"=false WHERE id=${editorMembership}`;
    await db.session.create({data:{id:`${prefix}_session`,userId:ownerId,tokenHash:hashLegacySessionToken(token)!,expiresAt,pending:null}});
    await db.socialAccount.create({data:{id:socialId,workspaceId,provider:'facebook',providerUserId:`${prefix}_provider`,name:'Disposable synthetic connection',accessToken:'synthetic-never-used'}});
    for(const id of [allowedId,hiddenId])await db.target.create({data:{id,workspaceId,socialAccountId:socialId,type:'page',providerId:id,name:'Disposable Tasks channel',enabled:true,canPublish:false,createdAt:new Date()}});
    await db.$executeRaw`INSERT INTO member_page_access ("membershipId","targetId") VALUES (${editorMembership},${allowedId})`;
    for(const [id,targetId,message] of [[allowedPost,allowedId,'Allowed synthetic linked content'],[hiddenPost,hiddenId,'Restricted synthetic linked content']] as const){await db.post.create({data:{id,workspaceId,authorId:ownerId,message,status:'draft',createdAt:new Date(),updatedAt:new Date()}});await db.postTarget.create({data:{id:`${id}_target`,postId:id,targetId,status:'pending'}});}
    await db.$executeRaw`INSERT INTO tasks (id,"workspaceId",title,status,"createdAt","updatedAt") VALUES (${foreignTask},${foreignId},'Foreign synthetic task','todo',NOW(),NOW())`;
    for(const [suffix,bearer,creator,reads,writes] of [['read',readKey,ownerId,['tasks/board'],[]],['write',writeKey,ownerId,['tasks/board'],['tasks/board']],['scoped',scopedKey,editorId,['tasks/board','publishing/posts'],[]]] as const)await db.mcpApiKey.create({data:{id:`${prefix}_${suffix}_key`,workspaceId,createdById:creator,name:'Disposable Tasks probe',tokenHash:hash(bearer),tokenPrefix:bearer.slice(0,12),readFeatures:[...reads],writeFeatures:[...writes],expiresAt}});
    stage='enable local feature and MCP';
    await save('mcp.enabled',true);await save('mcp.authenticatedRoles',['owner','admin','editor']);await save('mcp.maxResultItems',1);await save('platforms.facebook.enabled',true);await save('entitlements.modules.tasks',true);await save('entitlements.features.tasks/board',true);await save('entitlements.features.publishing/posts',true);
    stage='HTTP creation and MCP key feature/resource ceilings';
    const taskId=await create('Disposable allowed task',{postId:allowedPost}),hiddenTask=await create('Disposable restricted link',{postId:hiddenPost});
    const read=await rpc('get_task',{id:taskId});const detail=read.b.result?.structuredContent;
    check(!read.b.result?.isError&&detail?.task?.post===null&&detail.task.postHidden===true&&detail.task.canEdit===false&&detail.canComment===false,'Tasks-only read key leaked nested post data or write capabilities.');
    const page=await rpc('list_tasks',{});const pageBody=page.b.result?.structuredContent;check(pageBody?.tasks?.length===1&&pageBody.hasMore===true&&pageBody.assignees.length<=1,'MCP collection ceiling not enforced.');
    const scoped=await rpc('get_task',{id:taskId},scopedKey);check(scoped.b.result?.structuredContent?.task?.post?.id===allowedPost,'Scoped key cannot see an authorized linked post.');
    const outside=await rpc('get_task',{id:hiddenTask},scopedKey);check(outside.b.result?.structuredContent?.task?.post===null&&outside.b.result?.structuredContent?.task?.postHidden===true,'Scoped key leaked an out-of-scope linked post.');
    const forbidden=await rpc('move_task',{id:taskId,status:'doing',confirmation:`MOVE TASK ${taskId} TO doing`});check(forbidden.b.result?.isError===true,'Read-only key moved a task.');
    const foreign=await http(`/api/tasks/${foreignTask}`);check(foreign.status===404,'Foreign task became visible.');
    const tooLarge=await rpc('create_task_checklist',{titles:['One','Two'],confirmation:'CREATE 2 TASKS'},writeKey);check(tooLarge.b.result?.isError===true,'Oversized MCP result batch was written.');
    stage='comments, optimistic editing and lifecycle through HTTP/MCP';
    const comment=await http('/api/tasks','POST',{action:'comment.add',taskId,body:'Disposable workflow comment'});const commentBody=await json(comment);check(comment.ok&&commentBody.id,'HTTP task comment failed.');
    const before=await json(await http(`/api/tasks/${taskId}`));check(before.task?.post?.id===allowedPost&&before.comments?.length===1,'HTTP task detail differs from stored state.');
    const update=await rpc('update_task',{id:taskId,title:'Disposable renamed task',expectedUpdatedAt:before.task.updatedAt,confirmation:`UPDATE TASK ${taskId}`},writeKey);check(!update.b.result?.isError,'Authorized MCP task edit failed.');
    const stale=await http('/api/tasks','POST',{action:'task.update',id:taskId,title:'Stale write',expectedUpdatedAt:before.task.updatedAt});check(stale.status===409,'Stale task edit was not refused.');
    const move=await rpc('move_task',{id:taskId,status:'done',confirmation:`MOVE TASK ${taskId} TO done`},writeKey);check(!move.b.result?.isError,'Authorized MCP task transition failed.');
    const workflow=await http('/api/tasks','POST',{action:'task.createMany',titles:['Disposable first step','Disposable second step'],startOn:'2026-10-18',gapDays:2});const workflowBody=await json(workflow);check(workflow.ok&&workflowBody.ids?.length===2,'Atomic checklist failed.');
    const dates=await db.$queryRaw<Array<{dueOn:string}>>`SELECT "dueOn" FROM tasks WHERE id=ANY(${workflowBody.ids}::text[]) ORDER BY "dueOn"`;check(JSON.stringify(dates.map(x=>x.dueOn))===JSON.stringify(['2026-10-18','2026-10-20']),'Checklist calendar dates differ.');
    stage='export and deletion cover Tasks and comments';
    const exported=await http('/api/settings/data');check(exported.ok,'Workspace archive export failed.');const data=workspaceExport(Buffer.from(await exported.arrayBuffer()));
    check(data.legacyTables?.tasks?.some((x:any)=>x.id===taskId)&&data.legacyTables?.task_comments?.some((x:any)=>x.id===commentBody.id),'Workspace archive omitted Tasks/comment records.');
    const preview=await json(await http('/api/settings/data','POST'));check(preview.counts?.['other:tasks']===4&&preview.counts?.['other:task_comments']===1,'Deletion preview omitted Tasks/comments.');
    const wrong=await http('/api/tasks','POST',{action:'task.delete',id:hiddenTask,confirmation:'DELETE wrong'});check(wrong.status===400,'Incorrect delete confirmation accepted.');
    const erase=await http('/api/settings/data','DELETE',{confirmation:'DELETE'});const erased=await json(erase);
    if(!erase.ok){
      try { const { deleteWorkspaceData }=await import('../src/server/data-control'); await deleteWorkspaceData({userId:ownerId,workspaceId},'DELETE'); }
      catch(error){const e=error as {name?:string;code?:string;meta?:{code?:string};message?:string};console.error(JSON.stringify({erasureDiagnostic:{httpStatus:erase.status,name:e.name,code:e.code,sqlState:e.meta?.code,gateRefusal:e.message?.includes('Workspace data deletion is in progress')}}));}
    }
    check(erase.ok&&erased.ok===true,'Confirmed synthetic workspace erasure failed.');
    const remaining=await db.$queryRaw<Array<{n:bigint}>>`SELECT ((SELECT COUNT(*) FROM tasks WHERE "workspaceId"=${workspaceId})+(SELECT COUNT(*) FROM task_comments WHERE "workspaceId"=${workspaceId}))::bigint AS n`;check(remaining[0]?.n===BigInt(0),'Tasks/comments remained after workspace erasure.');
    check((await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*)::bigint AS n FROM tasks WHERE id=${foreignTask}`)[0]?.n===BigInt(1),'Erasure affected the foreign workspace.');
    console.log('PASS: actual local HTTP/MCP Tasks CRUD, comments, checklist, optimistic conflicts, read-only/feature/target ceilings, bounded output, archive inclusion and exact-workspace erasure; no provider call.');
  } finally {
    const errors:string[]=[];const clean=async(label:string,fn:()=>Promise<unknown>)=>{try{await fn()}catch{errors.push(label)}};
    if(captured)for(const key of settingKeys){const old=settings.get(key);await clean(`restore ${key}`,()=>old?db.appSetting.upsert({where:{key},create:{...old,value:old.value===null?Prisma.JsonNull:old.value},update:{value:old.value===null?Prisma.JsonNull:old.value,encrypted:old.encrypted,updatedAt:old.updatedAt}}):db.appSetting.deleteMany({where:{key}}));}
    if(fixture)await clean('exact synthetic fixture cleanup',async()=>{
      await db.mcpApiKey.deleteMany({where:{id:{in:['read','write','scoped'].map(x=>`${prefix}_${x}_key`)}}});await db.session.deleteMany({where:{id:`${prefix}_session`}});
      await db.$executeRaw`DELETE FROM task_comments WHERE "workspaceId"=ANY(${[workspaceId,foreignId]}::text[])`;await db.$executeRaw`DELETE FROM tasks WHERE "workspaceId"=ANY(${[workspaceId,foreignId]}::text[])`;
      await db.postTarget.deleteMany({where:{post:{workspaceId:{in:[workspaceId,foreignId]}}}});await db.post.deleteMany({where:{workspaceId:{in:[workspaceId,foreignId]}}});await db.target.deleteMany({where:{workspaceId:{in:[workspaceId,foreignId]}}});await db.socialAccount.deleteMany({where:{id:socialId}});
      await db.$executeRaw`DELETE FROM root_activities WHERE "actorId"=ANY(${[ownerId,editorId]}::text[]) OR detail->>'workspaceId'=ANY(${[workspaceId,foreignId]}::text[])`;
      await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,foreignId]}::text[])`;await db.$executeRaw`DELETE FROM member_page_access WHERE "membershipId"=${editorMembership}`;
      await db.membership.deleteMany({where:{userId:{in:[ownerId,editorId]}}});await db.workspaceDataPurge.deleteMany({where:{workspaceId:{in:[workspaceId,foreignId]}}});await db.workspace.deleteMany({where:{id:{in:[workspaceId,foreignId]}}});await db.user.deleteMany({where:{id:{in:[ownerId,editorId]}}});
      check(await db.workspace.count({where:{id:{in:[workspaceId,foreignId]}}})===0&&await db.user.count({where:{id:{in:[ownerId,editorId]}}})===0,'Synthetic identities remained.');
    });
    if(captured&&rootWrites)await clean('exact setting verification',async()=>{for(const key of settingKeys){const current=await db.appSetting.findUnique({where:{key},select:{key:true,value:true,encrypted:true,updatedAt:true}});check(JSON.stringify(current)===JSON.stringify(settings.get(key)),`Setting ${key} failed exact restoration.`);}});
    if(!errors.length&&ledgerSaved)await clean('recovery ledger cleanup',()=>unlink(ledger));await db.$disconnect();check(!errors.length,'Cleanup failed; private recovery ledger retained.');console.log('All synthetic fixtures removed; exact prior Root settings restored and verified.');
  }
}
main().catch(error=>{console.error(`Tasks workflow probe failed at ${stage}: ${error instanceof ProbeFailure?error.message:'unexpected local failure (details withheld)'}`);process.exitCode=1;});
