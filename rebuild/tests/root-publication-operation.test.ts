import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ root:vi.fn(), workspace:vi.fn(), targetLock:vi.fn(), query:vi.fn(), transaction:vi.fn(), owner:true, acquired:true, values:new Map<string,number>() }));
vi.mock('../src/server/root/operations', () => ({ requireActiveRoot:state.root }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig:async (key:string) => state.values.get(key) }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation:state.workspace }));
vi.mock('../src/modules/publishing/server/guard', () => ({ lockPublishingTargets:state.targetLock }));
vi.mock('../src/server/data', () => ({ prisma:{ $transaction:state.transaction } }));
import { withRootPublicationOperation } from '../src/server/root/publication-operation';
const scope={ workspaceId:'workspace',postId:'post',targetId:'target' };
const tx={ $queryRaw:state.query };
beforeEach(() => {
  vi.clearAllMocks(); state.owner=true;state.acquired=true;
  state.values=new Map(Object.entries({ 'publishing.transactionTimeoutMs':15000,'publishing.transactionMaxWaitMs':5000,'publishing.identifierMaxCharacters':200,'publishing.operationTimeoutMs':60000,'publishing.operationMaxWaitMs':2000,'data.workspaceOperationTimeoutMs':300000 }));
  state.root.mockResolvedValue(undefined);state.targetLock.mockResolvedValue(undefined);
  state.workspace.mockImplementation((_id:string, run:()=>Promise<unknown>) => run());
  state.query.mockImplementation((strings:TemplateStringsArray) => strings.join('').includes('FROM users') ? [{ isInstanceOwner:state.owner,disabledAt:null }] : [{ acquired:state.acquired }]);
  state.transaction.mockImplementation((run:(tx:unknown)=>Promise<unknown>) => run(tx));
});
afterEach(() => vi.useRealTimers());
describe('shared private publication operation boundary', () => {
  it('holds workspace, post, destination and current-owner locks across local recovery', async () => {
    const result=await withRootPublicationOperation('root',scope,async (locked,signal)=>{
      expect(locked).toBe(tx);expect(signal.aborted).toBe(false);
      expect(state.targetLock).toHaveBeenCalledWith(tx,'workspace',['target']);return 'done';
    });
    expect(result).toBe('done');expect(state.root).toHaveBeenCalledTimes(2);
    expect(state.workspace).toHaveBeenCalledWith('workspace',expect.any(Function));
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function),{timeout:15000,maxWait:5000});
    expect(JSON.stringify(state.query.mock.calls)).toContain('publishing-post');
    expect(state.query.mock.calls.some(([strings])=>strings.join('').includes('FOR SHARE'))).toBe(true);
  });
  it('uses the shared remote-operation budget without giving child receipts an outer row lock', async () => {
    await withRootPublicationOperation('root',scope,async()=>true,{remote:true});
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function),{timeout:102000,maxWait:2000});
    expect(state.query.mock.calls.some(([strings])=>strings.join('').includes('rebuild_publication_attempts'))).toBe(false);
  });
  it('denies stale Root authority before a side effect', async () => {
    state.owner=false;const run=vi.fn();
    await expect(withRootPublicationOperation('root',scope,run,{remote:true})).rejects.toMatchObject({code:'forbidden'});expect(run).not.toHaveBeenCalled();
  });
  it('denies concurrent post work before taking a destination lock', async () => {
    state.acquired=false;const run=vi.fn();
    await expect(withRootPublicationOperation('root',scope,run)).rejects.toMatchObject({code:'conflict'});expect(run).not.toHaveBeenCalled();expect(state.targetLock).not.toHaveBeenCalled();
  });
  it('refuses malformed scope or unavailable limits before opening the operation', async () => {
    await expect(withRootPublicationOperation('root',{...scope,postId:'bad\npost'},vi.fn())).rejects.toMatchObject({code:'invalid_request'});
    state.values.set('publishing.identifierMaxCharacters',0);
    await expect(withRootPublicationOperation('root',scope,vi.fn())).rejects.toMatchObject({code:'unavailable'});expect(state.transaction).not.toHaveBeenCalled();
  });
  it('refuses a remote budget that cannot fit inside its workspace operation', async () => {
    state.values.set('data.workspaceOperationTimeoutMs',100000);
    await expect(withRootPublicationOperation('root',scope,vi.fn(),{remote:true})).rejects.toMatchObject({code:'unavailable'});expect(state.workspace).not.toHaveBeenCalled();
  });
  it('exposes cancellation and clears its timer after a completed operation', async () => {
    vi.useFakeTimers();
    await withRootPublicationOperation('root',scope,async (_tx,signal)=>{await vi.advanceTimersByTimeAsync(60000);expect(signal.aborted).toBe(true);},{remote:true});
    expect(vi.getTimerCount()).toBe(0);
  });
});
