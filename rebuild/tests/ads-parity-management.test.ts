import { withPlatformAdsLocale } from '../src/server/platforms/host';
vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const calls: string[] = [];
const state = vi.hoisted(() => ({
  prisma: {
    target: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, adAccount: { findFirst: vi.fn(), findMany: vi.fn() }, adInsight: { findFirst: vi.fn() },
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), $transaction: vi.fn(),
  },
  image: vi.fn(), images: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(), hasPlatform: vi.fn(), purge: vi.fn(), config: vi.fn(), platformAds: vi.fn(), decrypt: vi.fn(), selectedLock: vi.fn(), selectedOperation: vi.fn(),
}));
vi.mock('../src/modules/publishing/server/media/storage', () => ({ readWorkspaceImage: state.image, listWorkspaceImages: state.images }));
vi.mock('../src/server/data', () => ({ prisma: state.prisma }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: state.decrypt }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.canUse, hasPlatformCapability: state.hasPlatform }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.canAccess }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge, withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock('../src/server/context', () => ({ requireViewer: async () => ({ user: { id: 'u1' }, workspaceId: 'w1' }) }));
vi.mock('../src/server/request-origin', () => ({ requestOrigin: (request: Request) => new URL(request.url).origin }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: state.platformAds }));
vi.mock('../src/server/platforms/resource-lock', () => ({ lockSelectedResources: state.selectedLock, withSelectedResourceOperation: state.selectedOperation }));

import { clearAdsOpsHosts, registerAdsOpsHost } from '../src/modules/ads/management/registry';
import { ADS_MANAGEMENT_DEFAULT_POLICY } from '../src/modules/ads/management/config';
import { describeAdsManagement, listAdsCreatives, listAdsOperations, parseNeutralOperation, performAdsManagement as performAdsManagementService, pendingRecoveryConfirmation, listAdsCreativeSources, previewAdsManagement, resolveAdsOperation, resolutionConfirmation } from '../src/modules/ads/management/server';
import { POST as managementPost } from '../src/app/api/ads/management/route';
import { executeAdsManagementTool } from '../src/modules/ads/management/mcp';
import type { AdsNeutralOperation, AdsOpsHost } from '../src/modules/ads/management/types';
import { OperationError } from '../src/lib/operation-error';
import { AdsNoDispatchError, adsNoDispatchMetadata } from '../src/modules/ads/management/errors';
import { withAdsErrorBoundary } from '@/modules/ads/server/errors';

const actor = { userId: 'u1', workspaceId: 'w1' };
const pause: AdsNeutralOperation = { type: 'status.set', objectType: 'campaign', objectId: 'c1', status: 'paused' };
const CONFIRM = 'CONFIRM pause c1';
const PAUSE_HASH = createHash('sha256').update(JSON.stringify({ adAccountId: 'acc1', operation: pause })).digest('hex');
const performAdsManagement = (a: Parameters<typeof performAdsManagementService>[0], input: Omit<Parameters<typeof performAdsManagementService>[1], 'requestId'> & { requestId?: unknown }) => performAdsManagementService(a, { ...input, requestId: input.requestId ?? 'request-test-001' });
const execute = vi.fn();
const classify = vi.fn();
const host: AdsOpsHost = {
  provider: 'testnet',
  operations: [{ id: 'status.set', objectTypes: ['campaign', 'ad'], spendChanging: true, label: 'Pause or resume' }, { id: 'rename', objectTypes: ['campaign'], spendChanging: false, label: 'Rename' },
    { id: 'campaign.create', objectTypes: ['campaign'], spendChanging: true, label: 'Create campaign' }, { id: 'adset.create', objectTypes: ['adset'], spendChanging: true, label: 'Create ad set' }],
  validate: op => { if (op.type === 'rename' && !op.name) throw new OperationError('invalid_request', 'Enter a name.'); },
  confirmation: op => op.type === 'campaign.create' ? `CREATE PAUSED CAMPAIGN ${op.name}` : op.type === 'adset.create' ? `CREATE PAUSED AD SET ${op.name} UNDER ${op.parentId}` : op.type === 'creative.create' ? `CREATE CREATIVE ${op.name}` : op.type === 'ad.create' ? `CREATE PAUSED AD ${op.name} UNDER ${op.parentId} WITH ${op.creativeId}` : `CONFIRM ${op.type === 'status.set' ? (op.status === 'paused' ? 'pause' : 'resume') : op.type} ${op.objectId}`,
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
    expect(calls[3]).toMatch(/^UPDATE ads_objects/);
    expect(calls[4]).toMatch(/^INSERT INTO root_activities/);
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
    expect(await describeAdsManagement(actor, 'acc1')).toEqual({ canManage: false, needsReconnect: false, operations: [], canListCreatives: false });
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
  const budgetHost: AdsOpsHost = { ...host, operations: [...host.operations, { id: 'budget.set', objectTypes: ['campaign'], spendChanging: true, label: 'Budget' }], confirmation: op => `CONFIRM ${op.type} ${'objectId' in op ? op.objectId : ''}` };

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


describe('paused campaign and ad set creation through the shared journal', () => {
  const campaign: AdsNeutralOperation = { type: 'campaign.create', objectType: 'campaign', name: 'Spring', objective: 'OUTCOME_TRAFFIC' };
  const adset: AdsNeutralOperation = { type: 'adset.create', objectType: 'adset', parentId: 'c1', name: 'Prospecting', dailyBudgetMinor: 5000, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' };
  const CAMPAIGN_CONFIRM = 'CREATE PAUSED CAMPAIGN Spring';
  const ADSET_CONFIRM = 'CREATE PAUSED AD SET Prospecting UNDER c1';
  const hashOf = (operation: AdsNeutralOperation) => createHash('sha256').update(JSON.stringify({ adAccountId: 'acc1', operation })).digest('hex');
  const duplicate = () => state.prisma.$executeRaw.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
  const updates = () => state.prisma.$executeRaw.mock.calls.filter(([strings]) => /UPDATE ads_management_operations/.test(sqlOf(strings)));

  it('parses creation strictly: no objectId or status, bounded fields, trimmed names', () => {
    expect(parseNeutralOperation({ ...campaign, name: ' Spring ' })).toEqual(campaign);
    expect(parseNeutralOperation(adset)).toEqual(adset);
    for (const bad of [
      { ...campaign, objectId: 'x' }, { ...campaign, status: 'active' }, { ...campaign, objectType: 'adset' }, { ...campaign, objective: '' }, { ...campaign, objective: 'a b' }, { ...campaign, name: 5 },
      { ...adset, objectId: 'x' }, { ...adset, status: 'active' }, { ...adset, objectType: 'campaign' }, { ...adset, parentId: 'bad id' }, { ...adset, parentId: undefined },
      { ...adset, dailyBudgetMinor: 0 }, { ...adset, dailyBudgetMinor: 1.5 }, { ...adset, countryCode: 'ma' }, { ...adset, optimizationGoal: 'a/b' },
    ]) expect(() => parseNeutralOperation(bad), JSON.stringify(bad)).toThrow(OperationError);
  });

  it('journals the intent before provider I/O, sends the exact operation, and returns created only after provider success', async () => {
    execute.mockImplementation(async () => { calls.push('REMOTE'); return { remoteId: 'camp-new' }; });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM });
    expect(result).toMatchObject({ outcome: 'succeeded', recorded: true, remoteId: 'camp-new', created: { objectType: 'campaign', remoteId: 'camp-new' } });
    expect(calls[0]).toMatch(/^INSERT INTO ads_management_operations/);
    expect(calls.indexOf('REMOTE')).toBe(1);
    const insert = state.prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(insert).toContain('campaign.create'); expect(insert).toContain('@create-campaign');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'act_1' }), campaign);
    expect(JSON.stringify(execute.mock.calls[0][1])).not.toMatch(/status|objectId/);
  });

  it('creates an ad set only under a parent verified from the account history and journals it per parent', async () => {
    execute.mockResolvedValue({ remoteId: 'adset-new' });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: adset, confirmation: ADSET_CONFIRM });
    expect(result).toMatchObject({ outcome: 'succeeded', created: { objectType: 'adset', remoteId: 'adset-new' } });
    expect(state.prisma.adInsight.findFirst).toHaveBeenCalledWith({ where: { adAccountId: 'acc1', level: 'campaign', objectId: 'c1' }, select: { id: true } });
    expect(state.prisma.$executeRaw.mock.calls[0] as unknown[]).toContain('@create-adset:c1');
  });

  it('refuses an unverified parent campaign before any ledger write or provider call', async () => {
    state.prisma.adInsight.findFirst.mockResolvedValue(null);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: adset, confirmation: ADSET_CONFIRM })).rejects.toMatchObject({ code: 'not_found' });
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: adset })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it('refuses ad set creation for limited page scope but still allows campaign creation inside its ceiling', async () => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['t1'] } });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: adset, confirmation: ADSET_CONFIRM })).rejects.toMatchObject({ code: 'forbidden' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    execute.mockResolvedValue({ remoteId: 'camp-new' });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM })).resolves.toMatchObject({ outcome: 'succeeded' });
    expect(state.prisma.adAccount.findFirst.mock.calls[0][0].where.socialAccount.is.targets.some).toEqual({ workspaceId: 'w1', id: { in: ['t1'] } });
  });

  it('intersects an API-key target ceiling with the account lookup', async () => {
    execute.mockResolvedValue({ remoteId: 'camp-new' });
    await performAdsManagement({ ...actor, allowedTargetIds: ['t9'] }, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM });
    expect(state.prisma.adAccount.findFirst.mock.calls[0][0].where.socialAccount.is.targets.some).toEqual({ workspaceId: 'w1', id: { in: ['t9'] } });
  });

  it('requires the module confirmation and Root name and budget limits before writing', async () => {
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining(CAMPAIGN_CONFIRM) });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: { ...campaign, name: '' }, confirmation: 'CREATE PAUSED CAMPAIGN ' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: { ...adset, dailyBudgetMinor: ADS_MANAGEMENT_DEFAULT_POLICY.maxBudgetMinor + 1 }, confirmation: ADSET_CONFIRM })).rejects.toMatchObject({ message: expect.stringContaining('above the limit') });
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it('replays a recorded creation with created identity and never resends', async () => {
    duplicate();
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_c', requestHash: hashOf(campaign), status: 'succeeded', remoteId: 'camp-1', operationType: 'campaign.create', objectType: 'campaign' }]);
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-001' });
    expect(result).toMatchObject({ outcome: 'succeeded', replay: true, created: { objectType: 'campaign', remoteId: 'camp-1' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not claim a created object for an attested resolution replay', async () => {
    duplicate();
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_c', requestHash: hashOf(campaign), status: 'resolved_applied', remoteId: null, operationType: 'campaign.create', objectType: 'campaign' }]);
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-001' });
    expect(result).toMatchObject({ outcome: 'succeeded', status: 'resolved_applied' });
    expect(result).not.toHaveProperty('created');
  });

  it('refuses a request key reused with any different creation payload', async () => {
    duplicate();
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_a', requestHash: hashOf(adset), status: 'succeeded', remoteId: 'a1', operationType: 'adset.create', objectType: 'adset' }]);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: { ...adset, dailyBudgetMinor: 5001 }, confirmation: ADSET_CONFIRM, requestId: 'request-001' })).rejects.toMatchObject({ code: 'conflict' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['pending', 'uncertain'])('holds a matching %s creation without resending and blocks a different request on the same open key', async status => {
    duplicate();
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'adsop_o', requestHash: hashOf(campaign), status, remoteId: null, operationType: 'campaign.create', objectType: 'campaign' }]);
    const held = performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-001' });
    if (status === 'uncertain') await expect(held).resolves.toMatchObject({ outcome: 'uncertain', operationId: 'adsop_o' }); else await expect(held).rejects.toMatchObject({ code: 'conflict' });
    duplicate();
    state.prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-002' })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('no confirmed outcome') });
    expect(execute).not.toHaveBeenCalled();
  });

  it('never marks an ambiguous intent-commit failure as not dispatched', async () => {
    state.prisma.$transaction.mockRejectedValueOnce(new Error('connection lost while committing'));
    const failure = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-001' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OperationError);
    expect((failure as OperationError).message).toContain('Check Ads change history');
    expect(adsNoDispatchMetadata(failure)).toEqual({});
    expect(execute).not.toHaveBeenCalled();
  });

  it('marks a later preflight refusal of the same request id as this send only and never touches the recorded request', async () => {
    // The original send already succeeded or is unknown; a later policy/confirmation refusal must change nothing persisted.
    const failure = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: 'stale confirmation', requestId: 'request-001' }).catch((error: unknown) => error);
    expect(adsNoDispatchMetadata(failure)).toEqual({ attempt: 'not_dispatched' });
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the typed marker through the Ads error boundary and drops it for any other error', async () => {
    const marked = new AdsNoDispatchError('conflict', 'Blocked.', 'blocked_by_other_request');
    await expect(withAdsErrorBoundary(async () => { throw marked; })).rejects.toBe(marked);
    const plain = await withAdsErrorBoundary(async () => { throw new Error('provider internals'); }).catch((error: unknown) => error);
    expect(adsNoDispatchMetadata(plain)).toEqual({});
    expect((plain as OperationError).message).not.toContain('provider internals');
  });

  it('records provider rejection without created, and ambiguity as uncertain without created', async () => {
    classify.mockReturnValueOnce('rejected');
    execute.mockRejectedValueOnce(new Error('bad'));
    const rejected = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM });
    expect(rejected).toMatchObject({ outcome: 'rejected' }); expect(rejected).not.toHaveProperty('created');
    execute.mockRejectedValueOnce(new Error('timeout'));
    const uncertain = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-test-002' });
    expect(uncertain).toMatchObject({ outcome: 'uncertain' }); expect(uncertain).not.toHaveProperty('created');
    expect(updates().map(call => call[1])).toEqual(['rejected', 'uncertain']);
  });

  it.each([undefined, '', 'bad id!'])('treats a provider success with remoteId %j as uncertain, never as created', async remoteId => {
    execute.mockResolvedValue(remoteId === undefined ? {} : { remoteId });
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM });
    expect(result).toMatchObject({ outcome: 'uncertain' }); expect(result).not.toHaveProperty('created'); expect(result).not.toHaveProperty('remoteId');
    expect(JSON.stringify(updates()[0])).toContain('missing_remote_id');
  });

  it('rechecks authority under the lock and rejects without dispatch when ad set scope narrows', async () => {
    let calls = 0;
    state.permissions.mockImplementation(async () => (++calls === 1 ? { pageScope: { all: true, ids: [] } } : { pageScope: { all: false, ids: ['t1'] } }));
    const result = await performAdsManagement(actor, { adAccountId: 'acc1', operation: adset, confirmation: ADSET_CONFIRM });
    expect(result).toMatchObject({ outcome: 'rejected', message: expect.stringContaining('No advertising change was sent') });
    expect(execute).not.toHaveBeenCalled();
  });

  it('preview reports a creation as spend-changing with the module confirmation and the held-object lookup keyed by creation', async () => {
    const preview = await previewAdsManagement(actor, { adAccountId: 'acc1', operation: adset });
    expect(preview).toMatchObject({ confirmation: ADSET_CONFIRM, spendChanging: true });
    const heldQuery = state.prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(heldQuery).toContain('@create-adset:c1');
  });

  it('describes creation inputs only if the module advertises them, and drives MCP apply with the same service', async () => {
    execute.mockResolvedValue({ remoteId: 'camp-new' });
    const result = await executeAdsManagementTool(actor, 'apply_ads_change', { adAccountId: 'acc1', operation: campaign, confirmation: CAMPAIGN_CONFIRM, requestId: 'request-mcp-001' });
    expect(result).toMatchObject({ outcome: 'succeeded', created: { objectType: 'campaign', remoteId: 'camp-new' } });
  });
});


describe('neutral stored-media creative creation', () => {
  const creative = { type: 'creative.create', objectType: 'creative', name: 'Summer offer', targetId: 't1', mediaId: '8260d067-4caf-41c6-b129-c6558fbe0865', format: 'link', message: 'A new season', title: 'See the offer', linkUrl: 'https://example.test/offer' } as const;
  const confirmation = 'CREATE CREATIVE Summer offer';
  beforeEach(() => {
    clearAdsOpsHosts(); registerAdsOpsHost({ ...host, creativeIdentityKinds: ['channel'], operations: [...host.operations, { id: 'creative.create', objectTypes: ['creative'], spendChanging: false, label: 'Create creative' }] });
    state.prisma.target.findFirst.mockResolvedValue({ providerId: 'remote-t1', type: 'channel' });
    state.prisma.target.findMany.mockResolvedValue([{ id: 't1', name: 'Example' }]);
    state.image.mockReset().mockResolvedValue({ bytes: Buffer.from('image'), mimeType: 'image/png' });
    state.images.mockResolvedValue({ items: [{ id: creative.mediaId, mimeType: 'image/png', heldBy: ['private holder'], size: 5 }], nextCursor: null });
  });
  const apply = (overrides = {}) => performAdsManagement(actor, { adAccountId: 'acc1', operation: creative, confirmation, ...overrides });
  it('parses a neutral normalized operation and rejects delivery, arbitrary image URLs and raw provider identity', () => {
    expect(parseNeutralOperation({ ...creative, name: ' Summer offer ' })).toEqual(creative);
    for (const extra of [{ status: 'active' }, { imageUrl: 'https://private.test' }, { pageId: 'raw-provider' }, { objectId: 'ad' }]) expect(() => parseNeutralOperation({ ...creative, ...extra })).toThrow();
    for (const linkUrl of ['http://example.test', 'https://user:password@example.test', 'javascript:alert(1)']) expect(() => parseNeutralOperation({ ...creative, linkUrl })).toThrow();
    expect(() => parseNeutralOperation({ ...creative, objectType: 'ad' })).toThrow();
    expect(() => parseNeutralOperation({ ...creative, format: 'image' })).toThrow();
  });
  it('persists intent before dispatch and independently commits intermediate receipts before settlement', async () => {
    execute.mockImplementation(async (context) => { calls.push('REMOTE'); await context.recordReceipt({ imageHash: 'hash' }); return { remoteId: 'creative-new' }; });
    const result = await apply();
    expect(result).toMatchObject({ outcome: 'succeeded', created: { objectType: 'creative', remoteId: 'creative-new' } });
    expect(calls[0]).toMatch(/^INSERT INTO ads_management_operations/);
    expect(calls[1]).toBe('REMOTE');
    expect(calls[2]).toMatch(/^INSERT INTO root_activities/);
    expect(execute.mock.calls[0][0].creative).toMatchObject({ identityId: 'remote-t1', identityKind: 'channel', image: { mimeType: 'image/png' } });
    expect(state.selectedLock).toHaveBeenCalledWith(state.prisma, 'w1', [{ kind: 'target', id: 't1' }]);
    expect(JSON.stringify(state.prisma.$executeRaw.mock.calls)).not.toContain('aW1hZ2U=');
  });
  it('never resolves arbitrary channel identities or foreign workspace media', async () => {
    state.prisma.target.findFirst.mockResolvedValueOnce(null);
    await expect(apply()).rejects.toMatchObject({ code: 'not_found' });
    expect(execute).not.toHaveBeenCalled(); expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    state.image.mockRejectedValueOnce(new Error('foreign file path'));
    await expect(apply()).rejects.toMatchObject({ code: 'not_found' });
    expect(state.prisma.target.findFirst.mock.calls[0][0].where).toMatchObject({ workspaceId: 'w1', enabled: true, socialAccount: { is: { provider: 'testnet', adAccounts: { some: { id: 'acc1' } } } } });
    expect(state.image).toHaveBeenCalledWith('w1', creative.mediaId);
  });
  it('enforces independent key account and channel ceilings before media or provider access', async () => {
    await expect(performAdsManagement({ ...actor, allowedTargetIds: [] }, { adAccountId: 'acc1', operation: creative, confirmation })).rejects.toMatchObject({ code: 'forbidden' });
    state.prisma.adAccount.findFirst.mockResolvedValueOnce(null);
    await expect(performAdsManagement({ ...actor, allowedAdAccountIds: [] }, { adAccountId: 'acc1', operation: creative, confirmation })).rejects.toMatchObject({ code: 'reconnect_required' });
    expect(state.image).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('rechecks deselection and current channel permission under the dispatch lock', async () => {
    state.prisma.target.findFirst.mockResolvedValueOnce({ providerId: 'remote-t1', type: 'channel' }).mockResolvedValueOnce(null);
    await expect(apply()).resolves.toMatchObject({ outcome: 'rejected' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('fails closed when management is disabled or confirmation is stale', async () => {
    await expect(apply({ confirmation: 'stale' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.config.mockImplementation(async key => key === 'ads.managementEnabled' ? false : ADS_MANAGEMENT_DEFAULT_POLICY);
    await expect(apply()).rejects.toMatchObject({ code: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('holds ambiguous and missing-id outcomes without inventing creation receipts', async () => {
    execute.mockRejectedValueOnce(new Error('timeout'));
    await expect(apply()).resolves.toMatchObject({ outcome: 'uncertain' });
    execute.mockResolvedValueOnce({});
    const result = await apply({ requestId: 'request-second' });
    expect(result).toMatchObject({ outcome: 'uncertain' }); expect(result).not.toHaveProperty('created');
  });
  it('replays a successful request before requiring an image that may since have been removed', async () => {
    const hash = createHash('sha256').update(JSON.stringify({ adAccountId: 'acc1', operation: creative })).digest('hex');
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'recorded', requestHash: hash, status: 'succeeded', remoteId: 'creative-new', operationType: 'creative.create' }]);
    state.image.mockRejectedValueOnce(new Error('removed'));
    await expect(apply()).resolves.toMatchObject({ replay: true, created: { objectType: 'creative', remoteId: 'creative-new' } });
    expect(state.image).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('replays human attestations without inventing a creative identity or a delivery state', async () => {
    const hash = createHash('sha256').update(JSON.stringify({ adAccountId: 'acc1', operation: creative })).digest('hex');
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'reviewed', requestHash: hash, status: 'resolved_applied', remoteId: null, operationType: 'creative.create' }]);
    const result = await apply();
    expect(result).toMatchObject({ outcome: 'succeeded', status: 'resolved_applied', replay: true });
    expect(result).not.toHaveProperty('created'); expect(execute).not.toHaveBeenCalled();
  });
  it('refuses a changed payload under the same durable request identity', async () => {
    state.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'recorded', requestHash: 'different', status: 'succeeded' }]);
    await expect(apply()).rejects.toMatchObject({ code: 'conflict' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('lists scoped bounded sources with storage and holder details excluded', async () => {
    const result = await listAdsCreativeSources({ ...actor, allowedTargetIds: ['t1'] }, { adAccountId: 'acc1' });
    expect(result.images).toEqual([{ id: creative.mediaId, mimeType: 'image/png' }]);
    expect(state.prisma.target.findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: 'w1', id: { in: ['t1'] }, type: { in: ['channel'] } }, take: 26 });
    expect(JSON.stringify(result)).not.toContain('holder');
  });
  it('MCP apply uses the same journal and authenticated actor scope', async () => {
    const result = await executeAdsManagementTool(actor, 'apply_ads_change', { adAccountId: 'acc1', operation: creative, confirmation, requestId: 'request-mcp-creative' });
    expect(result).toMatchObject({ outcome: 'succeeded', created: { objectType: 'creative' } });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

// The UI submits these actions to the session REST endpoint. Exercise the real
// endpoint and MCP handler against the real service, mocking only infrastructure.
describe.each(['service', 'UI/REST', 'MCP'] as const)('Ads authorization via %s', surface => {
  const kinds = ['create', 'edit', 'delete', 'recover', 'reconcile'] as const;
  type Kind = typeof kinds[number];
  const row = (kind: Kind) => ({ id: 'op1', adAccountId: 'acc1', operationType: 'status.set', params: pause, status: kind === 'recover' ? 'pending' : 'uncertain' });
  async function invoke(kind: Kind) {
    const recovering = kind === 'recover' || kind === 'reconcile';
    const operation: AdsNeutralOperation = kind === 'create'
      ? { type: 'campaign.create', objectType: 'campaign', name: 'Scoped campaign', objective: 'traffic' }
      : kind === 'edit' ? { type: 'rename', objectType: 'campaign', objectId: 'c1', name: 'Updated campaign' }
      : { type: 'delete', objectType: 'campaign', objectId: 'c1' };
    const input = recovering
      ? { operationId: 'op1', resolution: 'not_applied' as const, confirmation: kind === 'recover' ? pendingRecoveryConfirmation('op1', 'not_applied') : resolutionConfirmation('op1', 'not_applied') }
      : { adAccountId: 'acc1', operation, confirmation: host.confirmation(operation, { adAccountId: 'acc1', currency: 'USD' }), requestId: 'authorization-request-001' };
    if (surface === 'MCP') return executeAdsManagementTool(actor, recovering ? 'resolve_ads_change' : 'apply_ads_change', input);
    if (surface === 'UI/REST') {
      const response = await managementPost(new Request('http://localhost/api/ads/management', {
        method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify({ action: recovering ? 'resolve' : 'apply', ...input }),
      }));
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error), { code: result.code });
      return result;
    }
    return recovering ? resolveAdsOperation(actor, input as Parameters<typeof resolveAdsOperation>[1]) : performAdsManagementService(actor, input as Parameters<typeof performAdsManagementService>[1]);
  }
  beforeEach(() => {
    clearAdsOpsHosts();
    clearAdsOpsHosts();
    registerAdsOpsHost({ ...host, operations: [...host.operations, { id: 'delete', objectTypes: ['campaign'], spendChanging: false, irreversible: true, label: 'Delete' }] });
  });
  const noWrites = () => {
    expect(execute).not.toHaveBeenCalled();
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  };
  it.each(kinds)('refuses viewer %s before any writes', async kind => {
    state.prisma.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(invoke(kind)).rejects.toMatchObject({ code: 'forbidden' });
    noWrites();
    expect(state.selectedOperation).not.toHaveBeenCalled();
  });
  it.each(kinds)('refuses %s outside current channel scope', async kind => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['allowed-channel'] } });
    state.prisma.adAccount.findFirst.mockResolvedValue(null);
    state.prisma.$queryRaw.mockResolvedValue([row(kind)]);
    await expect(invoke(kind)).rejects.toMatchObject({ code: kind === 'recover' || kind === 'reconcile' ? 'not_found' : 'reconnect_required' });
    expect(state.prisma.adAccount.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'acc1', workspaceId: 'w1', socialAccount: { is: { workspaceId: 'w1', targets: { some: { workspaceId: 'w1', id: { in: ['allowed-channel'] } } } } },
    });
    noWrites();
    expect(state.selectedOperation).not.toHaveBeenCalled();
  });
  it.each(kinds)('allows authorized administrator %s', async kind => {
    const recovering = kind === 'recover' || kind === 'reconcile';
    if (recovering) state.prisma.$queryRaw.mockResolvedValue([row(kind)]);
    expect(await invoke(kind)).toMatchObject(recovering ? { status: 'resolved_not_applied' } : { outcome: 'succeeded' });
    expect(state.prisma.$executeRaw.mock.calls.some(([sql]) => /INSERT INTO root_activities/.test(sqlOf(sql)))).toBe(true);
    expect(execute).toHaveBeenCalledTimes(recovering ? 0 : 1);
  });
  it.each(kinds)('allows %s within a limited administrator channel scope', async kind => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['allowed-channel'] } });
    const recovering = kind === 'recover' || kind === 'reconcile';
    if (recovering) state.prisma.$queryRaw.mockResolvedValue([row(kind)]);
    expect(await invoke(kind)).toMatchObject(recovering ? { status: 'resolved_not_applied' } : { outcome: 'succeeded' });
    // The retained-account and current-authority checks must both carry the scope.
    const lookups = state.prisma.adAccount.findFirst.mock.calls.filter(([args]) => args.where.socialAccount);
    expect(lookups.length).toBe(2);
    for (const [args] of lookups) expect(args.where.socialAccount.is.targets.some.id.in).toEqual(['allowed-channel']);
  });
  it.each(['recover', 'reconcile'] as const)('rechecks channel scope under the lock for %s', async kind => {
    state.prisma.$queryRaw.mockResolvedValue([row(kind)]);
    state.permissions.mockResolvedValueOnce({ pageScope: { all: true } }).mockResolvedValue({ pageScope: { all: false, ids: [] } });
    state.prisma.adAccount.findFirst.mockResolvedValueOnce({ id: 'acc1' }).mockResolvedValue(null);
    await expect(invoke(kind)).rejects.toMatchObject({ code: 'not_found' });
    expect(state.prisma.adAccount.findFirst.mock.calls.at(-1)![0].where.socialAccount.is.targets.some.id.in).toEqual([]);
    expect(state.selectedOperation).toHaveBeenCalledOnce();
    noWrites();
  });
  it.each(['recover', 'reconcile'] as const)('refuses role revoked under the lock for %s', async kind => {
    state.prisma.$queryRaw.mockResolvedValue([row(kind)]);
    state.prisma.membership.findUnique.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValue({ role: 'viewer' });
    await expect(invoke(kind)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.selectedOperation).toHaveBeenCalledOnce();
    noWrites();
  });
});


describe('Ads recovery independent credential ceilings', () => {
  it.each(['pending', 'uncertain'] as const)('intersects membership and key targets for %s recovery', async status => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['shared', 'member-only'] } });
    state.prisma.$queryRaw.mockResolvedValue([{ id: 'op1', adAccountId: 'acc1', operationType: 'status.set', params: pause, status }]);
    const confirmation = status === 'pending' ? pendingRecoveryConfirmation('op1', 'not_applied') : resolutionConfirmation('op1', 'not_applied');
    await resolveAdsOperation({ ...actor, allowedTargetIds: ['shared', 'key-only'], allowedAdAccountIds: ['acc1'] }, { operationId: 'op1', resolution: 'not_applied', confirmation });
    expect(state.prisma.adAccount.findFirst).toHaveBeenCalledTimes(2);
    for (const [args] of state.prisma.adAccount.findFirst.mock.calls) {
      expect(args.where).toMatchObject({ id: 'acc1', workspaceId: 'w1', AND: [{ id: { in: ['acc1'] } }], socialAccount: { is: { workspaceId: 'w1', targets: { some: { id: { in: ['shared'] } } } } } });
      expect(args.where).not.toHaveProperty('enabled');
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    { allowedAdAccountIds: [] }, { allowedTargetIds: [] },
  ])('refuses recovery with empty ceiling %j', async ceiling => {
    state.prisma.$queryRaw.mockResolvedValue([{ id: 'op1', adAccountId: 'acc1', operationType: 'status.set', params: pause, status: 'pending' }]);
    state.prisma.adAccount.findFirst.mockResolvedValue(null);
    await expect(resolveAdsOperation({ ...actor, ...ceiling }, { operationId: 'op1', resolution: 'not_applied', confirmation: pendingRecoveryConfirmation('op1', 'not_applied') })).rejects.toMatchObject({ code: 'not_found' });
    const where = state.prisma.adAccount.findFirst.mock.calls[0]![0].where;
    if ('allowedAdAccountIds' in ceiling) expect(where.AND).toEqual([{ id: { in: [] } }]);
    else expect(where.socialAccount.is.targets.some.id.in).toEqual([]);
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not disclose recovery state or confirmation for an invisible account', async () => {
    state.prisma.$queryRaw.mockResolvedValue([{ id: 'op1', adAccountId: 'acc1', operationType: 'status.set', params: pause, status: 'pending' }]);
    state.prisma.adAccount.findFirst.mockResolvedValue(null);
    await expect(resolveAdsOperation(actor, { operationId: 'op1', resolution: 'not_applied', confirmation: 'wrong' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('contract audit runtime policy and locale', () => {
  it('enforces a non-default recovery note limit through service, REST and MCP', async () => {
    state.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : { ...ADS_MANAGEMENT_DEFAULT_POLICY, recoveryNoteMaxCharacters: 3 });
    const input = { operationId: 'op1', resolution: 'applied' as const, note: 'long', confirmation: resolutionConfirmation('op1', 'applied') };
    await expect(resolveAdsOperation(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAdsManagementTool(actor, 'resolve_ads_change', input)).rejects.toMatchObject({ code: 'invalid_request' });
    const response = await managementPost(new Request('https://example.test/api/ads/management', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resolve', ...input }) }));
    expect(response.status).toBe(400);
    expect(state.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('enforces non-default creative field and parent limits before dispatch', async () => {
    const policy = { ...ADS_MANAGEMENT_DEFAULT_POLICY, creativeMessageMaxCharacters: 3, creativeTitleMaxCharacters: 2, creativeUrlMaxCharacters: 20, parentIdMaxCharacters: 2 };
    state.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : policy);
    const creative = { type: 'creative.create', objectType: 'creative', name: 'Creative', targetId: 't1', mediaId: 'image', format: 'link', message: 'ok', title: 'ok', linkUrl: 'https://ex.test' };
    for (const operation of [{ ...creative, message: 'long' }, { ...creative, title: 'long' }, { ...creative, linkUrl: 'https://example.test/long' }, { type: 'ad.create', objectType: 'ad', parentId: 'abc', name: 'Ad', creativeId: 'c1' }]) {
      await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation })).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(executeAdsManagementTool(actor, 'preview_ads_change', { adAccountId: 'acc1', operation })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it('passes French locale from REST and MCP scope to the platform host', async () => {
    const response = await managementPost(new Request('https://example.test/api/ads/management', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', 'accept-language': 'fr' }, body: JSON.stringify({ action: 'preview', adAccountId: 'acc1', operation: pause }) }));
    expect(response.status).toBe(200);
    expect(state.platformAds).toHaveBeenCalledWith('testnet', 'fr');
    state.platformAds.mockClear();
    await withPlatformAdsLocale('fr', () => executeAdsManagementTool(actor, 'get_ads_management_options', { adAccountId: 'acc1' }));
    expect(state.platformAds).toHaveBeenCalledWith('testnet', 'fr');
  });
});

describe('objects without delivery', () => {
  it('creates, renames and deletes a paused campaign through the shared service without any insight rows', async () => {
    clearAdsOpsHosts();
    registerAdsOpsHost({ ...host, operations: [...host.operations, { id: 'delete', objectTypes: ['campaign'], spendChanging: false, irreversible: true, label: 'Delete' }] });
    state.prisma.adInsight.findFirst.mockResolvedValue(null);
    let object: { objectId: string; name: string } | null = null;
    state.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlOf(strings);
      if (sql.includes('INSERT INTO ads_objects')) object = values[5] === 'deleted' ? null : { objectId: values[2] as string, name: values[3] as string };
      if (sql.includes('UPDATE ads_objects SET name')) object = { ...object!, name: values[0] as string };
      if (sql.includes('DELETE FROM ads_objects')) object = null;
      return 1;
    });
    state.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = sqlOf(strings);
      if (sql.includes('FROM ads_objects')) return object ? [object] : [];
      if (sql.includes('FOR UPDATE')) return [{ status: 'pending', remoteId: null }];
      return [];
    });
    const create = { type: 'campaign.create', objectType: 'campaign', name: 'Autumn launch', objective: 'traffic' } as const;
    const preview = await previewAdsManagement(actor, { adAccountId: 'acc1', operation: create });
    expect(await performAdsManagement(actor, { adAccountId: 'acc1', operation: create, confirmation: preview.confirmation })).toMatchObject({ outcome: 'succeeded' });
    expect(object).toEqual({ objectId: 'c1', name: 'Autumn launch' });
    const rename = { type: 'rename', objectType: 'campaign', objectId: 'c1', name: 'Winter launch' } as const;
    const renamePreview = await previewAdsManagement(actor, { adAccountId: 'acc1', operation: rename });
    expect(await performAdsManagement(actor, { adAccountId: 'acc1', operation: rename, confirmation: renamePreview.confirmation })).toMatchObject({ outcome: 'succeeded' });
    expect(object).toEqual({ objectId: 'c1', name: 'Winter launch' });
    const remove = { type: 'delete', objectType: 'campaign', objectId: 'c1' } as const;
    const deletePreview = await previewAdsManagement(actor, { adAccountId: 'acc1', operation: remove });
    expect(await performAdsManagement(actor, { adAccountId: 'acc1', operation: remove, confirmation: deletePreview.confirmation })).toMatchObject({ outcome: 'succeeded' });
    expect(object).toBeNull();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('uses the account-verified provider read for an object absent locally', async () => {
    state.prisma.adInsight.findFirst.mockResolvedValue(null);
    const read = vi.fn(async () => ({ id: 'c1', accountId: '1' }));
    state.platformAds.mockResolvedValue({ operations: host, manageScopes: async () => ['ads_management'], validateManageScopes: vi.fn(), read });
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: pause })).resolves.toHaveProperty('confirmation');
    expect(read).toHaveBeenCalledWith({ credential: { accessToken: 'token' }, accountId: 'act_1', objectId: 'c1', objectType: 'campaign' });
    read.mockRejectedValueOnce(new Error('outside selected account'));
    await expect(previewAdsManagement(actor, { adAccountId: 'acc1', operation: pause })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
