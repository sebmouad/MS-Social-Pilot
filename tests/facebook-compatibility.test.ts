import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * What this app asks Facebook for, checked against what Facebook still serves.
 *
 * Meta retires metrics, edges and permissions on its own schedule, often on
 * every API version at once. Each was a silent failure here: a retired metric
 * named in a batched request made Graph refuse the whole request, a retired
 * permission failed the whole login, a retired edge failed every sync. These
 * tests pin the dates from Meta's own changelogs, so the next change to this
 * code cannot quietly start asking for one again.
 */

let metrics: typeof import('../src/lib/facebook/metrics');
let graph: typeof import('../src/lib/facebook/graph');

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SESSION_SECRET ??= 'compatibility-test-secret-long-enough-for-checks';
  metrics = await import('../src/lib/facebook/metrics');
  graph = await import('../src/lib/facebook/graph');
});

const AFTER_ALL_REMOVALS = new Date('2026-09-28T00:00:00Z');

describe('the metric catalogue', () => {
  it('never asks for impressions or fans, retired on every version on 15 November 2025', () => {
    const served = [...metrics.metricsFor('page'), ...metrics.metricsFor('post')].map((metric) => metric.name);
    for (const name of ['page_impressions', 'page_fans', 'page_fan_adds', 'page_fans_country', 'post_impressions']) {
      expect(served, name).not.toContain(name);
    }
  });

  it('never asks for reach, retired on every version when v26.0 shipped on 29 July 2026', () => {
    const served = [
      ...metrics.metricsFor('page', { now: AFTER_ALL_REMOVALS }),
      ...metrics.metricsFor('post', { now: AFTER_ALL_REMOVALS }),
    ].map((metric) => metric.name);
    for (const name of ['page_impressions_unique', 'page_posts_impressions_unique', 'post_impressions_unique']) {
      expect(served, name).not.toContain(name);
    }
  });

  it('asks for the replacements Meta names instead', () => {
    const served = [...metrics.metricsFor('page'), ...metrics.metricsFor('post')].map((metric) => metric.name);
    for (const name of [
      'page_media_view',
      'page_total_media_view_unique',
      'page_follows',
      'page_daily_follows_unique',
      'post_media_view',
      'post_total_media_view_unique',
    ]) {
      expect(served, name).toContain(name);
    }
  });

  it('still served reach before it was retired, so stored history keeps its meaning', () => {
    const before = metrics.metricsFor('post', { now: new Date('2026-07-01T00:00:00Z') }).map((metric) => metric.name);
    expect(before).toContain('post_impressions_unique');
  });

  it('keeps retired names in the catalogue, labelled, for the coverage screen', () => {
    const reach = metrics.findMetric('page_impressions_unique');
    expect(reach).toMatchObject({ removedOn: '2026-07-29', replacedBy: 'page_total_media_view_unique' });
    expect(metrics.metricsFor('page', { includeRemoved: true }).map((metric) => metric.name)).toContain('page_impressions_unique');
  });

  it('retires Instagram impressions and plays at both levels, but not Facebook ads impressions', () => {
    const media = metrics.metricsFor('ig_media').map((metric) => metric.name);
    const account = metrics.metricsFor('ig_account').map((metric) => metric.name);
    expect(media).not.toContain('impressions');
    expect(media).not.toContain('plays');
    expect(media).toContain('views');
    expect(account).not.toContain('impressions');
    expect(account).toContain('views');
    expect(metrics.findAdField('impressions')).toBeDefined();
  });

  it('counts coverage against what is still served', () => {
    expect(metrics.catalogueSize().post).toBe(metrics.metricsFor('post').length);
    expect(metrics.catalogueSize().post).toBeLessThan(metrics.metricsFor('post', { includeRemoved: true }).length);
  });
});

describe('the permissions asked for at login', () => {
  it('never include the Groups scopes Meta removed on 22 April 2024, whatever the configuration says', async () => {
    // A scope that no longer exists fails the whole consent dialog, so turning
    // the Groups switch on used to stop anybody connecting at all.
    process.env.FACEBOOK_ENABLE_GROUPS = 'true';
    process.env.FACEBOOK_SCOPES = 'pages_show_list,publish_to_groups,pages_manage_posts';
    try {
      const { env } = await import('../src/lib/env');
      expect(env.facebookScopes).toEqual(['pages_show_list', 'pages_manage_posts']);
    } finally {
      delete process.env.FACEBOOK_ENABLE_GROUPS;
      delete process.env.FACEBOOK_SCOPES;
    }
  });
});

describe('Page ratings', () => {
  const beforeRetirement = new Date('2026-10-09T12:00:00Z');
  const afterRetirement = new Date('2027-01-22T00:00:00Z');

  it('are read on any pinned version while v21.0, which still serves them, lives', () => {
    // From v22.0 the edge is asked on v21.0 explicitly, so a newer pin does
    // not cost the reviews until Meta retires v21.0 itself.
    expect(graph.pageRatingsAvailable('v21.0', beforeRetirement)).toBe(true);
    expect(graph.pageRatingsAvailable('v22.0', beforeRetirement)).toBe(true);
    expect(graph.pageRatingsAvailable('v26.0', beforeRetirement)).toBe(true);
  });

  it('stop on newer versions once v21.0 is retired', () => {
    expect(graph.pageRatingsAvailable('v22.0', afterRetirement)).toBe(false);
    expect(graph.pageRatingsAvailable('v26.0', afterRetirement)).toBe(false);
  });

  it('reads a version string the way people write it', () => {
    expect(graph.graphMajor('v25.0')).toBe(25);
    expect(graph.graphMajor('25.0')).toBe(25);
    expect(Number.isNaN(graph.graphMajor('latest'))).toBe(true);
    // An unreadable version is not assumed to be an old one.
    expect(graph.pageRatingsAvailable('latest', afterRetirement)).toBe(false);
  });
});
