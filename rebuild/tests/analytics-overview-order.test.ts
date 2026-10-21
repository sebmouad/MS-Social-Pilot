import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/data', () => ({ prisma: {} }));
vi.mock('@/modules/analytics/server/error-copy', () => ({ analyticsLanguage: async () => 'en' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => ({}), runtimeConfigBatch: async () => ({}) }));

import { normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';
import { buildAnalytics, orderOverviewMetrics } from '../src/modules/analytics/server/aggregate';
import { overviewOrderDefaults, overviewOrderSchema } from '../src/modules/analytics/overview-order';
import { ANALYTICS_MODULE_CONFIG } from '../src/modules/analytics/config';

const targets = Array.from({ length: 10 }, (_, index) => ({ id: `page-${index}`, name: `Page ${index}`, type: 'page', providerId: 'facebook', socialAccountId: 's' })) as Array<{ id: string; name: string }>;
const account = { id: 'ad-1', name: 'Ad account', currency: 'USD' };
const posts = targets.flatMap(target => [10, 11].map(day => ({
  createdTime: new Date(`2026-10-${day}T10:00:00Z`), insightsSyncedAt: new Date('2026-10-12T00:00:00Z'), target: { id: target.id, name: target.name },
  insights: { post_media_view: 20, post_total_media_view_unique: 12, reactions: 3, comments: 1 },
})));
const adRow = { date: new Date('2026-10-10'), spend: 0, impressions: 0, clicks: 0, reach: 0, cpc: 0, cpm: 0, cpp: 0, ctr: 0, frequency: 0, actions: [], fields: {}, fetchedAt: new Date('2026-10-12'), adAccount: account };

function overview(order = overviewOrderDefaults) {
  const input = normalizeFacebookAnalytics({ locale: 'en', pageRows: [], audienceRows: [], adRows: [adRow] as never, postRows: posts as never, selectedTargets: targets as never, selectedAdAccounts: [account] });
  return orderOverviewMetrics(buildAnalytics(input.metrics, [], 10).metrics, order);
}

describe('overview metric order', () => {
  it('returns Page series built from post insights for ten Pages next to an ad account', () => {
    const views = overview().find(metric => metric.key === 'post:post_media_view')!;
    expect(views.coverage).toBe(10);
    expect(views.total).toBe(400);
  });
  it('leads with Page media views, then reach, then engagement, with channel metrics before ads', () => {
    const items = overview();
    expect(items[0]!.key).toBe('post:post_media_view');
    const keys = items.map(metric => metric.key);
    expect(keys.indexOf('post:post_total_media_view_unique')).toBeLessThan(keys.indexOf('post:reactions'));
    const firstAd = items.findIndex(metric => metric.resourceKind === 'ad-account');
    expect(firstAd).toBeGreaterThan(0);
    expect(items.slice(0, firstAd).every(metric => metric.resourceKind === 'channel')).toBe(true);
  });
  it('never leads with an empty cost or ratio metric', () => {
    const items = overview({ ...overviewOrderDefaults, resourceOrder: ['ad-account', 'channel'] });
    const cost = items.find(metric => /per person reached/i.test(metric.label));
    expect(cost).toBeDefined();
    expect(items[0]).not.toBe(cost);
  });
  it('lets Root change the order', () => {
    const items = overview({ ...overviewOrderDefaults, headlinePriority: ['reactions'] });
    expect(items[0]!.key).toBe('post:reactions');
  });
  it('declares an active, valid Root setting', () => {
    const entry = ANALYTICS_MODULE_CONFIG.find(item => item.key === 'analytics.overviewOrder')!;
    expect(entry.consumption).toBe('active');
    expect(overviewOrderSchema.safeParse(entry.defaultValue).success).toBe(true);
  });
});
