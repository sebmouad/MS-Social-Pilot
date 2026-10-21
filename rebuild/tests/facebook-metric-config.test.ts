import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { appSetting: db } }));
import { FACEBOOK_CONFIG } from '../src/platforms/facebook/module';
import { FACEBOOK_HISTORY_CONFIG, FACEBOOK_METRIC_LABEL_DEFAULTS, facebookMetricLabelsSchema } from '../src/platforms/facebook/config';
import { readConfig, runtimeConfig, runtimeConfigBatch } from '../src/server/config/store';

beforeEach(() => vi.clearAllMocks());

describe('Facebook metric configuration', () => {
  it('declares Page collection defaults with bilingual labels', () => {
    const setting = FACEBOOK_CONFIG.find(item => item.key === 'meta.pageInsightMetrics')!;
    const metrics = setting.schema.parse(setting.defaultValue) as string[];
    expect(metrics).toEqual(expect.arrayContaining(['page_daily_follows', 'page_daily_follows_unique', 'page_daily_unfollows_unique', 'page_total_media_view_unique', 'page_video_views']));
    for (const metric of metrics) expect(FACEBOOK_METRIC_LABEL_DEFAULTS).toHaveProperty(metric, { en: expect.any(String), fr: expect.any(String) });
    expect(setting.owner).toEqual({ kind: 'platform', id: 'facebook' });
  });

  it('adds clicks and eligible video metrics while retaining explicit Root collection choices', () => {
    const setting = FACEBOOK_HISTORY_CONFIG[0];
    expect(setting.defaultValue.metrics).toEqual(expect.arrayContaining(['post_clicks', 'post_video_views', 'post_video_view_time']));
    const aliases: Record<string, string> = { post_clicks: 'clicks', post_video_views: 'video_views', post_video_view_time: 'video_watch_time' };
    for (const metric of setting.defaultValue.metrics) expect(FACEBOOK_METRIC_LABEL_DEFAULTS).toHaveProperty(aliases[metric] ?? metric);
    expect(setting.schema.parse({ ...setting.defaultValue, metrics: [] }).metrics).toEqual([]);
    expect(setting.schema.parse({ ...setting.defaultValue, metrics: ['custom_metric'] }).metrics).toEqual(['custom_metric']);
  });

  it('inherits new labels through single, batch and Root reads of an older saved catalog', async () => {
    const overrides = { engagement: { en: 'Custom engagement', fr: 'Interactions personnalisées' }, custom_metric: { en: 'Custom', fr: 'Personnalisé' } };
    const row = { key: 'meta.metricLabels', encrypted: false, value: overrides };
    db.findUnique.mockResolvedValue(row);
    db.findMany.mockResolvedValue([row]);
    const expected = { ...FACEBOOK_METRIC_LABEL_DEFAULTS, ...overrides };
    expect(await runtimeConfig('meta.metricLabels')).toEqual(expected);
    expect((await runtimeConfigBatch(['meta.metricLabels']))['meta.metricLabels']).toEqual(expected);
    expect((await readConfig()).find(item => item.key === row.key)).toMatchObject({ value: expected, source: 'database', isSet: true });
    expect(row.value).toEqual(overrides);
    expect(facebookMetricLabelsSchema.parse(expected)).toEqual(expected);
  });

  it.each([{ clicks: { en: '', fr: 'Clics' } }, { clicks: { en: 'Clicks' } }, []])('rejects invalid label overrides instead of hiding them: %j', overrides => {
    expect(facebookMetricLabelsSchema.safeParse(overrides).success).toBe(false);
  });
});
