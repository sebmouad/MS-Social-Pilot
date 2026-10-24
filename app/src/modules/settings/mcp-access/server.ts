import { SESSION_ONLY_MCP_FEATURES } from './session-policy';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PAGES } from '@/lib/product';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { canUseFeature, entitledPlatformIds, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature, resolvePermissions } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { parseResourceScope } from './resource-scope';

type Actor = {userId:string;workspaceId:string};
const featureIds=PAGES.map(p=>p.id);
const features=z.array(z.enum(featureIds as [string,...string[]])).max(featureIds.length);
const createSchema=z.object({name:z.string().trim().min(1).max(100),readFeatures:features.min(1),writeFeatures:features,expiresInDays:z.number().int().positive(),resourceScope:z.unknown().refine(v=>v!==undefined&&v!==null),confirmation:z.string()}).strict();
const bad=()=>new OperationError('invalid_request','Choose valid API key details, an explicit resource scope and the matching confirmation.');
const denied=()=>new OperationError('forbidden','API key management is unavailable with your current access.');
async function policy(){
 const values=await runtimeConfigBatch(['mcp.keys.maxActivePerWorkspace','mcp.keys.maxLifetimeDays','mcp.keys.maxResourceIds','mcp.keys.transactionTimeoutMs','mcp.keys.transactionMaxWaitMs']);
 const parsed=z.object({'mcp.keys.maxActivePerWorkspace':z.number().int().positive(),'mcp.keys.maxLifetimeDays':z.number().int().positive(),'mcp.keys.maxResourceIds':z.number().int().positive(),'mcp.keys.transactionTimeoutMs':z.number().int().positive(),'mcp.keys.transactionMaxWaitMs':z.number().int().positive()}).safeParse(values);
 if(!parsed.success)throw new OperationError('unavailable','API key policy is unavailable.');
 return parsed.data;
}
async function authorize(actor:Actor,write=true){
 const [user,permissions,entitlements]=await Promise.all([prisma.user.findUnique({where:{id:actor.userId},select:{disabledAt:true}}),loadPermissions(actor.userId,actor.workspaceId),loadEntitlements(actor.userId,actor.workspaceId,{allowInstallationInspection:false})]);
 if(!user||user.disabledAt||!permissions||!entitlements||!canUseFeature(entitlements,'settings/mcp')||!canAccessFeature(permissions,'settings/mcp',write?'write':'read'))throw denied();
 return {permissions,entitlements};
}
type Tx=Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function lockActor(tx:Tx,actor:Actor){
 const rows=await tx.$queryRaw<Array<{role:string;suspendedAt:Date|null;allPages:boolean;memberDisabled:string[];workspaceDisabled:string[];clientAccess:string[]}>>`SELECT m.role::text AS role,w."suspendedAt",m."allPages",COALESCE(m."disabledModules",ARRAY[]::TEXT[]) AS "memberDisabled",COALESCE(w."disabledModules",ARRAY[]::TEXT[]) AS "workspaceDisabled",COALESCE(w."clientAccess",ARRAY[]::TEXT[]) AS "clientAccess" FROM memberships m JOIN users u ON u.id=m."userId" JOIN workspaces w ON w.id=m."workspaceId" WHERE m."userId"=${actor.userId} AND m."workspaceId"=${actor.workspaceId} AND u."disabledAt" IS NULL FOR SHARE OF m,u,w`;
 const row=rows[0];if(!row||!['owner','admin'].includes(row.role)||row.suspendedAt)throw denied();
 const permissions=resolvePermissions({role:row.role,allPages:row.allPages,workspaceDisabledModules:row.workspaceDisabled,memberDisabledModules:row.memberDisabled,clientAccess:row.clientAccess,pageAccess:[]});
 if(!canAccessFeature(permissions,'settings/mcp','write'))throw denied();
 const purge=await tx.$queryRaw<Array<{status:string}>>`SELECT status::text FROM workspace_data_purges WHERE "workspaceId"=${actor.workspaceId}`;
 if(purge[0]&&purge[0].status!=='completed')throw new OperationError('conflict','Workspace data deletion is in progress.');
 return permissions;
}
async function audit(tx:Tx,actor:Actor,action:string,detail:Record<string,unknown>){
 const n=await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt") VALUES (${`mcp_key_${randomBytes(12).toString('hex')}`},${actor.userId},${action},${JSON.stringify({workspaceId:actor.workspaceId,...detail})}::jsonb,NOW())`;
 if(n!==1)throw new OperationError('unavailable','The key change could not be recorded.');
}
export async function issueMcpKey(actor:Actor,input:unknown){
 const parsed=createSchema.safeParse(input);if(!parsed.success)throw bad();const data=parsed.data;
 if(data.confirmation!==`CREATE MCP KEY ${data.name}`||data.writeFeatures.some(f=>!data.readFeatures.includes(f)))throw bad();
 if(data.readFeatures.some(feature=>SESSION_ONLY_MCP_FEATURES.has(feature)))throw denied();
 const [auth,bounds]=await Promise.all([authorize(actor),policy()]);
 let scope;try{scope=parseResourceScope(data.resourceScope,bounds['mcp.keys.maxResourceIds']);}catch{throw bad();}if(!scope)throw bad();
 if(data.expiresInDays>bounds['mcp.keys.maxLifetimeDays'])throw new OperationError('invalid_request',`Key lifetime cannot exceed ${bounds['mcp.keys.maxLifetimeDays']} days.`);
 if(data.readFeatures.some(f=>!canUseFeature(auth.entitlements,f)||!canAccessFeature(auth.permissions,f,'read'))||data.writeFeatures.some(f=>!canUseFeature(auth.entitlements,f)||!canAccessFeature(auth.permissions,f,'write')))throw denied();
 if(scope.mode==='all'&&!auth.permissions.pageScope.all)throw denied();
 const channelScope=auth.permissions.pageScope;
 if(scope.mode==='selected'&&!channelScope.all&&scope.ids.some(id=>!channelScope.ids.includes(id)))throw denied();
 const connection=await selectedResourceConnectionWhere(actor.workspaceId,entitledPlatformIds(auth.entitlements));
 const id=`mcpkey_${randomBytes(12).toString('hex')}`,token=`mcp_${randomBytes(32).toString('base64url')}`,tokenHash=createHash('sha256').update(token).digest('hex'),tokenPrefix=token.slice(0,12),expiresAt=new Date(Date.now()+data.expiresInDays*86400000);
 const resourceScope=scope;
 await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${actor.workspaceId} FOR SHARE`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
  const fresh=await lockActor(tx,actor);
  if(data.readFeatures.some(f=>!canAccessFeature(fresh,f,'read'))||data.writeFeatures.some(f=>!canAccessFeature(fresh,f,'write')))throw denied();
  if(resourceScope.mode==='selected'&&resourceScope.ids.length){
   const selected=await tx.target.findMany({where:{id:{in:resourceScope.ids},workspaceId:actor.workspaceId,enabled:true,socialAccount:{is:connection}},select:{id:true}});
   if(selected.length!==resourceScope.ids.length)throw new OperationError('forbidden','Choose only currently selected resources in this workspace.');
  }
  if(resourceScope.mode==='selected'&&resourceScope.adAccountIds.length){
   // Independent account identities: selecting a channel must never grant sibling ad accounts.
   const selected=await tx.adAccount.findMany({where:{id:{in:resourceScope.adAccountIds},workspaceId:actor.workspaceId,enabled:true,socialAccount:{is:connection}},select:{id:true}});
   if(selected.length!==resourceScope.adAccountIds.length)throw new OperationError('forbidden','Choose only currently selected ad accounts in this workspace.');
   if(!auth.permissions.pageScope.all)throw denied();
  }
  const count=await tx.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM mcp_api_keys WHERE "workspaceId"=${actor.workspaceId} AND "revokedAt" IS NULL AND "expiresAt">NOW()`;
  if(Number(count[0]?.count??0)>=bounds['mcp.keys.maxActivePerWorkspace'])throw new OperationError('conflict','This workspace has reached its active API key limit.');
  const inserted=await tx.$executeRaw`INSERT INTO mcp_api_keys (id,"workspaceId","createdById",name,"tokenHash","tokenPrefix","readFeatures","writeFeatures","resourceScope","expiresAt","createdAt") VALUES (${id},${actor.workspaceId},${actor.userId},${data.name},${tokenHash},${tokenPrefix},${data.readFeatures}::text[],${data.writeFeatures}::text[],${JSON.stringify(resourceScope)}::jsonb,${expiresAt},NOW())`;
  if(inserted!==1)throw new OperationError('unavailable','The API key could not be created.');
  await audit(tx,actor,'mcp.key_created',{keyId:id,readFeatures:data.readFeatures,writeFeatures:data.writeFeatures,resourceScope,expiresAt:expiresAt.toISOString()});
 },{timeout:bounds['mcp.keys.transactionTimeoutMs'],maxWait:bounds['mcp.keys.transactionMaxWaitMs']});
 return {key:{id,name:data.name,tokenPrefix,readFeatures:data.readFeatures,writeFeatures:data.writeFeatures,resourceScope,expiresAt},token};
}
export async function revokeMcpKey(actor:Actor,input:unknown){
 const parsed=z.object({id:z.string().min(1).max(100),confirmation:z.string()}).strict().safeParse(input);if(!parsed.success||parsed.data.confirmation!==`REVOKE MCP KEY ${parsed.data.id}`)throw bad();
 const [,bounds]=await Promise.all([authorize(actor),policy()]);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${actor.workspaceId} FOR SHARE`;
  await lockActor(tx,actor);
  const changed=await tx.$executeRaw`UPDATE mcp_api_keys SET "revokedAt"=NOW() WHERE id=${parsed.data.id} AND "workspaceId"=${actor.workspaceId} AND "revokedAt" IS NULL`;
  if(changed!==1)throw new OperationError('not_found','Active API key not found in this workspace.');
  await audit(tx,actor,'mcp.key_revoked',{keyId:parsed.data.id});return {revoked:true};
 },{timeout:bounds['mcp.keys.transactionTimeoutMs'],maxWait:bounds['mcp.keys.transactionMaxWaitMs']});
}

/** Shared bounded directory; raw token hashes and credentials are never selected. */
export async function listMcpKeys(actor:Actor,input:unknown={},maxItems?:number) {
 const parsed=z.object({offset:z.number().int().safe().nonnegative().optional()}).strict().safeParse(input);
 if(!parsed.success)throw bad();
 await authorize(actor,false);
 const membership=await prisma.membership.findUnique({where:{userId_workspaceId:{userId:actor.userId,workspaceId:actor.workspaceId}},select:{role:true}});
 if(!membership||!['owner','admin'].includes(membership.role))throw denied();
 const offset=parsed.data.offset??0;
 const configured=await runtimeConfigBatch(['mcp.keys.historyPageSize']).then(values=>z.number().int().positive().parse(values['mcp.keys.historyPageSize']));
 const limit=maxItems===undefined?configured:Math.min(configured,z.number().int().positive().parse(maxItems));
 type KeyRow={id:string;name:string;tokenPrefix:string;readFeatures:string[];writeFeatures:string[];resourceScope:{mode:string;ids?:string[];adAccountIds?:string[]}|null;expiresAt:Date;revokedAt:Date|null;createdAt:Date;lastUsedAt:Date|null};
 const rows=await prisma.$queryRaw<KeyRow[]>`SELECT id,name,"tokenPrefix","readFeatures","writeFeatures","resourceScope","expiresAt","revokedAt","createdAt","lastUsedAt" FROM mcp_api_keys WHERE "workspaceId"=${actor.workspaceId} ORDER BY "createdAt" DESC,id LIMIT ${limit+1} OFFSET ${offset}`;
 return {keys:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null};
}
