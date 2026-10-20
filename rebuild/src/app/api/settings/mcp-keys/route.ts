import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { issueMcpKey, revokeMcpKey } from '@/modules/settings/mcp-access/server';
export const runtime = 'nodejs';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
function sameOrigin(request:Request){const origin=request.headers.get('origin');if(!origin)return false;try{return new URL(origin).origin===requestOrigin(request);}catch{return false;}}
async function manager(write=false){
 const viewer=await requireViewer({feature:'settings/mcp',...(write?{write:true}:{})});
 if(!['owner','admin'].includes(viewer.membership.role))throw new OperationError('forbidden','Only workspace owners and admins can manage API keys.');
 return viewer;
}
function failure(error:unknown){
 const digest=(error as {digest?:unknown}|null)?.digest;
 if(typeof digest==='string'&&digest.startsWith('NEXT_REDIRECT'))return reply({error:'API key access is unavailable.'},digest.includes('/sign-in')?401:403);
 const result=operationFailure(error instanceof SyntaxError?new OperationError('invalid_request','Enter valid key details.'):error,'The API key operation could not be confirmed. Refresh before retrying.');
 return reply({error:result.error,code:result.code},result.status);
}
export async function GET(){try{const viewer=await manager();const keys=await prisma.$queryRaw`SELECT id,name,"tokenPrefix","readFeatures","writeFeatures","resourceScope","expiresAt","revokedAt","createdAt","lastUsedAt" FROM mcp_api_keys WHERE "workspaceId"=${viewer.workspaceId} ORDER BY "createdAt" DESC`;return reply({keys});}catch(error){return failure(error);}}
export async function POST(request:Request){
 if(!sameOrigin(request))return reply({error:'Cross-origin request denied.'},403);
 try{const viewer=await manager(true);return reply(await issueMcpKey({userId:viewer.user.id,workspaceId:viewer.workspaceId},await request.json()),201);}catch(error){return failure(error);}
}
export async function DELETE(request:Request){
 if(!sameOrigin(request))return reply({error:'Cross-origin request denied.'},403);
 try{const viewer=await manager(true);return reply(await revokeMcpKey({userId:viewer.user.id,workspaceId:viewer.workspaceId},await request.json()));}catch(error){return failure(error);}
}
