import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({issue:vi.fn(),revoke:vi.fn(),requireViewer:vi.fn()}));
vi.mock('../src/modules/settings/mcp-access/server',()=>({issueMcpKey:state.issue,revokeMcpKey:state.revoke}));
vi.mock('../src/server/context',()=>({requireViewer:state.requireViewer}));
vi.mock('../src/server/data',()=>({prisma:{$queryRaw:vi.fn()}}));
import {POST,DELETE} from '../src/app/api/settings/mcp-keys/route';
import {OperationError} from '../src/lib/operation-error';
const headers={origin:'http://localhost','content-type':'application/json'};
beforeEach(()=>{vi.clearAllMocks();state.requireViewer.mockResolvedValue({user:{id:'u'},workspaceId:'w',membership:{role:'owner'}});state.issue.mockResolvedValue({key:{id:'key'},token:'synthetic-once'});state.revoke.mockResolvedValue({revoked:true});});
describe('API key HTTP entry gates',()=>{
 it('refuses cross-origin requests before reading authentication or issuing keys',async()=>{expect((await POST(new Request('http://localhost/api/settings/mcp-keys',{method:'POST',headers:{...headers,origin:'https://other.test'},body:'{}'}))).status).toBe(403);expect(state.requireViewer).not.toHaveBeenCalled();expect(state.issue).not.toHaveBeenCalled();});
 it('requires current write access and returns the one-time issuance result without caching',async()=>{const input={resourceScope:{version:1,mode:'selected',ids:['a']},confirmation:'CREATE MCP KEY Reader'};const response=await POST(new Request('http://localhost/api/settings/mcp-keys',{method:'POST',headers,body:JSON.stringify(input)}));expect(response.status).toBe(201);expect(state.requireViewer).toHaveBeenCalledWith({feature:'settings/mcp',write:true});expect(state.issue).toHaveBeenCalledWith({userId:'u',workspaceId:'w'},input);expect(response.headers.get('cache-control')).toBe('no-store');});
 it('maps a domain refusal to a safe no-store response rather than issuing a false receipt',async()=>{state.revoke.mockRejectedValue(new OperationError('forbidden','Access changed.'));const response=await DELETE(new Request('http://localhost/api/settings/mcp-keys',{method:'DELETE',headers,body:JSON.stringify({id:'key',confirmation:'REVOKE MCP KEY key'})}));expect(response.status).toBe(403);expect(await response.json()).toEqual({error:'Access changed.',code:'forbidden'});expect(response.headers.get('cache-control')).toBe('no-store');});
});
