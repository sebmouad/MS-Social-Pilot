import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const calls: string[] = [];
const state = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, adAccount: { findFirst: vi.fn(), findMany: vi.fn() }, adInsight: { findFirst: vi.fn() },
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), $transaction: vi.fn(),
  },
  entitlements: vi.fn(), permissions: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(), hasPlatform: vi.fn(), purge: vi.fn(), config: vi.fn(), platformAds: vi.fn(), decrypt: vi.fn(), selectedLock: vi.fn(), selectedOperation: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: state.prisma }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: state.decrypt }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.canUse, hasPlatformCapability: state.hasPlatform }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.canAccess }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: state.platformAds }));
vi.mock('../src/server/platforms/resource-lock', () => ({ lockSelectedResources: state.selectedLock, withSelectedResourceOperation: state.selectedOperation }));

import { clearAdsOpsHosts, registerAdsOpsHost } from '../src/modules/ads/management/registry';
import { ADS_MANAGEMENT_DEFAULT_POLICY } from '../src/modules/ads/management/config';
import { describeAdsManagement, listAdsCreatives, listAdsOperations, parseNeutralOperation, performAdsManagement as performAdsManagementService, pendingRecoveryConfirmation, previewAdsManagement, resolveAdsOperation, resolutionConfirmation } from '../src/modules/ads/management/server';
import { executeAdsManagementTool } from '../src/modules/ads/management/mcp';
import type { AdsNeutralOperation, AdsOpsHost } from '../src/modules/ads/management/types';
import { OperationError } from '../src/lib/operation-error';

const actor = { userId: 'u1', workspaceId: 'w1' };
const pause: AdsNeutralOperation = { type: 'status.set', objectType: 'campaign', objectId: 'c1', status: 'paused' };
const CONFIRM = 'CONFIRM pause c1';
const PAUSE_HASH = createHash('sha256').update(JSON.stringify({ adAccountId: 'acc1', operation: pause })).digest('hex');
const performAdsManagement = (a: Parameters<typeof performAdsManagementService>[0], input: Omit<Parameters<typeof performAdsManagementService>[1], 'requestId'> & { requestId?: unknown }) => performAdsManagementService(a, { ...input, requestId: input.requestId ?? 'request-test-001' });
const execute = vi.fn();
const classify = vi.fn();
const host: AdsOpsHost = {
  provider: 'testnet',
  operations: [{ id: 'status.set', objectTypes: ['campaign', 'ad'], spendChanging: true, label: 'Pause or resume' }, { id: 'rename', objectTypes: ['campaign'], spendChanging: false, label: 'Rename' }],
  validate: op => { if (op.type === 'rename' && !op.name) throw new OperationError('invalid_request', 'Enter a name.'); },
  confirmation: op => `CONFIRM ${op.type === 'status.set' ? (op.status === 'paused' ? 'pause' : 'resume') : op.type} ${op.objectId}`,
  execute: (...args) => execute(...args), classifyFailure: error => classify(error),
  listCreatives: vi.fn(async () => ({ items: [], next: null })),
};

function sqlOf(strings: TemplateStringsArray) { return strings.join('?'); }

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; clearAdsOpsHosts(); registerAdsOpsHost(host);
  state.prisma.user.findUnique.mockResolvedValue({ disabledAt: null });
  state.prisma.membership.findUnique.mockResolvedValue({ role: 'admin' });
  state.entitlements.mockResolvedValue({ workspaceId: 'w1' });
  state.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
  state.canUse.mockReturnValue(true); state.canAccess.mockReturnValue(true); state.hasPlatform.mockReturnValue(true); state.purge.mockResolvedValue(undefined);
  state.selectedLock.mockResolvedValue(undefined);
  state.selectedOperation.mockImplementation(async (_workspaceId: string, _resource: unknown, run: (tx: typeof state.prisma, signal: AbortSignal) => Promise<unknown>) => run(state.prisma, new AbortController().signal));
  state.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : ADS_MANAGEMENT_DEFAULT_POLICY);
  state.decrypt.mockReturnValue('token');
  state.prisma.adAccount.findFirst.mockResolvedValue({ id: 'acc1', actId: 'act_1', currency: 'USD', socialAccount: { provider: 'testnet', accessToken: 'enc', scopes: 'ads_management', invalidatedAt: null, tokenExpiresAt: null } });
  state.prisma.adInsight.findFirst.mockResolvedValue({ id: 'i1' });
  state.platformAds.mockResolvedValue({ isReady: async () => true, manageScopes: async () => ['ads_management'], readScopes: async () => ['ads_read'], validateManageScopes: vi.fn(), hasReadScopes: () => true });
  state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => { calls.push(sqlOf(strings).replace(/\s+/g, ' ').trim().slice(0, 40)); return 1; });
  state.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => /FOR UPDATE/.test(sqlOf(strings)) ? [{ status: 'pending', remoteId: null }] : []);
  state.prisma.$transaction.mockImplementation(async (arg: unknown) => typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(state.prisma) : Promise.all(arg as Promise<unknown>[]));
  execute.mockResolvedValue({ remoteId: 'c1' }); classify.mockReturnValue('uncertain');
});

describe('Ads management service', () => {
  it('records a pending operation before the remote write, then completes it with an audit atomically', async () => {
    execute.mockImplementation(async () => { calls.push('REMOTE'); return { remoteId: 'c1' }; });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(result).toMatchObject({ outcome: 'succeeded', recorded: true, remoteId: 'c1' });
    expect(calls[0]).toMatch(/^INSERT INTO ads_management_operations/);
    expect(calls.indexOf('REMOTE')).toBe(1);
    expect(calls[2]).toMatch(/^UPDATE ads_management_operations/);
    expect(calls[3]).toMatch(/^INSERT INTO root_activities/);
    expect(state.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(state.selectedOperation).toHaveBeenCalledWith('w1', { kind: 'adAccount', id: 'acc1' }, expect.any(Function));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ credential: { accessToken: 'token' }, accountId: 'act_1', signal: expect.anything() }), pause);
  });

  it('replays a successful request key with the original result and does not call the provider again', async () => {
    state.prisma.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_original', requestHash: PAUSE_HASH, status: 'succeeded', remoteId: 'c1' }]);
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-001' });
    expect(result).toMatchObject({ outcome: 'succeeded', operationId: 'adsop_original', remoteId: 'c1', recorded: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a reused request key when its account or operation payload differs', async () => {
    state.prisma.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_original', requestHash: 'different', status: 'succeeded', remoteId: 'c1' }]);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-001' })).rejects.toMatchObject({ code: 'conflict' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['pending', 'uncertain'])('keeps matching %s request keys held without repeating provider I/O', async status => {
    state.prisma.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_open', requestHash: PAUSE_HASH, status, remoteId: null }]);
    if (status === 'uncertain') {
      await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-001' })).resolves.toMatchObject({ outcome: 'uncertain', operationId: 'adsop_open' });
    } else {
      await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-001' })).rejects.toMatchObject({ code: 'conflict' });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns resolved not-applied request IDs as terminal replays', async () => {
    state.prisma.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_done', requestHash: PAUSE_HASH, status: 'resolved_not_applied', remoteId: null }]);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-001' })).resolves.toMatchObject({ outcome: 'rejected', terminal: true, replay: true, status: 'resolved_not_applied' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires a bounded request key before any provider or ledger work', async () => {
    await expect(performAdsManagementService(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(execute).not.toHaveBeenCalled();
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('requires the exact module-owned confirmation and writes nothing otherwise', async () => {
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining(CONFIRM) });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('classifies a definite rejection as rejected and an unknown failure as uncertain, never retrying', async () => {
    classify.mockReturnValueOnce('rejected');
    execute.mockRejectedValueOnce(new Error('provider body secret-token'));
    const rejected = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(rejected).toMatchObject({ outcome: 'rejected' });
    expect(JSON.stringify(rejected)).not.toContain('secret-token');
    execute.mockRejectedValueOnce(new Error('timeout'));
    const uncertain = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(uncertain).toMatchObject({ outcome: 'uncertain', message: expect.stringContaining('Do not repeat') });
    expect(execute).toHaveBeenCalledTimes(2);
    const updates = state.prisma.$executeRaw.mock.calls.filter(([strings]) => /UPDATE ads_management_operations/.test(sqlOf(strings)));
    expect(updates.map(call => call[1])).toEqual(['rejected', 'uncertain']);
  });

  it('blocks a second change while an earlier outcome is unresolved, without calling the provider', async () => {
    state.prisma.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).rejects.toMatchObject({ code: 'conflict' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not call the provider when the ledger is unavailable', async () => {
    state.prisma.$executeRaw.mockRejectedValueOnce(new Error('relation does not exist'));
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).rejects.toMatchObject({ code: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('warns without repeating when the success record cannot be completed', async () => {
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      if (/SET status = 'succeeded'/.test(sqlOf(strings))) throw new Error('db down');
      return 1;
    });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(result).toMatchObject({ outcome: 'uncertain', message: expect.stringContaining('Do not repeat') });
  });

  it('does not audit or claim a record when the compare-and-set affects no row', async () => {
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => { const sql = sqlOf(strings); calls.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40)); return /UPDATE ads_management_operations/.test(sql) ? 0 : 1; });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(result).toMatchObject({ outcome: 'succeeded', recorded: false });
    expect(calls.some(call => /root_activities/.test(call))).toBe(false);
  });

  it('does not audit an uncertain settlement that matched no pending row', async () => {
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => { const sql = sqlOf(strings); calls.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40)); return /UPDATE ads_management_operations/.test(sql) ? 0 : 1; });
    execute.mockRejectedValueOnce(new Error('timeout'));
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).resolves.toMatchObject({ outcome: 'uncertain' });
    expect(calls.some(call => /root_activities/.test(call))).toBe(false);
  });

  it('enforces role, membership, disabled users, feature write, workspace purge and management switch', async () => {
    const attempt = () => performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    state.prisma.membership.findUnique.mockResolvedValueOnce({ role: 'member' });
    await expect(attempt()).rejects.toMatchObject({ code: 'forbidden' });
    state.prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(attempt()).rejects.toMatchObject({ code: 'unauthorized' });
    state.prisma.user.findUnique.mockResolvedValueOnce({ disabledAt: new Date() });
    await expect(attempt()).rejects.toMatchObject({ code: 'unauthorized' });
    state.canAccess.mockReturnValueOnce(false);
    await expect(attempt()).rejects.toMatchObject({ code: 'forbidden' });
    state.purge.mockRejectedValueOnce(new OperationError('unavailable', 'purging'));
    await expect(attempt()).rejects.toMatchObject({ code: 'unavailable' });
    state.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? false : ADS_MANAGEMENT_DEFAULT_POLICY);
    await expect(attempt()).rejects.toMatchObject({ code: 'unavailable' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('scopes the account lookup to the workspace and the actor channel grants', async () => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['t9'] } });
    await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    const where = state.prisma.adAccount.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ id: 'acc1', workspaceId: 'w1', socialAccount: { is: { workspaceId: 'w1', targets: { some: { workspaceId: 'w1', id: { in: ['t9'] } } } } } });
    state.prisma.adAccount.findFirst.mockResolvedValueOnce(null);
    await expect(performAdsManagement(actor, { adAccountId: 'other', operation: pause, confirmation: CONFIRM })).rejects.toMatchObject({ code: 'reconnect_required' });
  });

  it('intersects service channel grants with an authenticated API key target ceiling', async () => {
    const scopedActor = { ...actor, allowedTargetIds: ['key-target'] };
    await performAdsManagement(scopedActor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(state.prisma.adAccount.findFirst.mock.calls[0]![0].where.socialAccount.is.targets).toMatchObject({ some: { id: { in: ['key-target'] } } });
  });

  it('does not dispatch when current write authority disappears after the durable pending intent', async () => {
    const account = { id: 'acc1', actId: 'act_1', currency: 'USD', socialAccount: { provider: 'testnet', accessToken: 'enc', scopes: 'ads_management', invalidatedAt: null, tokenExpiresAt: null } };
    state.prisma.adAccount.findFirst.mockResolvedValueOnce(account).mockResolvedValueOnce({ id: 'acc1' }).mockResolvedValueOnce(null);
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(result).toMatchObject({ outcome: 'rejected', message: expect.stringContaining('No advertising change was sent') });
    expect(execute).not.toHaveBeenCalled();
    expect(state.prisma.$executeRaw.mock.calls.some(([strings]) => /SET status = 'rejected'/.test(sqlOf(strings)))).toBe(true);
  });

  it('holds the selected-account lock through provider dispatch and records lock failure as a known no-write result', async () => {
    const order: string[] = [];
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => { const sql = sqlOf(strings); if (/INSERT INTO ads_management_operations/.test(sql)) order.push('intent'); if (/SET status = 'succeeded'/.test(sql)) order.push('settle'); return 1; });
    state.selectedOperation.mockImplementationOnce(async (_workspaceId: string, _resource: unknown, run: (tx: typeof state.prisma, signal: AbortSignal) => Promise<unknown>) => {
      order.push('lock');
      execute.mockImplementationOnce(async () => { order.push('provider'); return { remoteId: 'c1' }; });
      try { return await run(state.prisma, new AbortController().signal); } finally { order.push('unlock'); }
    });
    await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(order).toEqual(['intent', 'lock', 'provider', 'settle', 'unlock']);

    state.selectedOperation.mockRejectedValueOnce(new OperationError('conflict', 'resource busy'));
    const blocked = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(blocked).toMatchObject({ outcome: 'rejected', message: expect.stringContaining('No advertising change was sent') });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('only allows operations the module advertises and objects verified for the account', async () => {
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: { type: 'delete', objectType: 'campaign', objectId: 'c1' }, confirmation: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: { type: 'rename', objectType: 'ad', objectId: 'a1', name: 'n' }, confirmation: 'x' })).rejects.toMatchObject({ code: 'unavailable' });
    state.prisma.adInsight.findFirst.mockResolvedValueOnce(null);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.prisma.adInsight.findFirst.mock.calls[0]![0].where).toEqual({ adAccountId: 'acc1', level: 'campaign', objectId: 'c1' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when no module registered its operations', async () => {
    clearAdsOpsHosts();
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).rejects.toMatchObject({ code: 'unavailable' });
    expect(await describeAdsManagement(actor, 'acc1')).toEqual({ canManage: false, operations: [], canListCreatives: false });
  });

  it('previews without writing and advertises capabilities only to managers', async () => {
    expect(await previewAdsManagement(actor, { adAccountId: 'acc1', operation: pause })).toMatchObject({ confirmation: CONFIRM, spendChanging: true });
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(await describeAdsManagement(actor, 'acc1')).toMatchObject({ canManage: true, canListCreatives: true });
    state.prisma.membership.findUnique.mockResolvedValueOnce({ role: 'member' });
    expect(await describeAdsManagement(actor, 'acc1')).toMatchObject({ canManage: false, operations: [] });
  });

  it.each([
    [null], [{}], [{ type: 'status.set', objectType: 'campaign', objectId: 'c1', status: 'deleted' }], [{ type: 'status.set', objectType: 'campaign', objectId: 'bad id' }],
    [{ type: 'budget.set', objectType: 'ad', objectId: 'a', budget: { kind: 'daily', minor: 5 } }], [{ type: 'budget.set', objectType: 'campaign', objectId: 'a', budget: { kind: 'daily', minor: 0.5 } }],
    [{ type: 'rename', objectType: 'ad', objectId: 'a', name: 5 }], [{ type: 'creative.assign', objectType: 'campaign', objectId: 'a', creativeId: 'x' }], [{ type: 'delete', objectType: 'ad', objectId: 'a', extra: 1 }],
  ])('rejects malformed operation %j', raw => { expect(() => parseNeutralOperation(raw)).toThrow(OperationError); });
});

describe('Ads management Root-managed bounds and failure handling', () => {
  const rename = (name: string): AdsNeutralOperation => ({ type: 'rename', objectType: 'campaign', objectId: 'c1', name });
  const budget = (minor: number): AdsNeutralOperation => ({ type: 'budget.set', objectType: 'campaign', objectId: 'c1', budget: { kind: 'daily', minor } });
  const budgetHost: AdsOpsHost = { ...host, operations: [...host.operations, { id: 'budget.set', objectTypes: ['campaign'], spendChanging: true, label: 'Budget' }], confirmation: op => `CONFIRM ${op.type} ${op.objectId}` };

  it('enforces the Root name limit before the ledger or provider, and passes limits to the module', async () => {
    const tooLong = rename('x'.repeat(ADS_MANAGEMENT_DEFAULT_POLICY.nameMaxCharacters + 1));
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: tooLong, confirmation: 'CONFIRM rename c1' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: tooLong })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    const validate = vi.spyOn(host, 'validate');
    await previewAdsManagement(actor, { adAccountId: 'acc1', operation: rename('ok') });
    expect(validate).toHaveBeenCalledWith(expect.anything(), { nameMaxCharacters: ADS_MANAGEMENT_DEFAULT_POLICY.nameMaxCharacters, maxBudgetMinor: ADS_MANAGEMENT_DEFAULT_POLICY.maxBudgetMinor });
  });

  it('refuses a budget above the Root single-change cap without any write', async () => {
    clearAdsOpsHosts(); registerAdsOpsHost(budgetHost);
    const over = budget(ADS_MANAGEMENT_DEFAULT_POLICY.maxBudgetMinor + 1);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: over, confirmation: 'CONFIRM budget.set c1' })).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('limit') });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: budget(ADS_MANAGEMENT_DEFAULT_POLICY.maxBudgetMinor), confirmation: 'CONFIRM budget.set c1' })).resolves.toMatchObject({ outcome: 'succeeded' });
  });

  it('fails closed (no provider call) when the management policy is unreadable', async () => {
    state.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : { historyPageLimit: 'bad' });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).rejects.toMatchObject({ code: 'unavailable' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps an unknown outcome held when the module classifier itself throws', async () => {
    execute.mockRejectedValueOnce(new Error('timeout'));
    classify.mockImplementationOnce(() => { throw new Error('classifier bug'); });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    expect(result).toMatchObject({ outcome: 'uncertain', message: expect.stringContaining('Do not repeat') });
    const updates = state.prisma.$executeRaw.mock.calls.filter(([strings]) => /UPDATE ads_management_operations/.test(sqlOf(strings)));
    expect(updates.map(call => call[1])).toEqual(['uncertain']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('treats an unrecognised classification as uncertain rather than rejected', async () => {
    execute.mockRejectedValueOnce(new Error('x'));
    classify.mockReturnValueOnce('maybe');
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM })).resolves.toMatchObject({ outcome: 'uncertain' });
  });

  it('previews an open earlier change as a block, or unknown when the ledger cannot be read, and exposes bounds', async () => {
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'op9' }]);
    expect(await previewAdsManagement(actor, { adAccountId: 'acc1', operation: pause })).toMatchObject({ blockedByOpenChange: true, irreversible: false });
    state.prisma.$queryRaw.mockResolvedValueOnce([]);
    expect(await previewAdsManagement(actor, { adAccountId: 'acc1', operation: pause })).toMatchObject({ blockedByOpenChange: false });
    state.prisma.$queryRaw.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await previewAdsManagement(actor, { adAccountId: 'acc1', operation: pause })).toMatchObject({ blockedByOpenChange: null });
    expect(await describeAdsManagement(actor, 'acc1')).toMatchObject({ limits: { nameMaxCharacters: ADS_MANAGEMENT_DEFAULT_POLICY.nameMaxCharacters, maxBudgetMinor: ADS_MANAGEMENT_DEFAULT_POLICY.maxBudgetMinor } });
    expect(state.prisma.$queryRaw.mock.calls[0]).toContain('w1');
  });
});

describe('Ads change history and resolution', () => {
  const stale = { id: 'op1', adAccountId: 'acc1', actorId: 'u2', operationType: 'status.set', objectType: 'campaign', objectId: 'c1', params: pause, status: 'uncertain', remoteId: null, failureCode: 'unknown_outcome', createdAt: new Date('2026-10-17T10:00:00Z'), completedAt: null, resolvedBy: null, resolvedAt: null, resolutionNote: null };
  it('lists retained accounts in current scope and flags pending or uncertain changes for review', async () => {
    state.prisma.adAccount.findMany.mockResolvedValue([{ id: 'acc1' }]);
    state.prisma.$queryRaw.mockResolvedValue([{ ...stale, status: 'pending' }, { ...stale, id: 'op2', status: 'succeeded' }]);
    const result = await listAdsOperations(actor, { adAccountId: 'acc1' });
    expect(state.prisma.adAccount.findMany.mock.calls[0]![0].where).toMatchObject({ workspaceId: 'w1' });
    expect(state.prisma.adAccount.findMany.mock.calls[0]![0].where).not.toHaveProperty('enabled');
    expect(state.prisma.$queryRaw.mock.calls[0]).toContain('w1');
    expect(result.items.map(item => item.needsResolution)).toEqual([true, false]);
    expect(result.items[0]?.resolutionKind).toBe('pending_recovery');
    expect(result.items.map(item => item.onHold)).toEqual([true, false]);
    state.prisma.adAccount.findMany.mockResolvedValue([{ id: 'accX' }]);
    expect((await listAdsOperations(actor, { adAccountId: 'acc1' })).items).toEqual([]);
    await expect(listAdsOperations(actor, { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('resolves an unknown outcome by attestation with confirmation, audit and no provider call', async () => {
    state.prisma.$queryRaw.mockResolvedValue([stale]);
    const confirmation = resolutionConfirmation('op1', 'not_applied');
    await expect(resolveAdsOperation(actor, { operationId: 'op1', resolution: 'not_applied', confirmation: 'ok' })).rejects.toMatchObject({ code: 'invalid_request' });
    const result = await resolveAdsOperation(actor, { operationId: 'op1', resolution: 'not_applied', note: 'checked in the platform', confirmation });
    expect(result).toMatchObject({ operationId: 'op1', status: 'resolved_not_applied', receipt: { affectedRows: 1 } });
    expect(execute).not.toHaveBeenCalled();
    expect(calls).toEqual(expect.arrayContaining([expect.stringMatching(/^UPDATE ads_management_operations/), expect.stringMatching(/^INSERT INTO root_activities/)]));
  });

  it('recovers a stranded pending intent with a distinct confirmation and permits retained accounts', async () => {
    const pending = { ...stale, status: 'pending' };
    state.prisma.$queryRaw.mockResolvedValue([pending]);
    const confirmation = pendingRecoveryConfirmation('op1', 'not_applied');
    await expect(resolveAdsOperation(actor, { operationId: 'op1', resolution: 'not_applied', confirmation: resolutionConfirmation('op1', 'not_applied') })).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining(confirmation) });
    const result = await resolveAdsOperation(actor, { operationId: 'op1', resolution: 'not_applied', note: 'confirmed not applied', confirmation });
    expect(result).toMatchObject({ status: 'resolved_not_applied', recoveredPending: true });
    expect(state.prisma.adAccount.findFirst.mock.calls.at(-1)?.[0].where).not.toHaveProperty('enabled');
    expect(state.selectedOperation).toHaveBeenCalledWith('w1', { kind: 'adAccount', id: 'acc1' }, expect.any(Function));
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses pending recovery when the selected-account lock is busy and leaves the ledger unchanged', async () => {
    state.prisma.$queryRaw.mockResolvedValue([{ ...stale, status: 'pending' }]);
    state.selectedOperation.mockRejectedValueOnce(new OperationError('conflict', 'Account operation is active.'));
    const input = { operationId: 'op1', resolution: 'not_applied' as const, confirmation: pendingRecoveryConfirmation('op1', 'not_applied') };
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('serializes pending recovery against dispatch and prevents late recovery from overwriting success', async () => {
    let releaseProvider!: (value: { remoteId: string }) => void;
    let active = false;
    let storedStatus = 'pending';
    const order: string[] = [];
    state.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => /FOR UPDATE/.test(sqlOf(strings))
      ? [{ status: storedStatus, remoteId: storedStatus === 'succeeded' ? 'c1' : null }]
      : [{ ...stale, status: 'pending' }]);
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      if (/SET status = 'succeeded'/.test(sql)) { storedStatus = 'succeeded'; order.push('settled'); }
      return 1;
    });
    state.selectedOperation.mockImplementation(async (_workspaceId: string, _resource: unknown, run: (tx: typeof state.prisma, signal: AbortSignal) => Promise<unknown>) => {
      if (active) throw new OperationError('conflict', 'Account operation is active.');
      active = true; order.push('locked');
      try { return await run(state.prisma, new AbortController().signal); } finally { active = false; order.push('unlocked'); }
    });
    execute.mockImplementationOnce(() => new Promise(resolve => { releaseProvider = resolve; }));
    const inFlight = performAdsManagement(actor, { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const recovery = { operationId: 'op1', resolution: 'not_applied' as const, confirmation: pendingRecoveryConfirmation('op1', 'not_applied') };
    await expect(resolveAdsOperation(actor, recovery)).rejects.toMatchObject({ code: 'conflict' });
    expect(storedStatus).toBe('pending');
    releaseProvider({ remoteId: 'c1' });
    await expect(inFlight).resolves.toMatchObject({ outcome: 'succeeded', recorded: true });
    expect(order).toEqual(['locked', 'settled', 'unlocked']);
    await expect(resolveAdsOperation(actor, recovery)).rejects.toMatchObject({ code: 'conflict' });
    expect(storedStatus).toBe('succeeded');
  });

  it('rejects resolving settled, missing, concurrently-resolved or non-manager requests', async () => {
    const input = { operationId: 'op1', resolution: 'applied' as const, confirmation: resolutionConfirmation('op1', 'applied') };
    state.prisma.$queryRaw.mockResolvedValue([{ ...stale, status: 'succeeded' }]);
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    state.prisma.$queryRaw.mockResolvedValue([{ ...stale, status: 'pending', createdAt: new Date(0) }]);
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    state.prisma.adAccount.findFirst.mockResolvedValueOnce(null);
    state.prisma.$queryRaw.mockResolvedValue([stale]);
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'not_found' });
    state.prisma.$queryRaw.mockResolvedValue([]);
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'not_found' });
    state.prisma.$queryRaw.mockResolvedValue([stale]);
    calls.length = 0;
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => { calls.push(sqlOf(strings).trim().slice(0, 60)); return 0; });
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(calls.some(call => /root_activities/.test(call))).toBe(false);
    state.prisma.membership.findUnique.mockResolvedValueOnce({ role: 'editor' });
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.prisma.$queryRaw.mock.calls.every(call => call.includes('w1'))).toBe(true);
  });

  it('lists creatives through the module with bounded pages, and MCP rejects unexpected input', async () => {
    await expect(listAdsCreatives(actor, { adAccountId: 'acc1', limit: 999 })).resolves.toEqual({ items: [], next: null });
    expect(host.listCreatives).toHaveBeenCalledWith(expect.anything(), { limit: ADS_MANAGEMENT_DEFAULT_POLICY.creativePageLimit });
    await expect(executeAdsManagementTool(actor, 'apply_ads_change', { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-mcp-001', extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAdsManagementTool(actor, 'apply_ads_change', { adAccountId: 'acc1', operation: pause, confirmation: CONFIRM, requestId: 'request-mcp-001' })).resolves.toMatchObject({ outcome: 'succeeded' });
  });
});
