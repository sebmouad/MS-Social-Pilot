import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ accounts: vi.fn(), insights: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { adAccount: { findMany: db.accounts }, adInsight: { findMany: db.insights } } }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({ workspaceId: 'w', provider: { in: ['facebook'] }, invalidatedAt: null }) }));
vi.mock('@/modules/ads/server/access', () => ({ authorizeAdsRead: async () => ({ allowedProviders: ['facebook'] }) }));
vi.mock('@/modules/ads/server/copy', async () => {
  const { defaultAdsCatalogs, customerText } = await import('@/modules/ads/copy');
  return { withAdsCopySnapshot: (run: () => Promise<unknown>) => run(), adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) };
});
vi.mock('@/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: async () => ({ presets: [{ id: '28d', days: 28, label: 'Last 28 days' }], defaultPreset: '28d', maxRangeDays: 90, maxFilterCharacters: 200 }) }));
vi.mock('@/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: async () => ({ pageSize: 2, maxRows: 100 }) }));
vi.mock('@/modules/ads/server/output-policy', () => ({ loadAdsOutputPolicy: async () => ({ detailMaxBytes: 1048576 }) }));

import { readAdsDailyRows } from '@/modules/ads/server/report-read';
import { readAdsPerformance } from '@/modules/ads/server/performance';
import { summarizeInsights } from '@/modules/ads/server/summary';
import { spendByCurrency } from '@/modules/home/server/overview-pure';

const account = { id: 'selected', actId: 'act_159977536979568', name: 'Example account', currency: 'USD' };
// The collection worker stores major-unit numeric spend and preserves provider strings in fields.
const row = (id: string, day: string, spend: string, level = 'account', accountId = 'selected', currency = 'USD') => ({
  id, adAccountId: accountId, level, objectId: level === 'account' ? account.actId : `${level}-1`, objectName: 'Example',
  date: new Date(`${day}T00:00:00Z`), fetchedAt: new Date('2026-10-17T06:00:00Z'), spend: Number(spend),
  impressions: 100, clicks: 2, reach: 50, cpc: null, cpm: null, cpp: null, ctr: null, frequency: null, actions: [],
  fields: { spend, date_start: day, report_level: level, account_currency: currency }, adAccount: { ...account, id: accountId, currency },
});
const fixtures = [
  row('first', '2026-09-24', '10.25'), row('middle', '2026-10-15', '20.10'), row('last', '2026-10-16', '0.65'),
  row('outside-before', '2026-09-23', '1000'), row('outside-after', '2026-10-22', '1000'),
  ...['campaign', 'adset', 'ad'].map(level => row(level, '2026-10-16', '30.00', level)),
  row('unselected', '2026-10-16', '9999', 'account', 'other', 'EUR'),
];

describe('Home spend through the real Ads read and normalization services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.accounts.mockResolvedValue([account]);
    db.insights.mockImplementation(async ({ where }: { where: { adAccount: { id: { in: string[] } }; level: { in: string[] }; date: { gte: Date; lt: Date } } }) =>
      fixtures.filter(row => where.adAccount.id.in.includes(row.adAccountId) && where.level.in.includes(row.level) && row.date >= where.date.gte && row.date < where.date.lt));
  });

  it('counts account days once, applies inclusive UTC dates, pages fully and ignores raw string fields', async () => {
    const rows = [];
    let offset = 0;
    for (;;) {
      const page = await readAdsDailyRows({ userId: 'u', workspaceId: 'w' }, { start: '2026-09-24', end: '2026-10-21', level: 'account', offset });
      rows.push(...page.rows);
      expect(page.range).toEqual({ from: '2026-09-24', to: '2026-10-22', endExclusive: true });
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    expect(rows.map(row => row.id)).toEqual(['last', 'middle', 'first']);
    expect(rows[0]).toMatchObject({ spend: 0.65, currency: 'USD', fields: { spend: '0.65' } });
    const [total] = spendByCurrency(rows);
    expect(total.currency).toBe('USD');
    expect(total.total).toBeCloseTo(31);
    expect(total.daily.map(day => day.date)).toEqual(['2026-09-24', '2026-10-15', '2026-10-16']);
    expect(db.insights).toHaveBeenCalledTimes(2);
  });

  it('keeps additional selected currencies separate without converting major units', async () => {
    db.accounts.mockResolvedValue([account, { ...account, id: 'eur', currency: 'EUR' }]);
    db.insights.mockResolvedValue([row('usd', '2026-10-16', '12.30'), row('eur', '2026-10-16', '7.70', 'account', 'eur', 'EUR')]);
    const page = await readAdsDailyRows({ userId: 'u', workspaceId: 'w' }, { start: '2026-10-16', end: '2026-10-16', level: 'account' });
    expect(spendByCurrency(page.rows)).toMatchObject([{ currency: 'EUR', total: 7.7 }, { currency: 'USD', total: 12.3 }]);
  });
});


describe('Ads performance on the same retained USD days at every hierarchy level', () => {
  it('keeps hierarchy totals independent and recalculates ratios from sums, never stored daily averages', async () => {
    const stored = ['account', 'campaign', 'adset', 'ad'].flatMap(level => [
      { ...row(`${level}-older`, '2026-10-15', '10.25', level), impressions: 100, clicks: 1, reach: 80, cpc: 10.25, cpm: 102.5, ctr: 1, cpp: 0.128125, frequency: 1.25, actions: [{ action_type: 'link_click', value: '1' }] },
      { ...row(`${level}-latest`, '2026-10-16', '20.75', level), impressions: 900, clicks: 99, reach: 600, cpc: 20.75 / 99, cpm: 20.75 * 1000 / 900, ctr: 11, cpp: 20.75 / 600, frequency: 1.5, actions: [{ action_type: 'link_click', value: '99' }] },
    ]);
    db.accounts.mockResolvedValue([account]);
    db.insights.mockImplementation(async ({ where }: { where: { level: { in: string[] }; date: { gte: Date; lt: Date } } }) =>
      stored.filter(item => where.level.in.includes(item.level) && item.date >= where.date.gte && item.date < where.date.lt));
    for (const level of ['campaign', 'adset', 'ad']) {
      const result = await readAdsPerformance({ userId: 'u', workspaceId: 'w' }, { start: '2026-10-15', end: '2026-10-21', level });
      expect(result.resultCount).toBe(1);
      expect(result.performance[0]).toMatchObject({ level, currency: 'USD', spend: 31, impressions: 1000, clicks: 100, reach: 600,
        cpc: 0.31, cpm: 31, ctr: 10, frequency: 1.5, cpp: 20.75 / 600, reachDate: new Date('2026-10-16'),
        actions: [{ name: 'link_click', value: 100 }], dailyRowCount: 2 });
      expect(result.range).toEqual({ from: new Date('2026-10-15'), to: new Date('2026-10-22'), endExclusive: true });
    }
    const daily = await readAdsDailyRows({ userId: 'u', workspaceId: 'w' }, { start: '2026-10-15', end: '2026-10-21', level: 'account' });
    expect(spendByCurrency(daily.rows)).toMatchObject([{ currency: 'USD', total: 31, daily: [{ date: '2026-10-15', value: 10.25 }, { date: '2026-10-16', value: 20.75 }] }]);
    // A retained day is not evidence of zero spend on missing Oct 17–21 days.
    expect(daily.rows).toHaveLength(2);
    expect(daily.rows[0].fields).toMatchObject({ spend: '20.75' });
  });

  it('leaves denominator-zero ratios unknown and keeps different accounts/currencies apart', () => {
    const summaries = summarizeInsights([
      { ...row('usd', '2026-10-16', '10.00', 'campaign'), impressions: 0, clicks: 0, reach: 0 },
      row('eur', '2026-10-16', '7.70', 'campaign', 'eur', 'EUR'),
    ]);
    expect(summaries).toHaveLength(2);
    expect(summaries.find(summary => summary.currency === 'USD')).toMatchObject({ spend: 10, cpc: null, cpm: null, ctr: null });
    expect(summaries.find(summary => summary.currency === 'EUR')).toMatchObject({ spend: 7.7, cpc: 3.85, cpm: 77, ctr: 2 });
  });
});
