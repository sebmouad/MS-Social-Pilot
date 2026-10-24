import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), ent: vi.fn(), perms: vi.fn(), use: vi.fn(), can: vi.fn(), guard: vi.fn(), accounts: vi.fn(), data: vi.fn(), parent: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { user: { findUnique: m.user }, membership: { findUnique: m.member } } }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.ent, canUseFeature: m.use, entitledPlatformIds: () => ['example'] }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.perms }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: m.can }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: m.guard }));
vi.mock('@/server/config/store', async () => { const { recordsCopyDefaults } = await import('@/modules/analytics/records-copy'); const { errorCopyDefaults } = await import('@/modules/analytics/error-copy'); return { runtimeConfig: (key: string) => key === 'analytics.recordsCopy' ? Promise.resolve(recordsCopyDefaults) : key === 'analytics.errorCopy' ? Promise.resolve(errorCopyDefaults) : m.config(key) }; });
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: m.accounts, getAdsDataset: m.data }));
vi.mock('@/server/platforms/registry', () => ({ platformAds: async () => ({ parentObjectId: m.parent }) }));
import { readAdObjects } from './service';
const actor = { userId: 'u', workspaceId: 'w' };
const insight = (level = 'campaign', id = 'c', account = 'a') => ({ id: `${account}-${id}`, adAccountId: account, level, objectId: id, objectName: id, date: new Date('2026-10-01Z'), fetchedAt: new Date('2026-10-02Z'), spend: 10, impressions: 100, clicks: 2, reach: 60, cpc: 5, cpm: 100, cpp: null, ctr: 2, frequency: null, actions: [], fields: { parent: 'c', access_token: 'secret' }, adAccount: { id: account, name: account, currency: 'USD' } });
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ disabledAt: null }); m.member.mockResolvedValue({ role: 'editor' }); m.ent.mockResolvedValue({ workspaceId: 'w' }); m.perms.mockResolvedValue({ pageScope: { all: false, ids: ['t', 'q'] } }); m.use.mockReturnValue(true); m.can.mockReturnValue(true);
  m.config.mockImplementation(async (key: string) => ({ 'analytics.defaultRangeDays': 30, 'analytics.maxRangeDays': 366, 'analytics.adObjects.pageSize': 2, 'analytics.adObjects.maxRows': 10, 'analytics.adObjects.maxBytes': 100000 }[key]));
  m.accounts.mockResolvedValue([{ id: 'a', name: 'Account', currency: 'USD', socialAccount: { provider: 'example' } }]);
  m.data.mockResolvedValue({ insights: [insight(), insight('adset', 's'), insight('ad', 'ad') ] }); m.parent.mockReturnValue('c');
});
it('reads one level and resolves stored parents without combining overlapping levels', async () => {
  const result = await readAdObjects(actor, { start: '2026-10-01', end: '2026-10-03' });
  expect(result.items).toHaveLength(1); expect(result.items[0].spend).toBe(10); expect(result.coverage).toMatchObject({ selectedAccounts: 1, coveredAccounts: 1 });
  expect(m.use).toHaveBeenCalledWith(expect.anything(), 'analytics/ads');
  expect(m.data).toHaveBeenCalledWith('w', expect.objectContaining({ accountId: null }), ['t', 'q'], ['example'], expect.objectContaining({ levels: ['campaign', 'adset', 'ad'] }));
});
it('intersects current grants with independent credential ad-target and account ceilings', async () => {
  await readAdObjects({ ...actor, allowedChannelIds: [], adAccountTargetScope: { all: false, ids: ['t', 'outside'] }, allowedAdAccountIds: ['a'] }, {});
  expect(m.accounts).toHaveBeenCalledWith('w', ['t'], ['example'], ['a']);
});
it('refuses stale/disabled/nonmember/denied access before reading data', async () => {
  m.member.mockResolvedValueOnce(null); await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'forbidden' });
  m.user.mockResolvedValueOnce({ disabledAt: new Date() }); await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'forbidden' });
  m.can.mockReturnValueOnce(false); await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.data).not.toHaveBeenCalled();
});
it('requires an explicit account and the matching parent level for drill-down', async () => {
  for (const input of [{ level: 'adset', parentId: 'c' }, { accountId: 'a', parentId: 'c' }, { accountId: 'outside' }, { start: '2026-02-30' }, { page: -1 }]) await expect(readAdObjects(actor, input)).rejects.toMatchObject({ code: expect.stringMatching(/invalid_request|forbidden/) });
  const result = await readAdObjects(actor, { accountId: 'a', level: 'adset', parentId: 'c' });
  expect(result.items.map(item => item.objectId)).toEqual(['s']);
  m.parent.mockReturnValue(null);
  const missing = await readAdObjects(actor, { accountId: 'a', level: 'adset', parentId: 'c' });
  expect(missing.items).toEqual([]); expect(missing.coverage.unknownParentObjects).toBe(1);
});
it('retains sanitized daily fields and refuses oversized exports rather than truncating', async () => {
  const result = await readAdObjects(actor, { format: 'csv', locale: 'fr' });
  expect(result.csv).toContain('Non disponible'); expect(JSON.stringify(result)).not.toContain('secret');
  m.config.mockImplementation(async (key: string) => key === 'analytics.adObjects.maxRows' ? 1 : key === 'analytics.adObjects.maxBytes' ? 100000 : 30);
  await expect(readAdObjects(actor, { format: 'csv' })).rejects.toMatchObject({ code: 'invalid_request' });
});
it('bounds MCP payload including daily details and offers stable page continuation', async () => {
  await expect(readAdObjects({ ...actor, maxResultItems: 1 }, {})).rejects.toMatchObject({ code: 'invalid_request' });
});
it('accepts an actual unfiltered GET form without widening explicit malformed selections', async () => {
  const data = await readAdObjects(actor, { start: '', end: '', accountId: '', parentId: '', objectId: '', level: 'campaign' });
  expect(data.items).toHaveLength(1);
  await expect(readAdObjects(actor, { accountId: ['a', 'b'] })).rejects.toMatchObject({ code: 'invalid_request' });
});
it('returns all authorized account choices while keeping the data on the selected account', async () => {
  m.accounts.mockResolvedValueOnce([{ id: 'a', name: 'A', currency: 'USD', socialAccount: { provider: 'example' } }, { id: 'b', name: 'B', currency: 'EUR', socialAccount: { provider: 'example' } }]);
  const result = await readAdObjects(actor, { accountId: 'a' });
  expect(result.options.map(a => a.id)).toEqual(['a', 'b']); expect(result.coverage.selectedAccounts).toBe(1);
});
it('fails closed when selected account binding changes or a dataset exceeds bounds', async () => {
  m.data.mockResolvedValueOnce({ insights: [insight('campaign', 'c', 'outside')] });
  await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'forbidden' });
  m.data.mockResolvedValueOnce({ insights: Array.from({ length: 11 }, () => insight()) });
  await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'invalid_request' });
});
it('continues stable object pages and exports the whole selection independent of current page', async () => {
  m.data.mockResolvedValue({ insights: [insight('campaign', '1'), insight('campaign', '2'), insight('campaign', '3')] });
  const first = await readAdObjects(actor, {}), next = await readAdObjects(actor, { page: first.nextPage });
  expect(first.items.map(i => i.objectId)).toEqual(['1', '2']); expect(next.items.map(i => i.objectId)).toEqual(['3']); expect(next.nextPage).toBeNull();
  const result = await readAdObjects(actor, { format: 'csv', page: 999 }); expect(result.items).toHaveLength(3); expect(result.csv).toContain('"3"');
});
it('rejects unexpected input keys, arrays, zero pages and exhausted byte budgets', async () => {
  for (const raw of [{ surprise: true }, { level: ['campaign', 'ad'] }, { page: 0 }]) await expect(readAdObjects(actor, raw)).rejects.toMatchObject({ code: 'invalid_request' });
  m.config.mockImplementation(async (key: string) => key === 'analytics.adObjects.maxBytes' ? 1 : 30);
  await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'invalid_request' });
});
it('an all-target credential still intersects current channel grants; explicit no-account access stays empty', async () => {
  await readAdObjects({ ...actor, allowedChannelIds: [], adAccountTargetScope: { all: true } }, {});
  expect(m.accounts).toHaveBeenLastCalledWith('w', ['t', 'q'], ['example'], undefined);
  m.accounts.mockResolvedValueOnce([]); m.data.mockResolvedValueOnce({ insights: [] });
  const empty = await readAdObjects({ ...actor, allowedAdAccountIds: [] }, {});
  expect(m.accounts).toHaveBeenLastCalledWith('w', ['t', 'q'], ['example'], []);
  expect(empty.items).toEqual([]); expect(empty.coverage.selectedAccounts).toBe(0);
});
it('denies changed plan access and a workspace purge without returning stored data', async () => {
  m.use.mockReturnValueOnce(false);
  await expect(readAdObjects(actor, {})).rejects.toMatchObject({ code: 'forbidden' });
  m.guard.mockRejectedValueOnce(new Error('purge guard'));
  await expect(readAdObjects(actor, {})).rejects.toThrow('purge guard'); expect(m.data).not.toHaveBeenCalled();
});
it('requires page scalars rather than JavaScript coercion of booleans or arrays', async () => {
  for (const page of [true, null, ['1']]) await expect(readAdObjects(actor, { page })).rejects.toMatchObject({ code: 'invalid_request' });
});

it('aggregates selection-wide account daily totals pre-paging for the trend hero', async () => {
  m.data.mockResolvedValue({ insights: [
    { ...insight('campaign', 'c1'), id: 'a-c1', objectName: 'c1', date: new Date('2026-10-01Z'), spend: 10, impressions: 100 },
    { ...insight('campaign', 'c2'), id: 'a-c2', objectId: 'c2', objectName: 'c2', date: new Date('2026-10-01Z'), spend: 5, impressions: 50 },
    { ...insight('campaign', 'c1'), id: 'a-c1-2', objectName: 'c1', date: new Date('2026-10-02Z'), spend: 7, impressions: 70 },
  ] });
  const result = await readAdObjects(actor, { start: '2026-10-01', end: '2026-10-03' });
  expect(result.accountDaily).toEqual([{ accountId: 'a', accountName: 'a', currency: 'USD', daily: [
    { date: '2026-10-01', spend: 15, impressions: 150 }, { date: '2026-10-02', spend: 7, impressions: 70 },
  ] }]);
});
it('sorts the full filtered selection before paging and CSV with stable ties', async () => {
  m.data.mockResolvedValue({ insights: [
    { ...insight('campaign', 'a'), spend: 10 }, { ...insight('campaign', 'b'), spend: 90 },
    { ...insight('campaign', 'c'), spend: 90 },
  ] });
  const first = await readAdObjects(actor, { sort: 'spend', direction: 'desc' });
  expect(first.items.map(i => i.objectId)).toEqual(['b', 'c']);
  const next = await readAdObjects(actor, { sort: 'spend', direction: 'desc', page: first.nextPage });
  expect(next.items.map(i => i.objectId)).toEqual(['a']);
  const csv = await readAdObjects(actor, { sort: 'spend', direction: 'desc', page: 2, format: 'csv' });
  expect(csv.items.map(i => i.objectId)).toEqual(['b', 'c', 'a']);
  expect(csv.csv!.split('\r\n').filter(line => line.startsWith('"summary"')).map(line => line.split(',')[8])).toEqual(['"b"', '"c"', '"a"']);
  for (const input of [{ sort: 'token' }, { sort: ['spend'] }, { direction: 'sideways' }]) {
    await expect(readAdObjects(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
  }
});
