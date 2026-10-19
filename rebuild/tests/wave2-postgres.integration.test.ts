import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/**
 * Wave 2 SQL (goals, report destinations/goals sections, feed polling, webhook delivery) against the guarded loopback
 * `_preview` database. Only authority ports, network and the AI provider are stubbed; every row created is removed.
 */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, overrides: {} as Record<string, unknown>, channelId: '' }));
const proxy = vi.hoisted(() => () => ({ prisma: new Proxy({}, { get: (_t, key) => { const value = shared.client?.[key as string]; return typeof value === 'function' ? value.bind(shared.client) : value; } }) }));
vi.mock('../src/server/data', proxy);
vi.mock('@/server/data', proxy);
vi.mock('@/server/config/store', () => {
  let defaults: Record<string, unknown> | undefined;
  return { runtimeConfig: async (key: string) => {
    if (key in shared.overrides) return shared.overrides[key];
    defaults ??= Object.fromEntries((await import('../src/lib/config/registry')).CONFIG_REGISTRY.map((e: { key: string; defaultValue: unknown }) => [e.key, e.defaultValue]));
    return defaults[key];
  } };
});
vi.mock('@/server/entitlements', async () => ({ ...(await vi.importActual<object>('@/server/entitlements')), loadEntitlements: async (_u: string, w: string) => ({ workspaceId: w }), entitledPlatformIds: () => ['facebook'] }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({ provider: { in: ['facebook'] } }) }));
vi.mock('@/server/platforms/registry', async () => {
  const { facebookAnalyticsHost } = await vi.importActual<{ facebookAnalyticsHost: unknown }>('../src/platforms/facebook/analytics');
  return { platformAnalytics: async (provider: string) => (provider === 'facebook' ? facebookAnalyticsHost : null) };
});
vi.mock('@/modules/analytics/server/access', async () => ({ ...(await vi.importActual<object>('../src/modules/analytics/server/access')), authorize: async () => ({ role: 'owner', scope: null }) }));
vi.mock('@/modules/analytics/reports/server/access', async () => ({ ...(await vi.importActual<object>('../src/modules/analytics/reports/server/access')), authorizeReport: async () => ({ role: 'owner', scope: null, providers: ['facebook'] }) }));
vi.mock('../src/modules/analytics/reports/server/access', async () => ({ ...(await vi.importActual<object>('../src/modules/analytics/reports/server/access')), authorizeReport: async () => ({ role: 'owner', scope: null, providers: ['facebook'] }) }));
vi.mock('../src/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: async () => ({
  period: { start: '2026-08-01', end: '2026-08-31' }, options: { channels: [{ id: shared.channelId, name: 'Synthetic channel' }], adAccounts: [], metrics: [] },
  selected: { channelIds: [shared.channelId], adAccountIds: [] }, publishing: { published: 1, scheduled: 0, failed: 0 },
  audience: { entries: [], total: 0, covered: 0, selected: 1 }, comparisons: {}, allMetrics: [],
}) }));
const feedAuth = vi.hoisted(() => async (actor: unknown) => ({ actor, role: 'owner', permissions: { pageScope: { all: true, ids: [] } }, entitlements: {}, workspaceWide: true }));
vi.mock('@/modules/feeds/server/access', async () => ({ ...(await vi.importActual<object>('../src/modules/feeds/server/access')), authorizeFeeds: feedAuth, authorizeFeedWrite: feedAuth }));
vi.mock('../src/modules/feeds/server/access', async () => ({ ...(await vi.importActual<object>('../src/modules/feeds/server/access')), authorizeFeeds: feedAuth, authorizeFeedWrite: feedAuth }));
vi.mock('@/modules/integrations/server/core', async () => ({ ...(await vi.importActual<object>('../src/modules/integrations/server/core')), authorize: async (actor: unknown) => ({ role: 'owner', actor }) }));
vi.mock('../src/modules/integrations/server/core', async () => ({ ...(await vi.importActual<object>('../src/modules/integrations/server/core')), authorize: async (actor: unknown) => ({ role: 'owner', actor }) }));

import { channelGoalProgress, setGoals } from '../src/modules/analytics/goals/server/goals';
import { goalsConfirmation } from '../src/modules/analytics/goals/contracts';
import { createReportGenerator } from '../src/modules/analytics/reports/generation/document';
import { runFeedPolling } from '../src/modules/feeds/server/polling';
import { createWebhook, deliverDueWebhooks, emitWebhook } from '../src/modules/integrations/server/webhooks';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

const tag = `wave2pg_${randomUUID().slice(0, 8)}`;
const at = (iso: string) => new Date(iso);

describe.skipIf(!url)('wave 2 SQL on real PostgreSQL', () => {
  let db: PrismaClient; let actor: { userId: string; workspaceId: string }; let channelId: string;
  let priorGoals: Array<{ metric: string; target: number }> = [];
  const made = { insights: [] as string[], posts: [] as string[], links: [] as string[], feeds: [] as string[], endpoints: [] as string[], since: new Date() };

  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    const rows = await db.$queryRaw<Array<{ userId: string; workspaceId: string; targetId: string }>>`
      SELECT m."userId", m."workspaceId", t.id AS "targetId" FROM memberships m
      JOIN targets t ON t."workspaceId" = m."workspaceId" JOIN social_accounts a ON a.id = t."socialAccountId" AND a.provider = 'facebook'
      WHERE m.role::text = 'owner' ORDER BY t.id LIMIT 1`;
    if (!rows[0]) throw new Error('The preview database needs a synthetic owner with a Facebook channel.');
    actor = { userId: rows[0].userId, workspaceId: rows[0].workspaceId }; channelId = rows[0].targetId; shared.channelId = channelId;
    priorGoals = await db.$queryRaw`SELECT metric, target FROM page_goals WHERE "targetId" = ${channelId}`;

    // August 2026: daily Page insights (newest metric name wins per day) and one published post with stored insights.
    const insight = async (metric: string, day: string, value: number) => {
      const id = `${tag}_${metric}_${day}`; made.insights.push(id);
      await db.$executeRaw`INSERT INTO page_insights (id, "targetId", metric, period, "endTime", value, numeric, "fetchedAt") VALUES (${id}, ${channelId}, ${metric}, 'day', ${at(`2026-08-${day}T07:00:00Z`)}, ${JSON.stringify(value)}::jsonb, ${value}, NOW())`;
    };
    await insight('page_daily_follows_unique', '05', 12); await insight('page_fan_adds', '05', 99);
    await insight('page_daily_unfollows_unique', '06', 2); await insight('page_media_view', '05', 400);
    await insight('page_post_engagements', '05', 30); await insight('page_post_engagements', '06', 5);
    const postId = `${tag}_post`; made.posts.push(postId);
    await db.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, "updatedAt") VALUES (${postId}, ${actor.workspaceId}, ${actor.userId}, 'Synthetic wave 2 post', NOW())`;
    await db.$executeRaw`INSERT INTO post_targets (id, "postId", "targetId", status, "publishedAt", insights, "updatedAt") VALUES (${`${tag}_pt`}, ${postId}, ${channelId}, 'published', ${at('2026-08-10T12:00:00Z')}, ${JSON.stringify({ impressions: 100, reach: 80, reactions: 7, comments: 2, shares: 1 })}::jsonb, NOW())`;
    const linkId = `${tag}_link`; made.links.push(linkId);
    await db.$executeRaw`INSERT INTO short_links (id, "workspaceId", slug, "targetUrl", "postId", "targetId", "clickCount") VALUES (${linkId}, ${actor.workspaceId}, ${tag}, 'https://example.com/a', ${postId}, ${channelId}, 9)`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM page_goals WHERE "targetId" = ${channelId}`;
    for (const g of priorGoals) await db.$executeRaw`INSERT INTO page_goals (id, "workspaceId", "targetId", metric, target, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${channelId}, ${g.metric}, ${g.target}, NOW(), NOW())`;
    const feedPosts = made.feeds.length ? (await db.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p JOIN feed_items i ON i.id = p."sourceFeedItemId" WHERE i."feedSourceId" = ANY(${made.feeds}::text[])`).map(r => r.id) : [];
    const posts = [...made.posts, ...feedPosts];
    await db.$executeRaw`DELETE FROM short_links WHERE id = ANY(${made.links}::text[])`;
    await db.$executeRaw`DELETE FROM post_targets WHERE "postId" = ANY(${posts}::text[])`;
    await db.$executeRaw`DELETE FROM posts WHERE id = ANY(${posts}::text[])`;
    await db.$executeRaw`DELETE FROM feed_items WHERE "feedSourceId" = ANY(${made.feeds}::text[])`;
    await db.$executeRaw`DELETE FROM feed_sources WHERE id = ANY(${made.feeds}::text[])`;
    await db.$executeRaw`DELETE FROM webhook_deliveries WHERE "endpointId" = ANY(${made.endpoints}::text[])`;
    await db.$executeRaw`DELETE FROM webhook_endpoints WHERE id = ANY(${made.endpoints}::text[])`;
    await db.$executeRaw`DELETE FROM page_insights WHERE id = ANY(${made.insights}::text[])`;
    await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND "createdAt" >= ${made.since} AND (action LIKE 'analytics.goals_%' OR action LIKE 'webhook.%' OR action LIKE 'feed%')`;
    await db.$disconnect();
  });

  it('stores goals and measures a past month with legacy meanings from real tables', async () => {
    await setGoals(actor, { channelId, goals: { followers: 20, views: 400, engagements: 100, posts: 2 }, confirmation: goalsConfirmation(channelId) });
    const stored = await db.$queryRaw<Array<{ metric: string; target: number }>>`SELECT metric, target FROM page_goals WHERE "targetId" = ${channelId} ORDER BY metric`;
    expect(stored).toEqual(expect.arrayContaining([{ metric: 'followers', target: 20 }, { metric: 'posts', target: 2 }]));
    await setGoals(actor, { channelId, goals: { followers: 25, posts: null }, confirmation: goalsConfirmation(channelId) });
    const after = await db.$queryRaw<Array<{ metric: string; target: number }>>`SELECT metric, target FROM page_goals WHERE "targetId" = ${channelId}`;
    expect(after.find(g => g.metric === 'followers')?.target).toBe(25);
    expect(after.some(g => g.metric === 'posts')).toBe(false);

    const progress = await channelGoalProgress(actor.workspaceId, channelId, '2026-08-31', at('2026-10-20T00:00:00Z'));
    const byMetric = Object.fromEntries(progress.goals.map(g => [g.metric, g]));
    expect(byMetric.followers).toMatchObject({ actual: 10, pace: 'behind' });
    expect(byMetric.views).toMatchObject({ actual: 400, pace: 'met' });
    expect(byMetric.engagements).toMatchObject({ actual: 35 });
    const audits = await db.$queryRaw<unknown[]>`SELECT id FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'analytics.goals_changed' AND "createdAt" >= ${made.since}`;
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('generates Goals and Destinations report sections from real SQL', async () => {
    const generator = createReportGenerator({ bounds: async () => ({ maxRows: 500, maxBytes: 200000 }), now: () => at('2026-10-20T00:00:00Z') });
    const result = await generator.generate({ actor, channelId, sections: ['goals', 'destinations', 'responseTime', 'topPosts'], period: { start: '2026-08-01', end: '2026-08-31' } });
    if (!result.ok) throw new Error(`report failed: ${result.reason}`);
    expect(result.output.notIncluded).toEqual([]);
    expect(result.output.csv).toContain('"destination","posts_published","Posts published"');
    expect(result.output.csv).toMatch(/"destination_measure","impressions","Impressions","Stored post insights","[^"]*","","100"/);
    expect(result.output.csv).toMatch(/"link_clicks_lifetime"[^\n]*"9"/);
    expect(result.output.csv).toContain('"goal","followers"');
    expect(result.output.csv).toContain('"top_post","rank_1","Synthetic wave 2 post"');
  });

  it('claims a due feed once, creates review posts held for approval, and never duplicates on a second run', async () => {
    const feedId = `${tag}_feed`; made.feeds.push(feedId);
    await db.$executeRaw`INSERT INTO feed_sources (id, "workspaceId", name, url, "targetIds", "autoApprove", "ingestFrom", "updatedAt") VALUES (${feedId}, ${actor.workspaceId}, 'Synthetic feed', 'https://feeds.example.com/rss.xml', ${JSON.stringify([channelId])}::jsonb, false, ${at('2026-01-01T00:00:00Z')}, NOW())`;
    shared.overrides['feeds.autoCheck.enabled'] = true;
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>S</title>${[1, 2].map(n => `<item><title>Synthetic ${tag} ${n}</title><link>https://example.com/${tag}/${n}</link><guid>${tag}-${n}</guid><pubDate>Mon, 19 Oct 2026 10:0${n}:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const net = { resolve: async () => ['93.184.216.34'], fetcher: async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }) };
    const owner = { userId: actor.userId, workspaceId: actor.workspaceId };
    const deps = {
      net, now: () => new Date(),
      validateTargets: async () => [{ id: channelId, socialAccount: { provider: 'facebook' } }],
      resolveFormats: async () => ({ [channelId]: 'feed' }),
      qualify: async (_w: string, accept: (a: typeof owner) => Promise<void>) => { await accept(owner); return { actor: owner, role: 'owner', permissions: {}, entitlements: {}, workspaceWide: true } as never; },
    };
    const first = await runFeedPolling(deps);
    expect(first.outcomes).toContainEqual({ feedId, outcome: 'created' });
    const items = await db.$queryRaw<Array<{ guid: string }>>`SELECT guid FROM feed_items WHERE "feedSourceId" = ${feedId} ORDER BY guid`;
    expect(items.map(i => i.guid)).toEqual([`${tag}-1`, `${tag}-2`]);
    const posts = await db.$queryRaw<Array<{ status: string; approvalStatus: string }>>`SELECT p.status::text AS status, p."approvalStatus"::text AS "approvalStatus" FROM posts p JOIN feed_items i ON i.id = p."sourceFeedItemId" WHERE i."feedSourceId" = ${feedId}`;
    expect(posts).toHaveLength(2);
    expect(posts.every(p => p.status === 'pending_approval' && p.approvalStatus === 'pending')).toBe(true);
    // Not due again: the claim refuses it. Forced due: the same items are recognised and nothing is duplicated.
    expect((await runFeedPolling(deps)).outcomes.some(o => o.feedId === feedId)).toBe(false);
    await db.$executeRaw`UPDATE feed_sources SET "lastPolledAt" = NULL, "lastEtag" = NULL, "lastModified" = NULL WHERE id = ${feedId}`;
    await runFeedPolling(deps);
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM feed_items WHERE "feedSourceId" = ${feedId}`).toHaveLength(2);
  });

  it('creates a webhook, queues an event once, and delivers it signed through a leased claim', async () => {
    shared.overrides['integrations.webhooks.enabled'] = true;
    const resolve = async () => ['93.184.216.34'];
    const created = await createWebhook(actor, { name: `Synthetic ${tag}`, url: 'https://hooks.example.com/in', events: ['post.published'], confirmation: 'CREATE WEBHOOK' }, { deps: { resolve }, skipConfirmation: true }) as { id?: string; webhook?: { id: string } };
    const endpointId = created.webhook?.id ?? created.id!; made.endpoints.push(endpointId);
    const eventId = `${tag}-event`;
    await emitWebhook(actor.workspaceId, 'post.published', { postId: 'synthetic' }, { eventId });
    await emitWebhook(actor.workspaceId, 'post.published', { postId: 'synthetic' }, { eventId });
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM webhook_deliveries WHERE "endpointId" = ${endpointId}`).toHaveLength(1);
    const sent: Array<{ headers: Record<string, string>; body: string }> = [];
    const outcome = await deliverDueWebhooks({ resolve, send: async request => { sent.push({ headers: request.headers, body: request.body }); return { status: 204 }; } });
    expect(outcome.delivered).toBeGreaterThanOrEqual(1);
    expect(sent).toHaveLength(1);
    expect(Object.entries(sent[0]!.headers).some(([k, v]) => k.toLowerCase() === 'x-msp-signature' && /^sha256=/.test(v))).toBe(true);
    const row = await db.$queryRaw<Array<{ status: string; attempts: number }>>`SELECT status, attempts FROM webhook_deliveries WHERE "endpointId" = ${endpointId}`;
    expect(row[0]).toMatchObject({ status: 'delivered', attempts: 1 });
  });
});
