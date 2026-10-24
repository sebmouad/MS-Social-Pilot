import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
import { normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';
import { FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS } from '../src/platforms/facebook/config';

const target = { id: 'page', name: 'Example Page', type: 'page', socialAccountId: 'connection' };
const date = new Date('2026-10-01T00:00:00Z');
const row = (metric: string, value: unknown, numeric: number | null) => ({ metric, period: 'day', value, numeric, endTime: date, fetchedAt: date, target });

describe('Facebook Page analytics labels', () => {
  it.each(['en', 'fr'] as const)('uses configured %s metric, audience, category and provenance labels', locale => {
    const copy = FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS[locale];
    const result = normalizeFacebookAnalytics({ locale,
      metricLabels: { page_follows: { en: 'Custom followers', fr: 'Abonnés personnalisés' } },
      pageRows: [row('page_follows', 7, 7), row('page_total_media_view_unique', 3, 3), row('page_daily_follows', 2, 2), row('page_clicks_by_type', { link: 4 }, null)],
      audienceRows: [row('page_follows', 7, 7)], selectedTargets: [target], adRows: [], selectedAdAccounts: [],
    });
    const followers = locale === 'en' ? 'Custom followers' : 'Abonnés personnalisés';
    expect(result.metrics.find(metric => metric.key === 'page_follows::day')).toMatchObject({ label: `${followers} · ${copy.latest}`, sourceLabel: copy.source });
    expect(result.audienceEntries[0]).toMatchObject({ metricLabel: followers, sourceLabel: copy.source });
    expect(result.metrics.find(metric => metric.key === 'page_total_media_view_unique::day')).toMatchObject({ label: `${locale === 'en' ? 'People who viewed media' : 'Personnes ayant vu les médias'} · ${copy.latest}`, aggregationNote: copy.overlap });
    expect(result.metrics.find(metric => metric.key === 'page_daily_follows::day')?.label).toBe(locale === 'en' ? 'Daily follows' : 'Abonnements quotidiens');
    expect(result.metrics.find(metric => metric.kind === 'breakdown')?.label).toContain(copy.categories);
  });

  it('keeps legacy audience labels and custom Page copy while retaining unknown metrics', () => {
    const result = normalizeFacebookAnalytics({ locale: 'fr', pageCopy: { ...FACEBOOK_PAGE_ANALYTICS_COPY_DEFAULTS, fr: { source: 'Source choisie', latest: 'Valeur récente', categories: 'Groupes', overlap: 'Personnes en commun' } },
      pageRows: [row('unknown_metric', 4, 4)], audienceRows: [row('page_fans', 5, 5)], selectedTargets: [target], adRows: [], selectedAdAccounts: [],
    });
    expect(result.audienceEntries[0]?.metricLabel).toBe('Mentions J’aime de la Page');
    expect(result.metrics[0]).toMatchObject({ label: 'Unknown Metric · Valeur récente', sourceLabel: 'Source choisie' });
  });
});
