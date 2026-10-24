import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../src/server/data', () => ({ prisma: {} }));
vi.mock('@/modules/analytics/server/error-copy', () => ({ analyticsLanguage: async () => 'en' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => ({}), runtimeConfigBatch: async () => ({}) }));

import { facebookAdLabel, normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';
import { FACEBOOK_METRIC_LABEL_DEFAULTS, facebookMetricLabelsSchema } from '../src/platforms/facebook/config';
import { PostsTable } from '../src/modules/analytics/ui/posts/PostsTable';

const account = { id: 'ad-a', name: 'Ad account A', currency: 'USD' };
const target = { id: 'page-a', name: 'Page A', type: 'page', providerId: 'facebook', socialAccountId: 's' } as never;
const adRow = (actions: unknown) => ({ date: new Date('2026-10-10'), spend: 5, impressions: 100, clicks: 4, reach: 80, cpc: 1.25, cpm: 50, cpp: 0.06, ctr: 4, frequency: 1.25, actions, fields: {}, fetchedAt: new Date('2026-10-11'), adAccount: account });

describe('ads action metrics have readable names', () => {
  it('names the live defect in English and French', () => {
    expect(facebookAdLabel('actions:onsite_conversion.post_net_like')).toBe('Net post likes');
    expect(facebookAdLabel('actions:onsite_conversion.post_net_like', FACEBOOK_METRIC_LABEL_DEFAULTS, 'fr')).toBe('J’aime nets sur publications');
    expect(facebookAdLabel('cost_per_action_type:link_click')).toBe('Link clicks · Cost per action');
    expect(facebookAdLabel('video_p25_watched_actions:video_view')).toBe('Video views · Video watched to 25%');
  });
  it('falls back to a sentence for unknown action types, never the raw key', () => {
    const label = facebookAdLabel('actions:onsite_conversion.some_new_thing');
    expect(label).toBe('Some new thing');
    expect(label).not.toMatch(/Actions|\.|_/);
  });
  it('lets a saved Root label win and keeps shipped labels for older saved catalogs', () => {
    const saved = facebookMetricLabelsSchema.parse({ 'action:link_click': { en: 'Clicks on links', fr: 'Clics' } });
    expect(facebookAdLabel('actions:link_click', saved)).toBe('Clicks on links');
    expect(facebookAdLabel('actions:comment', saved)).toBe('Comments');
  });
  it('labels normalized ad metrics in the viewer language', () => {
    const rows = [adRow([{ action_type: 'onsite_conversion.post_net_like', value: '3' }])];
    for (const [locale, expected] of [['en', 'Net post likes'], ['fr', 'J’aime nets sur publications']] as const) {
      const { metrics } = normalizeFacebookAnalytics({ locale, pageRows: [], audienceRows: [], selectedTargets: [], selectedAdAccounts: [account], adRows: rows as never });
      const action = metrics.find(metric => metric.key.startsWith('actions:onsite_conversion.post_net_like'));
      expect(action?.label, locale).toContain(expected);
      expect(metrics.some(metric => /Actions Onsite/i.test(metric.label))).toBe(false);
    }
  });
});

describe('Page-level series from synced post insights', () => {
  const post = (day: string, insights: unknown, name = 'Page A', id = 'page-a') => ({ createdTime: new Date(`${day}T15:30:00Z`), insights, insightsSyncedAt: new Date('2026-10-12T00:00:00Z'), target: { id, name } });
  const build = (postRows: ReturnType<typeof post>[], locale: 'en' | 'fr' = 'en') => normalizeFacebookAnalytics({ locale, pageRows: [], audienceRows: [], adRows: [], postRows, selectedTargets: [target], selectedAdAccounts: [] });

  it('adds a flow series per publish date with honest wording and no Page rows required', () => {
    const { metrics } = build([post('2026-10-10', { post_media_view: 10, reactions: 2 }), post('2026-10-10', { post_media_view: 5 }), post('2026-10-11', { post_media_view: 7, comments: 1 })]);
    const views = metrics.find(metric => metric.key === 'post:post_media_view')!;
    expect(views.label).toBe('Media views · Posts published');
    expect(views.kind).toBe('flow');
    expect(views.sourceLabel).toBe('Page performance');
    expect(views.observations.map(item => item.value)).toEqual([10, 5, 7]);
    expect(views.aggregationNote).toMatch(/not views or reactions that happened on that date/);
    expect(views.coveredResourceIds).toEqual(['page-a']);
    expect(metrics.map(metric => metric.key)).toEqual(expect.arrayContaining(['post:reactions', 'post:comments']));
  });
  it('keeps unknown unknown: a post without a value adds no observation', () => {
    const { metrics } = build([post('2026-10-10', { reactions: 2 }), post('2026-10-11', { post_media_view: null, reactions: 3 })]);
    expect(metrics.find(metric => metric.key === 'post:post_media_view')).toBeUndefined();
    expect(metrics.find(metric => metric.key === 'post:reactions')!.observations).toHaveLength(2);
  });
  it('flags people-based measures as non-additive and localizes labels', () => {
    const { metrics } = build([post('2026-10-10', { post_total_media_view_unique: 4 })], 'fr');
    const unique = metrics.find(metric => metric.key === 'post:post_total_media_view_unique')!;
    expect(unique.label).toBe('Personnes ayant vu les médias · Publications du jour');
    expect(unique.aggregationNote).toMatch(/distinctes/);
  });
  it('ignores object breakdowns and negative or non-finite values', () => {
    const { metrics } = build([post('2026-10-10', { post_clicks_by_type: { link: 3 }, reactions: -1, comments: Number.NaN, shares: 4 })]);
    expect(metrics.filter(metric => metric.key.startsWith('post:')).map(metric => metric.key)).toEqual(['post:shares']);
  });
});

describe('post explorer Columns chooser', () => {
  const measures = [{ key: 'reach', label: 'People reached' }, { key: 'likes', label: 'Likes' }, { key: 'shares', label: 'Shares' }, { key: 'empty', label: 'Empty' }];
  const rows = [{ key: 'a:1', text: 'Launch', url: null, channelName: 'Page A', publishedAt: null, measuredAt: null, measures: { reach: 9, likes: 3, shares: 1, empty: null } }];
  const html = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'en' }));
  it('offers a checkbox per populated measure, defaulting to the first two, and omits empty ones', () => {
    expect(html).toContain('Columns');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(3);
    expect((html.match(/type="checkbox"[^>]*checked/g) ?? []).length).toBe(2);
    expect(html).not.toContain('>Empty<');
    expect(html).toContain('People reached</th>'); expect(html).not.toContain('Shares</th>');
  });
  it('renders French copy for the chooser', () => {
    const fr = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'fr' }));
    expect(fr).toContain('Colonnes');
  });
});
