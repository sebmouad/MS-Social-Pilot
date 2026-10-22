import type { AnalyticsRequest, PlatformCredential } from '../types';
import type { AnalyticsAudienceEntry, AnalyticsMetricInput } from '@/modules/analytics/server/catalog';
import type { InstagramPolicy } from './config';
import { InstagramError, object, type InstagramGraph } from './transport';
import { requireScopes } from './publishing';

export type InstagramInsight = { metric: string; period: string; asOf: Date; value: unknown; rangeTotal: boolean; raw: Record<string, unknown> };
export type InstagramMediaItem = {
  remoteId: string; caption: string | null; mediaType: string | null; mediaProductType: string | null;
  mediaUrl: string | null; permalink: string | null; thumbnailUrl: string | null; timestamp: Date;
  likeCount: number | null; commentsCount: number | null;
  insights: Record<string, number | null>; insightsSyncedAt: Date | null;
};
export function normalizeInstagramInsights(rows: readonly InstagramInsight[], target: { id: string; name: string }, policy: InstagramPolicy, locale: 'en' | 'fr', fetchedAt: Date): AnalyticsMetricInput[] {
  const groups = new Map<string, AnalyticsMetricInput>();
  for (const row of rows) {
    if (!Number.isFinite(row.asOf.getTime()) || row.value == null) continue;
    const numeric = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
    const breakdown = numeric === null;
    const key = `${row.metric}::${row.period}::${row.rangeTotal ? 'range' : 'series'}`;
    // Reach, lifetime media and range totals cannot be summed over dates.
    const additive = !breakdown && row.period === 'day' && !row.rangeTotal && row.metric !== 'reach';
    const kind = breakdown ? 'breakdown' : additive ? 'flow' : 'stock';
    const metric = groups.get(key) ?? {
      key, label: policy.labels[row.metric]?.[locale] ?? row.metric.replace(/_/g, ' '), sourceLabel: policy.copy.source[locale],
      resourceKind: 'channel', coveredResourceIds: [target.id], kind, unit: 'count', observations: [],
      rollup: additive ? 'sum' : 'latest-per-channel', aggregationNote: policy.copy.overlap[locale], available: 1, covered: 1,
      latestAt: row.asOf, updatedAt: fetchedAt,
    } satisfies AnalyticsMetricInput;
    if (numeric !== null) metric.observations.push({ date: row.asOf, channelId: target.id, channelLabel: target.name, value: numeric });
    else {
      // Keep each category in its snapshot; never flatten distinct breakdowns into an invented total.
      const categories: Array<{ label: string; value: number | null }> = [];
      function flatten(value: unknown, prefix: string) {
        if (typeof value === 'number' && Number.isFinite(value)) categories.push({ label: prefix, value });
        else if (Array.isArray(value)) value.forEach((item, index) => {
          const entry = object(item);
          if (Array.isArray(entry.results)) {
            const dimensions = Array.isArray(entry.dimension_keys) ? entry.dimension_keys : [];
            for (const result of entry.results) {
              const category = object(result);
              const values = Array.isArray(category.dimension_values) ? category.dimension_values : [];
              const label = values.map((item, i) => `${dimensions[i] ?? i}: ${String(item)}`).join(' · ');
              flatten(category.value, label || `${prefix}/${index}`);
            }
          } else flatten(item, `${prefix}/${index}`);
        });
        else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}/${key}` : key);
      }
      flatten(row.value, '');
      metric.breakdownHistory ??= [];
      metric.breakdownHistory.push({ resourceId: target.id, resourceLabel: target.name, asOf: row.asOf, fetchedAt, rows: categories });
    }
    if (!metric.latestAt || row.asOf > metric.latestAt) metric.latestAt = row.asOf;
    groups.set(key, metric);
  }
  return [...groups.values()].map(metric => ({ ...metric, observations: metric.observations.sort((a, b) => a.date.getTime() - b.date.getTime()) }));
}
/** Latest profile count is a standing audience snapshot, independent of the selected posting window. */
export function normalizeInstagramAudience(profile: { followersCount: number | null; fetchedAt: Date }, target: { id: string; name: string }, policy: InstagramPolicy, locale: 'en' | 'fr'): AnalyticsAudienceEntry[] {
  if (profile.followersCount === null || !Number.isFinite(profile.followersCount) || profile.followersCount < 0) return [];
  return [{ id: target.id, name: target.name, metric: 'followers_count', metricLabel: policy.labels.followers_count?.[locale] ?? 'followers_count'.replace(/_/g, ' '), sourceLabel: policy.copy.source[locale], value: profile.followersCount, asOf: profile.fetchedAt, fetchedAt: profile.fetchedAt }];
}
export function createInstagramInsights(policy: InstagramPolicy, graph: InstagramGraph) {
  async function collect(credential: PlatformCredential, id: string, queries: Array<Record<string, string>>, asOf: Date) {
    requireScopes(graph, credential, policy.insightScopes);
    const rows: InstagramInsight[] = []; const failures: string[] = [];
    for (const query of queries) {
      try {
        const response = await graph.list(`${id}/insights`, credential.accessToken, query);
        for (const raw of response.items) {
          if (typeof raw.name !== 'string' || typeof raw.period !== 'string') continue;
          if (Array.isArray(raw.values)) for (const point of raw.values) {
            const value = object(point); const date = typeof value.end_time === 'string' ? new Date(value.end_time) : asOf;
            rows.push({ metric: raw.name, period: raw.period, asOf: date, value: value.value, rangeTotal: false, raw });
          }
          if (raw.total_value !== undefined) {
            const total = object(raw.total_value);
            rows.push({ metric: raw.name, period: raw.period, asOf, value: total.breakdowns ?? total.value ?? raw.total_value, rangeTotal: true, raw });
          }
        }
        if (response.truncated) failures.push(query.metric!);
      } catch { failures.push(query.metric!); }
    }
    return { rows, failedMetrics: failures };
  }
  async function account(request: AnalyticsRequest) {
    const params = { ...(request.since ? { since: String(Math.floor(request.since.getTime() / 1000)) } : {}), ...(request.until ? { until: String(Math.floor(request.until.getTime() / 1000)) } : {}) };
    return collect(request.credential, request.targetId, policy.accountMetrics.map(metric => ({ ...params, metric: metric.name, period: metric.period, metric_type: metric.metricType, ...(metric.breakdown ? { breakdown: metric.breakdown } : {}) })), request.until ?? new Date());
  }
  async function post(credential: PlatformCredential, remoteId: string, asOf: Date) {
    return collect(credential, remoteId, policy.postMetrics.map(metric => ({ metric })), asOf);
  }
  /** Bounded media window with per-media insights. Missing measures stay null, never zero. */
  async function media(credential: PlatformCredential, targetId: string, since: Date, asOf: Date): Promise<{ items: InstagramMediaItem[]; failedMedia: string[] }> {
    requireScopes(graph, credential, policy.insightScopes);
    const response = await graph.list(`${targetId}/media`, credential.accessToken, { fields: 'id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count' });
    const text = (value: unknown) => typeof value === 'string' ? value : null;
    const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const rows = response.items.flatMap(raw => {
      const timestamp = typeof raw.timestamp === 'string' ? new Date(raw.timestamp) : null;
      if (typeof raw.id !== 'string' || !raw.id || !timestamp || !Number.isFinite(timestamp.getTime())) return [];
      return [{ raw, timestamp }];
    });
    // A clipped page set is complete only when an older item proves the window edge; otherwise the run must fail loudly.
    if (response.truncated && !rows.some(row => row.timestamp < since)) throw new InstagramError(graph.text('unavailable'), 'uncertain');
    const items: InstagramMediaItem[] = []; const failedMedia: string[] = [];
    for (const { raw, timestamp } of rows) {
      if (timestamp < since) continue;
      const remoteId = raw.id as string;
      let insights: Record<string, number | null> = {}; let insightsSyncedAt: Date | null = null;
      try {
        const collected = await post(credential, remoteId, asOf);
        for (const name of policy.postMetrics) {
          const value = collected.rows.find(row => row.metric === name && typeof row.value === 'number' && Number.isFinite(row.value))?.value;
          insights[name] = typeof value === 'number' ? value : null;
        }
        if (collected.failedMetrics.length) failedMedia.push(remoteId);
        else if (Object.values(insights).every(value => value !== null)) insightsSyncedAt = asOf;
      } catch { failedMedia.push(remoteId); insights = {}; }
      items.push({ remoteId, caption: text(raw.caption), mediaType: text(raw.media_type), mediaProductType: text(raw.media_product_type),
        mediaUrl: text(raw.media_url), permalink: text(raw.permalink), thumbnailUrl: text(raw.thumbnail_url), timestamp,
        likeCount: count(raw.like_count), commentsCount: count(raw.comments_count), insights, insightsSyncedAt });
    }
    return { items, failedMedia };
  }
  async function profile(credential: PlatformCredential, targetId: string) {
    requireScopes(graph, credential, policy.readScopes);
    const raw = await graph.request(targetId, credential.accessToken, { fields: 'id,username,name,followers_count,follows_count,media_count,profile_picture_url' });
    return { raw, followersCount: typeof raw.followers_count === 'number' && Number.isFinite(raw.followers_count) ? raw.followers_count : null, fetchedAt: new Date() };
  }
  return { account, post, profile, media };
}
