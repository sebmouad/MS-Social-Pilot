import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePermissions } from '../src/server/permissions';
const state = vi.hoisted(() => ({ enabledIds: ['a'], suspended: false, writes: [] as {sql:string;values:unknown[]}[], failAudit:false, role:'owner' }));
const tx = vi.hoisted(() => ({ $queryRaw:vi.fn(),$executeRaw:vi.fn(),target:{findMany:vi.fn()} }));
vi.mock('../src/server/data',()=>({prisma:{$queryRaw:tx.$queryRaw,membership:{findUnique:async()=>({role:state.role})},$transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx),user:{findUnique:async()=>({disabledAt:null})}}}));
vi.mock('../src/server/permissions/loader',()=>({loadPermissions:async()=>resolvePermissions({role:'owner',allPages:true,workspaceDisabledModules:[],memberDisabledModules:[],clientAccess:[],pageAccess:[]})}));
vi.mock('../src/server/entitlements',()=>({loadEntitlements:async()=>({}),canUseFeature:()=>true,entitledPlatformIds:()=>['synthetic']}));
vi.mock('../src/server/platforms/resource-visibility',()=>({selectedResourceConnectionWhere:async()=>({workspaceId:'w',invalidatedAt:null})}));
vi.mock('../src/server/config/store',()=>({runtimeConfigBatch:async()=>({'mcp.keys.historyPageSize':2,'mcp.keys.maxActivePerWorkspace':10,'mcp.keys.maxLifetimeDays':365,'mcp.keys.maxResourceIds':1000,'mcp.keys.transactionTimeoutMs':15000,'mcp.keys.transactionMaxWaitMs':2000})}));
import { issueMcpKey, listMcpKeys, revokeMcpKey } from '../src/modules/settings/mcp-access/server';
const actor={userId:'u',workspaceId:'w'};
const input={name:'Reader',readFeatures:['publishing/posts'],writeFeatures:[],expiresInDays:30,resourceScope:{version:1,mode:'selected',ids:['a'],adAccountIds:[]},confirmation:'CREATE MCP KEY Reader'};
beforeEach(()=>{state.role='owner';state.enabledIds=['a'];state.suspended=false;state.writes=[];state.failAudit=false;tx.$queryRaw.mockImplementation(async(s:TemplateStringsArray)=>s.join('').includes('workspace_data_purges')?[]:s.join('').includes('COUNT(*)')?[{count:BigInt(0)}]:[{id:'w',role:'owner',suspendedAt:state.suspended?new Date():null,allPages:true,memberDisabled:[],workspaceDisabled:[],clientAccess:[]}]);tx.target.findMany.mockImplementation(async()=>state.enabledIds.map(id=>({id})));tx.$executeRaw.mockImplementation(async(s:TemplateStringsArray,...values:unknown[])=>{const sql=s.join('?');if(state.failAudit&&sql.includes('root_activities'))throw Error('audit failed');state.writes.push({sql,values});return 1;});});
describe('MCP key issuance authority and selected resources',()=>{
 it('persists an explicit ceiling and a digest, returning the secret only once',async()=>{const result=await issueMcpKey(actor,input);expect(result.token).toMatch(/^mcp_[A-Za-z0-9_-]{43}$/);expect(result.key.resourceScope).toEqual({version:1,mode:'selected',ids:['a'],adAccountIds:[]});expect(JSON.stringify(state.writes)).not.toContain(result.token);expect(state.writes[0].values).toContain(JSON.stringify({version:1,mode:'selected',ids:['a'],adAccountIds:[]}));});
 it('refuses foreign, disabled or unselected identities before issuing credentials',async()=>{state.enabledIds=[];await expect(issueMcpKey(actor,input)).rejects.toMatchObject({code:'forbidden'});expect(state.writes).toHaveLength(0);});
 it('requires explicit scope and confirmation, with no default blanket resource grant',async()=>{const {resourceScope:_scope,...missing}=input;await expect(issueMcpKey(actor,missing)).rejects.toMatchObject({code:'invalid_request'});await expect(issueMcpKey(actor,{...input,confirmation:'no'})).rejects.toMatchObject({code:'invalid_request'});expect(state.writes).toHaveLength(0);});
 it('refuses a suspended workspace without issuing a key',async()=>{state.suspended=true;await expect(issueMcpKey(actor,input)).rejects.toMatchObject({code:'forbidden'});expect(state.writes).toHaveLength(0);});
 it('requires consequence confirmation for revocation',async()=>{await expect(revokeMcpKey(actor,{id:'key',confirmation:'no'})).rejects.toMatchObject({code:'invalid_request'});expect(state.writes).toHaveLength(0);await expect(revokeMcpKey(actor,{id:'key',confirmation:'REVOKE MCP KEY key'})).resolves.toMatchObject({revoked:true});expect(state.writes[0].values).toContain('w');});
});

it('refuses account/credential authority on newly issued bearer keys', async()=>{
 await expect(issueMcpKey(actor,{...input,readFeatures:['settings/account']})).rejects.toMatchObject({code:'forbidden'});
 await expect(issueMcpKey(actor,{...input,readFeatures:['settings/mcp']})).rejects.toMatchObject({code:'forbidden'});
 expect(state.writes).toHaveLength(0);
});
it('shares bounded workspace key history without selecting token hashes and rechecks current manager role',async()=>{
 tx.$queryRaw.mockResolvedValue([{id:'a'},{id:'b'},{id:'c'}]);
 const result=await listMcpKeys(actor,{offset:2});
 expect(result).toEqual({keys:[{id:'a'},{id:'b'}],nextOffset:4});
 const call=tx.$queryRaw.mock.calls.at(-1)!;
 expect(call[0].join('?')).toContain('WHERE "workspaceId"=');
 expect(call[0].join('?')).not.toContain('"tokenHash"');
 expect(call.slice(1)).toEqual(['w',3,2]);
 state.role='editor';
 await expect(listMcpKeys(actor)).rejects.toMatchObject({code:'forbidden'});
});
