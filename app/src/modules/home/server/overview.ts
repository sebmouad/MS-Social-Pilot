import { homeErrorCopy } from './copy';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { platformAnalytics } from '@/server/platforms/registry';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { postThumbnail, type PostThumbnail } from '@/components/post-thumbnail';
import { pickMetric } from '@/modules/analytics/ui/insights/overview-model';
import type { InsightsPolicy } from '@/modules/analytics/ui/insights/insights-config';
import { readChannelMeasures, readChannelPostHistory } from '@/modules/analytics/server/stored-reads';
import { readInboxList } from '@/modules/inbox/server/read';
import { readAdsDailyRows } from '@/modules/ads/server/report-read';
import { readPublishingPostPage } from '@/modules/publishing/server/read';
import { pendingApprovalCount } from '@/modules/publishing/server/approvals-badge';
import { shellChannels } from '@/modules/shell/server/channels';
import { engagementHeatmap, lastDays, periodTotals, scheduleMode, snippet, spendByCurrency, sumKnown, type HeatmapCell, type Known, type ScheduleMode } from './overview-pure';

/** A card's data: ready, nothing to show yet, or temporarily unreadable. Cards never fail the page together. */
export type Section<T> = { state: 'ready'; data: T } | { state: 'empty' } | { state: 'unavailable' };
export type TrendPoint = { t: string; v: number | null };

export type HomeAttention = {
  /** Null when the viewer may not use the owning module, or that read failed while others succeeded. */
  failedPosts: number | null; partiallyFailedPosts: number | null; pendingApprovals: number | null; waitingConversations: number | null;
  reconnect: Array<{ id: string; name: string; platform: string | null }> | null;
  /** True when at least one permitted read failed; the strip shows what is known with a warning. */
  partial: boolean;
};
export type HomeOverview = {
  generatedAt: string;
  lookbackDays: number;
  timeZone: string;
  channelCount: number;
  /** Cards appear only for enabled, permitted modules; null means the viewer cannot use that module. */
  audience: Section<{ total: number; covered: number; selected: number; asOf: string | null; trend: TrendPoint[]; delta: { value: number; since: string } | null }> | null;
  performance: Section<{
    views: ReturnType<typeof periodTotals>; engagements: ReturnType<typeof periodTotals>; linkClicks: ReturnType<typeof periodTotals> | null;
    channels: number; truncated: boolean;
    topChannels: Array<{ id: string; name: string; engagements: number }>;
    interactions: Array<{ key: string; label: string; value: number }>;
  }> | null;
  bestTimes: Section<{ cells: HeatmapCell[]; measuredPosts: number }> | null;
  upcoming: Section<{ total: number; items: Array<{ id: string; text: string; scheduledAt: string; channels: string[]; mode: ScheduleMode; thumbnail: PostThumbnail | null }> }> | null;
  inbox: Section<{ open: number; recent: Array<{ key: string; author: string; preview: string; time: string; channel: string; unread: number }> }> | null;
  ads: Section<{ start: string; end: string; spend: Array<{ currency: string | null; total: number; firstDay: string; lastDay: string; recordedDays: number; daily: TrendPoint[] }> }> | null;
  attention: Section<HomeAttention> | null;
};

/** Payload of one card, without its state wrapper. */
type Data<K extends keyof HomeOverview> = Exclude<HomeOverview[K], null> extends Section<infer T> ? T : never;

export type HomeActor = { userId: string; workspaceId: string };

const KEYS = ['home.lookbackDays', 'home.maxChannels', 'home.topChannelsLimit', 'home.upcomingLimit', 'home.snippetCharacters', 'home.interactionMeasureKeys',
  'home.heatmapLookbackDays', 'home.heatmapMaxPostsPerChannel', 'home.heatmapMinPosts', 'home.adsMaxPages',
  'home.linkClickMeasureWords', 'analytics.insightsPolicy', 'home.recentInboxLimit', 'home.recentInboxPreviewCharacters', 'home.attentionReconnectLimit'] as const;
const DAY = 86_400_000;
/** Calendar day key (YYYY-MM-DD) from a day string, ISO timestamp or Date. */
const dayKey = (value: unknown): string => { if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10); const date = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10); }; // Fixed UTC calendar duration, not an operational setting.

async function settled<T>(read: () => Promise<Section<T>>): Promise<Section<T>> {
  try { return await read(); } catch { return { state: 'unavailable' }; }
}

/**
 * The Home overview: one read of stored figures through each product module's own service, so every figure follows the same
 * authorization, selection and entitlement rules as the module's screen. No provider request is made.
 * `channelIds` is the shared sidebar scope; it only narrows the member's current grants, never widens them.
 */
export async function readHomeOverview(actor: HomeActor, now = new Date(), options: { channelIds?: readonly string[] } = {}): Promise<HomeOverview> {
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions) throw new OperationError('forbidden', (await homeErrorCopy()).homeUnavailable);
  const allowed = (feature: string) => canUseFeature(entitlements, feature) && canAccessFeature(permissions, feature, 'read');
  const config = await runtimeConfigBatch(KEYS) as Record<(typeof KEYS)[number], unknown>;
  const insightsPolicy = config['analytics.insightsPolicy'] as InsightsPolicy;
  const lookbackDays = Number(config['home.lookbackDays']), maxChannels = Number(config['home.maxChannels']);
  const memberScope = permissions.pageScope.all ? undefined : [...permissions.pageScope.ids];
  const requested = options.channelIds?.filter(id => typeof id === 'string' && id.length > 0);
  // Unknown or ungranted ids are dropped: the scope is a display filter, and every service re-authorizes below.
  const channelScope = requested?.length ? requested.filter(id => !memberScope || memberScope.includes(id)) : memberScope;
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId }, select: { timezone: true } });
  const timeZone = workspace?.timezone ?? 'UTC';
  const period = lastDays(now, lookbackDays);

  const wantsAnalytics = allowed('analytics/overview');
  const snapshot = wantsAnalytics ? await readAnalyticsSnapshot({ userId: actor.userId, workspaceId: actor.workspaceId }, { start: period.start, end: period.end },
    { feature: 'analytics/overview', ...(channelScope ? { allowedChannelIds: channelScope } : {}) }).catch(() => null) : null;
  const channels = snapshot ? snapshot.options.channels.filter(channel => snapshot.selected.channelIds.includes(channel.id)) : [];
  const readChannels = channels.slice(0, maxChannels);
  // The provider lookup must not reject the whole overview; dependents report unavailable instead of empty.
  let providerChannels = new Map<string, typeof readChannels>();
  let channelsFailed = false;
  try {
    const providers = readChannels.length ? new Map((await prisma.$queryRaw<Array<{ id: string; provider: string }>>`SELECT t.id, a.provider FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${actor.workspaceId} AND t.id = ANY(${readChannels.map(channel => channel.id)}::text[])`).map(row => [row.id, row.provider])) : new Map<string, string>();
    for (const channel of readChannels) {
      const provider = providers.get(channel.id);
      if (provider) providerChannels.set(provider, [...(providerChannels.get(provider) ?? []), channel]);
    }
  } catch { channelsFailed = true; }
  // Keep host/configuration promises inside this request; never retain tenant reads across requests.
  const hosts = new Map<string, ReturnType<typeof platformAnalytics>>();
  const hostFor = (provider: string) => {
    if (!hosts.has(provider)) hosts.set(provider, platformAnalytics(provider));
    return hosts.get(provider)!;
  };

  const currentWindow = { from: new Date(`${period.start}T00:00:00.000Z`), to: now };
  const previousWindow = { from: new Date(currentWindow.from.getTime() - lookbackDays * DAY), to: currentWindow.from };

  const audience = !wantsAnalytics ? null : settled<Data<'audience'>>(async () => {
    if (!snapshot) return { state: 'unavailable' };
    if (!snapshot.audience.entries.length) return { state: 'empty' };
    // A trend only when every counted channel reports the same stored measure; otherwise the series would mix meanings.
    const metricKeys = new Set(snapshot.audience.entries.map(entry => entry.metric));
    const series = metricKeys.size === 1 ? snapshot.allMetrics.find(metric => metric.key === [...metricKeys][0] && metric.kind === 'stock' && metric.resourceKind === 'channel') : undefined;
    const asOf = snapshot.audience.entries.reduce<Date | null>((latest, entry) => !latest || entry.asOf > latest ? entry.asOf : latest, null);
    const trend = series && series.points.length > 1 ? series.points.map(point => ({ t: dayKey(point.date), v: point.value })) : [];
    // The delta is the net change between the oldest and newest known trend days, with its start day; null without two known days.
    const known = trend.filter(point => typeof point.v === 'number' && Number.isFinite(point.v));
    const delta = known.length > 1 ? { value: known[known.length - 1]!.v! - known[0]!.v!, since: known[0]!.t } : null;
    return { state: 'ready', data: { total: snapshot.audience.total, covered: snapshot.audience.covered, selected: snapshot.audience.selected, asOf: asOf?.toISOString() ?? null, trend, delta } };
  });

  const performance = !wantsAnalytics ? null : settled<Data<'performance'>>(async () => {
    if (!snapshot) return { state: 'unavailable' };
    if (channelsFailed) return { state: 'unavailable' };
    if (!readChannels.length) return { state: 'empty' };
    const interactionKeys = (config['home.interactionMeasureKeys'] as string[]);
    const groups = await Promise.all([...providerChannels].map(async ([provider, channels]) => {
      const host = await hostFor(provider);
      if (!host) return [];
      return readChannelMeasures(host, { workspaceId: actor.workspaceId, targetIds: channels.map(channel => channel.id), current: currentWindow, previous: previousWindow });
    }));
    const byId = new Map(groups.flat().map(row => [row.targetId, row]));
    const rows = readChannels.map(channel => {
      const row = byId.get(channel.id);
      return { channel, current: row?.current ?? null, previous: row?.previous ?? null, mix: row?.mix.filter(measure => interactionKeys.includes(measure.key)) ?? [] };
    });
    // Views, engagements and link clicks come from the same snapshot as the Insights tiles: the first stored channel
    // metric whose label matches the words, with its snapshot comparison (no change unless both periods are comparable).
    // No match, or no stored total, means no tile, not zero.
    const fromSnapshot = (words: readonly string[]) => {
      const metric = pickMetric(snapshot.allMetrics, words);
      if (!metric) return null;
      const comparison = snapshot.comparisons[metric.key];
      const previous = comparison?.status === 'comparable' ? comparison.previous : null;
      return {
        current: metric.total, previous,
        change: metric.total !== null && previous !== null && previous > 0 ? (metric.total - previous) / previous : null,
        covered: metric.coverage, comparable: comparison?.status === 'comparable' ? metric.coverage : 0,
      };
    };
    const tileWords = (id: string) => insightsPolicy.tiles.find(tile => tile.id === id)?.words ?? [];
    const empty = { current: null, previous: null, change: null, covered: 0, comparable: 0 };
    const views = fromSnapshot(tileWords('views')) ?? empty;
    const engagements = fromSnapshot(tileWords('engagements')) ?? empty;
    const linkClicks = fromSnapshot(config['home.linkClickMeasureWords'] as string[]);
    if (views.current === null && engagements.current === null && (linkClicks === null || linkClicks.current === null)) return { state: 'empty' };
    const topLimit = Number(config['home.topChannelsLimit']);
    const topChannels = rows.flatMap(row => row.current?.engagements != null && Number.isFinite(row.current.engagements) ? [{ id: row.channel.id, name: row.channel.name, engagements: row.current.engagements }] : [])
      .sort((a, b) => b.engagements - a.engagements || a.name.localeCompare(b.name)).slice(0, topLimit);
    const mixByKey = new Map<string, { label: string; values: Known[] }>();
    for (const row of rows) for (const measure of row.mix) { const entry = mixByKey.get(measure.key) ?? { label: measure.label, values: [] }; entry.values.push(measure.value); mixByKey.set(measure.key, entry); }
    const interactions = interactionKeys.flatMap(key => { const entry = mixByKey.get(key); const value = entry ? sumKnown(entry.values) : null; return entry && value !== null ? [{ key, label: entry.label, value }] : []; });
    return { state: 'ready', data: { views, engagements, linkClicks, channels: readChannels.length, truncated: channels.length > readChannels.length, topChannels, interactions } };
  });

  const bestTimes = !allowed('analytics/posts') || !wantsAnalytics ? null : settled<Data<'bestTimes'>>(async () => {
    if (!snapshot || channelsFailed) return { state: 'unavailable' };
    const from = new Date(now.getTime() - Number(config['home.heatmapLookbackDays']) * DAY);
    const groups = await Promise.all([...providerChannels].map(async ([provider, channels]) => {
      const host = await hostFor(provider);
      return host ? readChannelPostHistory(host, { workspaceId: actor.workspaceId, targetIds: channels.map(channel => channel.id), from, to: now,
        limit: Number(config['home.heatmapMaxPostsPerChannel']), sort: 'publishedAt', direction: 'desc' }) : [];
    }));
    const histories = groups.flat();
    const result = engagementHeatmap(histories, timeZone, Number(config['home.heatmapMinPosts']));
    return result.cells.length ? { state: 'ready', data: result } : { state: 'empty' };
  });

  const upcoming = !allowed('publishing/posts') ? null : settled<Data<'upcoming'>>(async () => {
    const page = await readPublishingPostPage({ userId: actor.userId, workspaceId: actor.workspaceId, ...(channelScope ? { allowedTargetIds: channelScope } : {}) }, { status: 'scheduled', order: 'scheduled_asc' });
    if (!page.total) return { state: 'empty' };
    const text = Number(config['home.snippetCharacters']);
    const items = page.posts.filter(post => post.scheduledAt).slice(0, Number(config['home.upcomingLimit'])).map(post => ({
      id: post.id, text: snippet(post.message, text), scheduledAt: post.scheduledAt!.toISOString(), channels: post.targets.map(target => target.target.name),
      mode: scheduleMode(post.targets.map(target => target.status)), thumbnail: postThumbnail(post.media),
    }));
    return { state: 'ready', data: { total: page.total, items } };
  });

  const inbox = !allowed('inbox/conversations') ? null : settled<Data<'inbox'>>(async () => {
    const recentLimit = Number(config['home.recentInboxLimit']);
    const previewLength = Number(config['home.recentInboxPreviewCharacters']);
    const page = await readInboxList({ userId: actor.userId, workspaceId: actor.workspaceId, ...(channelScope ? { allowedChannelIds: channelScope } : {}) }, { state: 'open', limit: recentLimit });
    return { state: 'ready', data: { open: page.total, recent: page.items.slice(0, recentLimit).map(item => ({
      key: item.key, author: item.author, preview: snippet(item.preview, previewLength),
      time: item.time instanceof Date ? item.time.toISOString() : new Date(item.time).toISOString(),
      channel: item.target.name, unread: item.unread,
    })) } };
  });

  const wantsAttention = allowed('publishing/posts') || allowed('publishing/approvals') || allowed('inbox/conversations') || allowed('settings/connections');
  const attention = !wantsAttention ? null : settled<Data<'attention'>>(async () => {
    const publishingActor = { userId: actor.userId, workspaceId: actor.workspaceId, ...(channelScope ? { allowedTargetIds: channelScope } : {}) };
    const inboxActor = { userId: actor.userId, workspaceId: actor.workspaceId, ...(channelScope ? { allowedChannelIds: channelScope } : {}) };
    const reconnectLimit = Number(config['home.attentionReconnectLimit']);
    // Each count is read through its own module's service with the same authorization as the module's screen.
    // A failed count is withheld (null) while the others still show; all failing together is unavailable.
    const [failed, partial, approvals, waiting, reconnect] = await Promise.all([
      allowed('publishing/posts') ? readPublishingPostPage(publishingActor, { status: 'failed' }).then(page => page.total, () => null) : null,
      allowed('publishing/posts') ? readPublishingPostPage(publishingActor, { status: 'partially_failed' }).then(page => page.total, () => null) : null,
      allowed('publishing/approvals') ? pendingApprovalCount({ userId: actor.userId, workspaceId: actor.workspaceId }) : null,
      allowed('inbox/conversations') ? readInboxList(inboxActor, { state: 'open', quick: ['unanswered'], limit: 1 }).then(page => page.total, () => null) : null,
      allowed('settings/connections')
        ? shellChannels(actor.workspaceId, channelScope ? [...channelScope] : undefined, maxChannels, now)
          .then(rows => rows.filter(row => row.health !== 'connected').slice(0, reconnectLimit).map(row => ({ id: row.id, name: row.name, platform: row.platformName })), () => null)
        : null,
    ]);
    const attempts: Array<{ want: boolean; value: unknown }> = [
      { want: allowed('publishing/posts'), value: failed }, { want: allowed('publishing/posts'), value: partial },
      { want: allowed('publishing/approvals'), value: approvals }, { want: allowed('inbox/conversations'), value: waiting },
      { want: allowed('settings/connections'), value: reconnect },
    ];
    const wanted = attempts.filter(attempt => attempt.want);
    if (wanted.length && wanted.every(attempt => attempt.value === null)) return { state: 'unavailable' };
    return { state: 'ready', data: { failedPosts: failed, partiallyFailedPosts: partial, pendingApprovals: approvals, waitingConversations: waiting, reconnect, partial: wanted.some(attempt => attempt.value === null) } };
  });

  const ads = !(allowed('ads/overview') && allowed('ads/campaigns')) ? null : settled<Data<'ads'>>(async () => {
    const actorForAds = { userId: actor.userId, workspaceId: actor.workspaceId, ...(channelScope ? { allowedTargetIds: channelScope } : {}) };
    const rows: Array<{ currency: string | null; spend: number; date: string }> = [];
    let offset = 0;
    for (let page = 0; page < Number(config['home.adsMaxPages']); page++) {
      const result = await readAdsDailyRows(actorForAds, { start: period.start, end: period.end, level: 'account', offset });
      rows.push(...result.rows.map(row => ({ currency: row.currency, spend: row.spend, date: row.date })));
      if (result.nextOffset === null) {
        if (!rows.length) return { state: 'empty' };
        return { state: 'ready', data: { ...period, spend: spendByCurrency(rows).map(group => ({ currency: group.currency, total: group.total,
          firstDay: group.daily[0]!.date, lastDay: group.daily[group.daily.length - 1]!.date, recordedDays: group.daily.length,
          daily: group.daily.map(day => ({ t: dayKey(day.date), v: day.value })) })) } };
      }
      offset = result.nextOffset;
    }
    return { state: 'unavailable' }; // More stored rows than the configured bound: withhold rather than show a partial spend.
  });

  // Each card still isolates its own failure, while independent stored-data reads overlap.
  const [audienceData, performanceData, bestTimesData, upcomingData, inboxData, adsData, attentionData] = await Promise.all([audience, performance, bestTimes, upcoming, inbox, ads, attention]);
  return { generatedAt: now.toISOString(), lookbackDays, timeZone, channelCount: channels.length, audience: audienceData, performance: performanceData, bestTimes: bestTimesData, upcoming: upcomingData, inbox: inboxData, ads: adsData, attention: attentionData };
}
