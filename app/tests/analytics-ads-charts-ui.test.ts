// @vitest-environment jsdom
import { instantFormatter } from '@/server/instant-labels';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildPyramid, parseAgeGender } from '../src/modules/analytics/ui/demographics/pyramid';
import { previousSeries } from '../src/modules/analytics/ui/series';
import { metricDelta } from '../src/modules/analytics/ui/AnalyticsMetric';
import { postsTableMeasures, postsTableRows } from '../src/modules/analytics/ui/posts/rows';
import { PostsTable } from '../src/modules/analytics/ui/posts/PostsTable';
import { HierarchyTable, type HierarchyRow } from '../src/modules/ads/ui/campaigns/HierarchyTable';
import type { MetricView } from '../src/modules/analytics/server/aggregate';

describe('age and gender pyramid', () => {
  it('reads age ranges and genders from label shape only', () => {
    expect(parseAgeGender('F.25-34')).toMatchObject({ age: '25–34', side: 'left', from: 25 });
    expect(parseAgeGender('Men · 65+')).toMatchObject({ age: '65+', side: 'right', from: 65 });
    expect(parseAgeGender('femmes 18–24')).toMatchObject({ side: 'left' });
    expect(parseAgeGender('U.25-34')).toBeNull();
    expect(parseAgeGender('Morocco')).toBeNull();
  });

  it('orders age groups youngest first, sums duplicates and keeps unknown as null', () => {
    const model = buildPyramid([
      { label: 'M.35-44', value: 5 }, { label: 'F.18-24', value: 10 }, { label: 'M.18-24', value: null }, { label: 'F.35-44', value: 7 }, { label: 'F.35-44', value: 3 },
    ]);
    expect(model).toEqual({ groups: ['18–24', '35–44'], left: [10, 10], right: [null, 5] });
  });

  it('declines breakdowns that are not entirely age and gender', () => {
    expect(buildPyramid([{ label: 'F.18-24', value: 1 }, { label: 'Morocco', value: 2 }])).toBeNull();
    expect(buildPyramid([{ label: 'F.18-24', value: 1 }])).toBeNull();
  });
});

describe('previous period series', () => {
  const current = [{ date: '2026-10-02', value: 2 }, { date: '2026-10-03', value: 3 }];
  it('aligns from the end and scales percent units', () => {
    const previous = [{ date: '2026-09-01', value: 10 }, { date: '2026-09-02', value: 20 }, { date: '2026-09-03', value: 30 }];
    expect(previousSeries(current, previous, 'count')).toEqual([{ t: '2026-09-02', v: 20 }, { t: '2026-09-03', v: 30 }]);
    expect(previousSeries(current, previous, 'percent')?.[1]?.v).toBeCloseTo(0.3);
  });
  it('draws nothing without data on either side', () => {
    expect(previousSeries(current, undefined, 'count')).toBeUndefined();
    expect(previousSeries([], [{ date: '2026-09-01', value: 1 }], 'count')).toBeUndefined();
  });
});

describe('KPI delta', () => {
  const metric = { kind: 'flow', unit: 'count' } as MetricView;
  it('shows a signed percent and direction only for comparable metrics', () => {
    expect(metricDelta(metric, { previous: 100, delta: 12, percent: 12, status: 'comparable' }, 'en')).toMatchObject({ label: '+12%', direction: 'up', comparedTo: 'vs previous period' });
    expect(metricDelta(metric, { previous: 100, delta: -5, percent: -5, status: 'comparable' }, 'fr')).toMatchObject({ direction: 'down', comparedTo: 'vs période précédente' });
    expect(metricDelta(metric, { previous: null, delta: null, percent: null, status: 'missing' }, 'en')).toBeUndefined();
    expect(metricDelta(metric, { previous: 1, delta: 1, percent: 1, status: 'coverage_changed' }, 'en')).toBeUndefined();
  });
  it('states ratio changes in points', () => {
    const ratio = { kind: 'ratio', unit: 'percent' } as MetricView;
    expect(metricDelta(ratio, { previous: 2, delta: 0.5, percent: 25, status: 'comparable' }, 'en')?.label).toBe('+0.5 pts');
  });
});

describe('post explorer table', () => {
  const rows = postsTableRows([{ channelId: 'c1', channelName: 'Studio', postId: 'p1', text: 'Launch day', url: 'https://example.com/p1',
    publishedAt: new Date('2026-10-01T09:00:00Z'), measuredAt: null, measures: [{ key: 'reach', value: 120 }, { key: 'likes', value: null }] }], instantFormatter('UTC', 'en'));
  const measures = postsTableMeasures([{ key: 'reach', label: 'Reach', labelFr: 'Portée' }, { key: 'likes', label: 'Likes' }], 'fr');

  it('serializes dates and keeps unknown measures null', () => {
    expect(rows[0]).toMatchObject({ key: 'c1:p1', publishedAt: '2026-10-01T09:00:00.000Z', measuredAt: null, measures: { reach: 120, likes: null } });
    expect(measures).toEqual([{ key: 'reach', label: 'Portée' }, { key: 'likes', label: 'Likes' }]);
  });

  it('renders chosen metric columns with a dash for unknown values', () => {
    const html = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'fr' }));
    expect(html).toContain('Launch day');
    expect(html).toContain('Portée');
    expect(html).toContain('120');
    expect(html).toContain('Non disponible');
  });
});

describe('ads hierarchy table', () => {
  const row = (patch: Partial<HierarchyRow>): HierarchyRow => ({ key: 'k', id: '123', name: 'Spring sale', level: 'campaign', currency: 'EUR', spend: 50, impressions: 1000, clicks: 20, ctr: 2, cpc: 2.5, days: 3, spendSeries: [10, 20, 20], ...patch });

  it('shows stored delivery badges, metrics and a row menu', () => {
    const html = renderToStaticMarkup(createElement(HierarchyTable, { caption: 'Campaigns', locale: 'en', rows: [row({}), row({ key: 'q', id: '9', name: 'Idle', spend: 0, impressions: 0, clicks: 0, ctr: null, cpc: null, days: 0, spendSeries: [] })] }));
    expect(html).toContain('Spring sale');
    expect(html).toContain('Delivered');
    expect(html).toContain('No delivery');
    expect(html).toContain('Actions for Spring sale');
  });

  it('renders French copy and server slots', () => {
    const html = renderToStaticMarkup(createElement(HierarchyTable, { caption: 'Campagnes', locale: 'fr', rows: [row({})], actions: { k: createElement('b', null, 'MANAGE-SLOT') } }));
    expect(html).toContain('Diffusé');
    expect(html).toContain('MANAGE-SLOT');
    expect(html).toContain('Gérer');
  });
});
