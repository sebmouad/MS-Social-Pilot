import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { issueMcpKey, listMcpKeys, revokeMcpKey } from '@/modules/settings/mcp-access/server';
import { labelInstants, requestLocale, workspaceInstantFormatter } from '@/server/instant-labels';
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
export async function GET(request:Request){try{const viewer=await manager();const params=new URL(request.url).searchParams;if([...params.keys()].some(key=>key!=='offset')||params.getAll('offset').length>1||(params.has('offset')&&!/^\d+$/.test(params.get('offset')!)))throw new OperationError('invalid_request','Choose a valid key page.');return reply(await listMcpKeys({userId:viewer.user.id,workspaceId:viewer.workspaceId},params.has('offset')?{offset:Number(params.get('offset'))}:{}));}catch(error){return failure(error);}}

export async function POST(request:Request){
 if(!sameOrigin(request))return reply({error:'Cross-origin request denied.'},403);
 try{const viewer=await manager(true);const issued=await issueMcpKey({userId:viewer.user.id,workspaceId:viewer.workspaceId},await request.json());const instants=await workspaceInstantFormatter(viewer.workspaceId,requestLocale(request));return reply({...issued,key:labelInstants(issued.key,{createdAt:'date',expiresAt:'date',lastUsedAt:'dateTime'},instants)},201);}catch(error){return failure(error);}
}
export async function DELETE(request:Request){
 if(!sameOrigin(request))return reply({error:'Cross-origin request denied.'},403);
 try{const viewer=await manager(true);return reply(await revokeMcpKey({userId:viewer.user.id,workspaceId:viewer.workspaceId},await request.json()));}catch(error){return failure(error);}
}
