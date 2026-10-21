import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), pageInsight: { findMany: vi.fn() } }));
const config = vi.hoisted(() => ({ max: 3 }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => { if (key !== 'meta.postCohortMaxPosts') throw new Error(key); return config.max; } }));

import { facebookGoalMeasuresWithBasis, facebookPostCohortMeasures, readFacebookGoalMeasures } from '../src/platforms/facebook/goals';
import { facebookDestinationMeasures, readFacebookDestinationMeasures, readFacebookPostCohort } from '../src/platforms/facebook/destination-measures';
import { FACEBOOK_DATA_DETAIL_CONFIG } from '../src/platforms/facebook/config';

const window = { workspaceId: 'w1', targetId: 't1', from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
const cohort = (insights: unknown[], truncated = false) => ({ insights, posts: insights.length, truncated });
const pageNone = { audienceGained: null, views: null, engagements: null };

beforeEach(() => { db.$queryRaw.mockReset(); db.pageInsight.findMany.mockReset(); config.max = 3; });

describe('post cohort measures', () => {
  it('sums views and engagements across posts and keeps unknown as null', () => {
    expect(facebookPostCohortMeasures(cohort([{ post_media_view: 100, reactions: 5, comments: 1 }, { impressions: 50, shares: 2 }, {}]))).toEqual({ views: 150, engagements: 8 });
    expect(facebookPostCohortMeasures(cohort([{}, null, 'x']))).toEqual({ views: null, engagements: null });
    expect(facebookPostCohortMeasures(cohort([{ reactions: 0, post_media_view: 0 }]))).toEqual({ views: 0, engagements: 0 });
  });

  it('labels the post cohort when Page insights are absent and never mixes it with Page flows', async () => {
    const result = await facebookGoalMeasuresWithBasis(pageNone, async () => cohort([{ post_media_view: 10, reactions: 2 }], true));
    expect(result).toMatchObject({ audienceGained: null, views: 10, engagements: 2, basis: { views: 'post-cohort', engagements: 'post-cohort' }, cohort: { posts: 1, truncated: true } });
  });

  it('keeps a Page flow for the measure that has one and takes only the missing measure from posts', async () => {
    const result = await facebookGoalMeasuresWithBasis({ audienceGained: 4, views: 900, engagements: null }, async () => cohort([{ post_media_view: 10, reactions: 2 }]));
    expect(result).toMatchObject({ audienceGained: 4, views: 900, engagements: 2, basis: { views: 'page-daily', engagements: 'post-cohort' } });
  });

  it('does not read posts when Page insights cover both measures', async () => {
    const read = vi.fn();
    const result = await facebookGoalMeasuresWithBasis({ audienceGained: 1, views: 5, engagements: 6 }, read);
    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({ audienceGained: 1, views: 5, engagements: 6, basis: { views: 'page-daily', engagements: 'page-daily' } });
  });

  it('stays unknown without basis or cohort when neither source has a value', async () => {
    const result = await facebookGoalMeasuresWithBasis(pageNone, async () => cohort([]));
    expect(result).toEqual({ ...pageNone, basis: { views: null, engagements: null } });
  });

  it('reads Page insights first, then the scoped post cohort', async () => {
    db.pageInsight.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([{ insights: { post_media_view: 7, reactions: 1 } }]);
    const result = await readFacebookGoalMeasures(window);
    expect(db.pageInsight.findMany.mock.calls[0][0].where).toMatchObject({ targetId: 't1', target: { workspaceId: 'w1' } });
    expect(result).toMatchObject({ views: 7, engagements: 1, basis: { views: 'post-cohort', engagements: 'post-cohort' } });
  });
});

describe('destination cohort projection', () => {
  it('queries app posts and external snapshots once per remote post inside the workspace', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await readFacebookPostCohort(window);
    const query = db.$queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(query.sql).toContain('DISTINCT ON (COALESCE(pt."remotePostId", pt.id))');
    expect(query.sql).toContain('LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"');
    expect(query.sql).toContain('FROM external_posts ep');
    expect(query.sql).toContain('NOT EXISTS');
    expect(query.sql.match(/"workspaceId"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(query.values).toEqual(expect.arrayContaining(['t1', 'w1', config.max + 1]));
  });

  it('flags truncation at the configured bound and drops the probe row', async () => {
    db.$queryRaw.mockResolvedValue([{ insights: { reach: 1 } }, { insights: { reach: 2 } }, { insights: { reach: 3 } }, { insights: { reach: 4 } }]);
    const result = await readFacebookDestinationMeasures(window);
    expect(result.coverage).toEqual({ posts: 3, truncated: true });
    expect(result.measures.find(m => m.key === 'reach')).toMatchObject({ value: 6, measuredPosts: 3 });
  });

  it('reports full coverage and unknown measures without inventing zero', () => {
    const result = facebookDestinationMeasures([{ reach: 5 }, {}], { posts: 2, truncated: false });
    expect(result.coverage).toEqual({ posts: 2, truncated: false });
    expect(result.measures.find(m => m.key === 'reach')).toMatchObject({ value: 5, measuredPosts: 1 });
    expect(result.measures.find(m => m.key === 'shares')).toMatchObject({ value: null, measuredPosts: 0 });
    expect(facebookDestinationMeasures([{ reach: 1 }])).not.toHaveProperty('coverage');
  });

  it('registers the cohort bound as an active Root setting', () => {
    const item = FACEBOOK_DATA_DETAIL_CONFIG.find(entry => entry.key === 'meta.postCohortMaxPosts');
    expect(item?.defaultValue).toBe(20000);
    expect(item?.schema.safeParse(0).success).toBe(false);
  });
});
