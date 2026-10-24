// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
import { facebookAudienceGrowthIdentity } from '../src/platforms/facebook/audience-growth';
import { normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';
import { buildAnalytics } from '../src/modules/analytics/server/aggregate';
import { compareAnalytics } from '../src/modules/analytics/server/comparison';
import { overviewCopyCatalogDefaults, overviewCopySchema, overviewCopyDefaults } from '../src/modules/analytics/overview-copy';
import AnalyticsMetric from '../src/modules/analytics/ui/AnalyticsMetric';
import type { AnalyticsMetricInput } from '../src/modules/analytics/server/catalog';
const at = new Date('2026-10-01T00:00:00Z');
const target = { id: 'channel', name: 'Example channel', type: 'page', socialAccountId: 'connection' };
const row = (metric: string, numeric: number) => ({ metric, numeric, value: numeric, period: 'day', endTime: at, fetchedAt: at, target });

describe('audience growth identity', () => {
  it.each([
    ['page_fan_adds', 'likes', 'gained'], ['page_fan_adds_unique', 'likes', 'gained'],
    ['page_fan_removes', 'likes', 'lost'], ['page_fan_removes_unique', 'likes', 'lost'],
    ['page_daily_follows', 'followers', 'gained'], ['page_daily_follows_unique', 'followers', 'gained'],
    ['page_daily_unfollows_unique', 'followers', 'lost'],
  ])('maps %s inside its provider', (metric, kind, direction) => {
    expect(facebookAudienceGrowthIdentity(metric!)).toEqual({ kind, direction });
  });
  it('never guesses that an unknown metric, total or breakdown is follower growth', () => {
    for (const name of ['page_fan_unknown', 'page_unknown_growth', 'page_fans', 'page_follows', 'page_fan_adds_by_paid_non_paid_unique']) expect(facebookAudienceGrowthIdentity(name)).toBeUndefined();
  });
  it.each(['en', 'fr'] as const)('preserves historic likes, follows and directions independently in %s', locale => {
    const result = normalizeFacebookAnalytics({ locale, pageRows: [row('page_fan_adds', 90), row('page_fan_removes', 10), row('page_daily_follows_unique', 7), row('page_daily_unfollows_unique', 2)], audienceRows: [], selectedTargets: [target], adRows: [], selectedAdAccounts: [] });
    const view = buildAnalytics(result.metrics, [], 1);
    expect(view.metrics).toHaveLength(4);
    const likes = view.metrics.find(metric => metric.key === 'page_fan_adds::day')!;
    const follows = view.metrics.find(metric => metric.key === 'page_daily_follows_unique::day')!;
    expect(likes).toMatchObject({ audienceGrowth: { kind: 'likes', direction: 'gained' }, total: 90 });
    expect(follows).toMatchObject({ audienceGrowth: { kind: 'followers', direction: 'gained' }, total: 7 });
    expect(likes.label).toContain(locale === 'en' ? 'New Page likes' : 'Nouvelles mentions J’aime');
    expect(follows.label).toContain(locale === 'en' ? 'New followers' : 'Nouveaux abonnés');
    const html = renderToStaticMarkup(createElement(AnalyticsMetric, { metric: likes, chartPoints: 2, locale }));
    expect(html).toContain(overviewCopyDefaults[locale]['Likes and followers are different measures. Growth is shown separately for each.']);
    expect(html).not.toContain('page_fan_adds');
  });
  it('passes normalized identity through the shared aggregator without provider knowledge', () => {
    const input: AnalyticsMetricInput = { key: 'vendor-neutral-series', label: 'New subscribers', sourceLabel: 'Community', audienceGrowth: { kind: 'followers', direction: 'gained' }, kind: 'flow', unit: 'count', available: 1, observations: [{ date: at, channelId: target.id, channelLabel: target.name, value: 4 }] };
    const view = buildAnalytics([input], [], 1).metrics[0]!;
    expect(view.audienceGrowth).toEqual(input.audienceGrowth);
    expect(view.total).toBe(4);
    expect(view.audienceGrowth).not.toBe(input.audienceGrowth);
    expect(compareAnalytics([view], [{ ...view, audienceGrowth: { kind: 'likes', direction: 'gained' } }]).values().next().value).toMatchObject({ status: 'not_comparable', delta: null });
    expect(compareAnalytics([view], [{ ...view, audienceGrowth: { kind: 'followers', direction: 'lost' } }]).values().next().value).toMatchObject({ status: 'not_comparable', delta: null });
  });
  it('extends existing Root copy without discarding older saved wording', () => {
    const saved = { ...overviewCopyCatalogDefaults, 'Search metrics': { en: 'Find measures', fr: 'Trouver des mesures' } };
    delete (saved as Partial<typeof saved>)['Likes and followers are different measures. Growth is shown separately for each.'];
    expect(overviewCopySchema.parse(saved)['Search metrics'].en).toBe('Find measures');
    expect(overviewCopySchema.parse(saved)['Likes and followers are different measures. Growth is shown separately for each.'].fr).toContain('abonnés');
  });
});
