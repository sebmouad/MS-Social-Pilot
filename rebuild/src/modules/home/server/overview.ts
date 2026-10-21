import { homeErrorCopy } from './copy';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { platformAnalytics } from '@/server/platforms/registry';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { readChannelMeasures, readChannelPostHistory } from '@/modules/analytics/server/stored-reads';
import { readInboxList } from '@/modules/inbox/server/read';
import { readAdsDailyRows } from '@/modules/ads/server/report-read';
import { readPublishingPostPage } from '@/modules/publishing/server/read';
import { engagementHeatmap, lastDays, periodTotals, scheduleMode, snippet, spendByCurrency, sumKnown, type HeatmapCell, type Known, type ScheduleMode } from './overview-pure';

/** A card's data: ready, nothing to show yet, or temporarily unreadable. Cards never fail the page together. */
export type Section<T> = { state: 'ready'; data: T } | { state: 'empty' } | { state: 'unavailable' };
export type TrendPoint = { t: string; v: number | null };

export type HomeOverview = {
  generatedAt: string;
  lookbackDays: number;
  timeZone: string;
  channelCount: number;
  /** Cards appear only for enabled, permitted modules; null means the viewer cannot use that module. */
  audience: Section<{ total: number; covered: number; selected: number; asOf: string | null; trend: TrendPoint[] }> | null;
  performance: Section<{
    views: ReturnType<typeof periodTotals>; engagements: ReturnType<typeof periodTotals>; channels: number; truncated: boolean;
    topChannels: Array<{ id: string; name: string; engagements: number }>;
    interactions: Array<{ key: string; label: string; value: number }>;
  }> | null;
  bestTimes: Section<{ cells: HeatmapCell[]; measuredPosts: number }> | null;
  upcoming: Section<{ total: number; items: Array<{ id: string; text: string; scheduledAt: string; channels: string[]; mode: ScheduleMode }> }> | null;
  inbox: Section<{ open: number }> | null;
  ads: Section<{ start: string; end: string; spend: Array<{ currency: string | null; total: number; firstDay: string; lastDay: string; recordedDays: number; daily: TrendPoint[] }> }> | null;
};

/** Payload of one card, without its state wrapper. */
type Data<K extends keyof HomeOverview> = Exclude<HomeOverview[K], null> extends Section<infer T> ? T : never;

export type HomeActor = { userId: string; workspaceId: string };

const KEYS = ['home.lookbackDays', 'home.maxChannels', 'home.topChannelsLimit', 'home.upcomingLimit', 'home.snippetCharacters', 'home.interactionMeasureKeys',
  'home.heatmapLookbackDays', 'home.heatmapMaxPostsPerChannel', 'home.heatmapMinPosts', 'home.adsMaxPages'] as const;
const DAY = 86_400_000;
/** Calendar day key (YYYY-MM-DD) from a day string, ISO timestamp or Date. */
const dayKey = (value: unknown): string => { if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10); const date = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10); }; // Fixed UTC calendar duration, not an operational setting.

async function settled<T>(read: () => Promise<Section<T>>): Promise<Section<T>> {
  try { return await read(); } catch { return { state: 'unavailable' }; }
}

/**
 * The Home overview: one read of stored figures through each product module's own service, so every figure follows the same
 * authorization, selection and entitlement rules as the module's screen. No provider request is made.
 */
export async function readHomeOverview(actor: HomeActor, now = new Date()): Promise<HomeOverview> {
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions) throw new OperationError('forbidden', (await homeErrorCopy()).homeUnavailable);
  const allowed = (feature: string) => canUseFeature(entitlements, feature) && canAccessFeature(permissions, feature, 'read');
  const config = await runtimeConfigBatch(KEYS) as Record<(typeof KEYS)[number], unknown>;
  const lookbackDays = Number(config['home.lookbackDays']), maxChannels = Number(config['home.maxChannels']);
  const channelScope = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId }, select: { timezone: true } });
  const timeZone = workspace?.timezone ?? 'UTC';
  const period = lastDays(now, lookbackDays);

  const wantsAnalytics = allowed('analytics/overview');
  const snapshot = wantsAnalytics ? await readAnalyticsSnapshot({ userId: actor.userId, workspaceId: actor.workspaceId }, { start: period.start, end: period.end },
    { feature: 'analytics/overview', ...(channelScope ? { allowedChannelIds: channelScope } : {}) }).catch(() => null) : null;
  const channels = snapshot ? snapshot.options.channels.filter(channel => snapshot.selected.channelIds.includes(channel.id)) : [];
  const readChannels = channels.slice(0, maxChannels);
  const providers = readChannels.length ? new Map((await prisma.$queryRaw<Array<{ id: string; provider: string }>>`SELECT t.id, a.provider FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${actor.workspaceId} AND t.id = ANY(${readChannels.map(channel => channel.id)}::text[])`).map(row => [row.id, row.provider])) : new Map<string, string>();
  // Keep host/configuration promises inside this request; never retain tenant reads across requests.
  const hosts = new Map<string, ReturnType<typeof platformAnalytics>>();
  const providerChannels = new Map<string, typeof readChannels>();
  for (const channel of readChannels) {
    const provider = providers.get(channel.id);
    if (provider) providerChannels.set(provider, [...(providerChannels.get(provider) ?? []), channel]);
  }
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
    return { state: 'ready', data: { total: snapshot.audience.total, covered: snapshot.audience.covered, selected: snapshot.audience.selected, asOf: asOf?.toISOString() ?? null,
      trend: series && series.points.length > 1 ? series.points.map(point => ({ t: dayKey(point.date), v: point.value })) : [] } };
  });

  const performance = !wantsAnalytics ? null : settled<Data<'performance'>>(async () => {
    if (!snapshot) return { state: 'unavailable' };
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
    const views = periodTotals(rows.map(row => ({ current: row.current?.views ?? null, previous: row.previous?.views ?? null })));
    const engagements = periodTotals(rows.map(row => ({ current: row.current?.engagements ?? null, previous: row.previous?.engagements ?? null })));
    if (views.current === null && engagements.current === null) return { state: 'empty' };
    const topLimit = Number(config['home.topChannelsLimit']);
    const topChannels = rows.flatMap(row => row.current?.engagements != null && Number.isFinite(row.current.engagements) ? [{ id: row.channel.id, name: row.channel.name, engagements: row.current.engagements }] : [])
      .sort((a, b) => b.engagements - a.engagements || a.name.localeCompare(b.name)).slice(0, topLimit);
    const mixByKey = new Map<string, { label: string; values: Known[] }>();
    for (const row of rows) for (const measure of row.mix) { const entry = mixByKey.get(measure.key) ?? { label: measure.label, values: [] }; entry.values.push(measure.value); mixByKey.set(measure.key, entry); }
    const interactions = interactionKeys.flatMap(key => { const entry = mixByKey.get(key); const value = entry ? sumKnown(entry.values) : null; return entry && value !== null ? [{ key, label: entry.label, value }] : []; });
    return { state: 'ready', data: { views, engagements, channels: readChannels.length, truncated: channels.length > readChannels.length, topChannels, interactions } };
  });

  const bestTimes = !allowed('analytics/posts') || !wantsAnalytics ? null : settled<Data<'bestTimes'>>(async () => {
    if (!snapshot) return { state: 'unavailable' };
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
      mode: scheduleMode(post.targets.map(target => target.status)),
    }));
    return { state: 'ready', data: { total: page.total, items } };
  });

  const inbox = !allowed('inbox/conversations') ? null : settled<Data<'inbox'>>(async () => {
    const page = await readInboxList({ userId: actor.userId, workspaceId: actor.workspaceId, ...(channelScope ? { allowedChannelIds: channelScope } : {}) }, { state: 'open', limit: 1 });
    return { state: 'ready', data: { open: page.total } };
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
  const [audienceData, performanceData, bestTimesData, upcomingData, inboxData, adsData] = await Promise.all([audience, performance, bestTimes, upcoming, inbox, ads]);
  return { generatedAt: now.toISOString(), lookbackDays, timeZone, channelCount: channels.length, audience: audienceData, performance: performanceData, bestTimes: bestTimesData, upcoming: upcomingData, inbox: inboxData, ads: adsData };
}
