import { beforeEach, expect, it, vi } from 'vitest';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
import { OperationError } from '@/lib/operation-error';
const m = vi.hoisted(() => ({
  selected: true, token: 'encrypted', locked: false,
  target: { findMany: vi.fn(), findFirst: vi.fn() }, instagramAccount: { findFirst: vi.fn(), update: vi.fn() },
  instagramInsight: { upsert: vi.fn() }, appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  audit: vi.fn(), source: vi.fn(), access: vi.fn(), config: vi.fn(), profile: vi.fn(), account: vi.fn(), stop: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: m }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/platforms/instagram/source-binding', () => ({ assertInstagramSource: m.source }));
vi.mock('@/server/secret-crypto', () => ({ decryptSecret: () => 'decrypted' }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: m.access }));
vi.mock('@/server/jobs/job-context', () => ({ jobStopRequested: m.stop, jobAbortSignal: () => undefined }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_w: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: async (_w: string, _r: unknown, fn: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => { m.locked = true; try { return await fn({ ...m, $executeRaw: m.audit }, new AbortController().signal); } finally { m.locked = false; } } }));
vi.mock('@/platforms/instagram/runtime', () => ({ configuredInstagramPolicy: async () => INSTAGRAM_POLICY_DEFAULTS, configuredInstagramCollector: async () => ({ profile: m.profile, account: m.account }) }));
import { syncInstagramAnalytics } from '@/platforms/instagram/jobs';
const now = new Date();
beforeEach(() => {
  vi.resetAllMocks(); m.selected = true; m.token = 'encrypted'; m.locked = false;
  m.config.mockImplementation(async (key: string) => key === 'platforms.instagram.enabled' ? true : 10);
  m.appSetting.findUnique.mockResolvedValue(null);
  m.target.findMany.mockResolvedValue([{ id: 'target', workspaceId: 'workspace', providerId: 'remote', socialAccountId: 'connection' }]);
  m.target.findFirst.mockImplementation(async () => m.selected ? { accessToken: m.token, socialAccountId: 'connection', socialAccount: { scopes: [...new Set([...INSTAGRAM_POLICY_DEFAULTS.insightScopes, ...INSTAGRAM_POLICY_DEFAULTS.readScopes])].join(','), tokenExpiresAt: null } } : null);
  m.instagramAccount.findFirst.mockResolvedValue({ id: 'account' });
  m.profile.mockImplementation(async () => { expect(m.locked).toBe(false); return { followersCount: 100, fetchedAt: now }; });
  m.account.mockImplementation(async () => { expect(m.locked).toBe(false); return { rows: [{ metric: 'reach', period: 'day', asOf: now, value: 25, rangeTotal: true, raw: { name: 'reach', total_value: { value: 25 } } }], failedMetrics: [] }; });
});
it('collects outside locks and retains range/raw provenance with system audit', async () => {
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
  expect(m.access).toHaveBeenCalledWith('workspace', { provider: 'instagram', anyFeatureOf: ['analytics/overview'] });
  expect(m.instagramInsight.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ accountId: 'account', numeric: 25, value: expect.objectContaining({ instagramHostVersion: 1, rangeTotal: true, raw: { name: 'reach', total_value: { value: 25 } } }) }) }));
  expect(m.audit).toHaveBeenCalled();
});
it('does not fetch for workspace owners without the required plan/platform access', async () => {
  m.access.mockRejectedValue(new OperationError('forbidden', 'denied'));
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.profile).not.toHaveBeenCalled(); expect(m.instagramInsight.upsert).not.toHaveBeenCalled();
});
it('discards fetched data after deselection', async () => {
  m.profile.mockImplementation(async () => { m.selected = false; return { followersCount: 100, fetchedAt: now }; });
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.instagramInsight.upsert).not.toHaveBeenCalled(); expect(m.instagramAccount.update).not.toHaveBeenCalled();
});
it('discards fetched data after credential rotation', async () => {
  m.profile.mockImplementation(async () => { m.token = 'rotated'; return { followersCount: 100, fetchedAt: now }; });
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.instagramInsight.upsert).not.toHaveBeenCalled();
});
it('refuses persistence when current owner access is revoked after fetch', async () => {
  m.access.mockResolvedValueOnce(undefined).mockRejectedValue(new OperationError('forbidden', 'revoked'));
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.instagramInsight.upsert).not.toHaveBeenCalled();
});
it('reports partial metric failure instead of zero-filled data', async () => {
  m.account.mockResolvedValue({ rows: [], failedMetrics: ['reach'] });
  m.profile.mockResolvedValue({ followersCount: null, fetchedAt: now });
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 1, skipped: 0, failed: 1 });
  expect(m.instagramInsight.upsert).not.toHaveBeenCalled();
  expect(m.instagramAccount.update).toHaveBeenCalledWith({ where: { id: 'account' }, data: { followersCount: null, followsCount: null, mediaCount: null, lastSyncedAt: now } });
});
it('query binds target, provider, workspace, connection and account identities', async () => {
  await syncInstagramAnalytics(now);
  expect(m.target.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'target', workspaceId: 'workspace', providerId: 'remote', socialAccountId: 'connection', enabled: true, socialAccount: { is: { workspaceId: 'workspace', provider: 'instagram', invalidatedAt: null } } }) }));
  expect(m.instagramAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'workspace', targetId: 'target', igUserId: 'remote', socialAccountId: 'connection', enabled: true } }));
});

it('keeps series and range totals under separate storage identities', async () => {
  m.account.mockResolvedValue({ rows: [false, true].map(rangeTotal => ({ metric: 'views', period: 'day', asOf: now, value: 3, rangeTotal, raw: {} })), failedMetrics: [] });
  await syncInstagramAnalytics(now);
  expect(m.instagramInsight.upsert.mock.calls.map(call => call[0].where.accountId_metric_period_endTime.period)).toEqual(['day', 'day:range']);
});

it('discards data when the linked source loses selection during fetch', async () => {
  m.source.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('source deselected'));
  await expect(syncInstagramAnalytics(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.instagramInsight.upsert).not.toHaveBeenCalled();
});
