import { GraphError, asGraphError, graphRequest } from './graph';
import {
  PAGE_PROFILE_FIELDS,
  findMetric,
  metricsFor,
  type MetricDefinition,
  type MetricLevel,
  type MetricPeriod,
} from './metrics';

/**
 * Reading everything the Graph API will give us about a Page or a post.
 *
 * The hard part is not the HTTP. It is that **Graph rejects the whole request
 * if a single metric name is unknown** (error 100), and Meta removes metrics
 * between versions without warning individual apps. Asking for thirty metrics
 * and getting one 400 back tells you nothing about the other twenty-nine.
 *
 * So requests are chunked, and a failing chunk is **bisected** until the
 * offending names are isolated. The result reports what came back *and* what
 * was refused, which is what lets the UI say "Meta no longer serves this"
 * instead of showing an empty chart.
 */

/** Metrics per request. Graph accepts more, but smaller chunks bisect faster. */
const CHUNK_SIZE = 8;
/** Stop bisecting below this size and test names individually. */
const BISECT_FLOOR = 1;

export interface MetricPoint {
  /** End of the window this value covers. */
  endTime: string | null;
  /** A plain number, or a breakdown map for metrics like page_fans_country. */
  value: number | Record<string, number>;
}

export interface MetricSeries {
  name: string;
  period: MetricPeriod | string;
  title: string | null;
  description: string | null;
  points: MetricPoint[];
  /** Sum for plain metrics; null for breakdowns, where a total is meaningless. */
  total: number | null;
  /** Most recent value, which is what "current" means for lifetime metrics. */
  latest: number | Record<string, number> | null;
}

export interface UnavailableMetric {
  name: string;
  reason: string;
  code: number | null;
}

export interface InsightsResult {
  series: MetricSeries[];
  unavailable: UnavailableMetric[];
  /** Metric names that returned successfully but with no data points at all. */
  empty: string[];
}

interface RawInsight {
  name: string;
  period: string;
  title?: string;
  description?: string;
  values?: Array<{ value: unknown; end_time?: string }>;
}

function normaliseValue(value: unknown): number | Record<string, number> | null {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return null;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    );
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }
  return null;
}

function toSeries(raw: RawInsight): MetricSeries {
  const points: MetricPoint[] = (raw.values ?? [])
    .map((entry) => ({ endTime: entry.end_time ?? null, value: normaliseValue(entry.value) }))
    .filter((point): point is MetricPoint => point.value !== null);

  const numeric = points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === 'number');

  return {
    name: raw.name,
    period: raw.period,
    title: raw.title ?? null,
    description: raw.description ?? null,
    points,
    // A breakdown has no meaningful sum, so it gets null rather than 0.
    total: numeric.length === points.length && points.length > 0
      ? numeric.reduce((sum, value) => sum + value, 0)
      : null,
    latest: points.length > 0 ? points[points.length - 1]!.value : null,
  };
}

interface FetchOptions {
  accessToken: string;
  period?: MetricPeriod;
  since?: Date;
  until?: Date;
  signal?: AbortSignal;
  /** The edge to read. Videos use `video_insights`; everything else `insights`. */
  edge?: string;
  /** Extra query parameters, e.g. Instagram's `metric_type` or `breakdown`. */
  extraParams?: Record<string, string | number | undefined>;
}

/** One Graph call for a set of metric names. Throws on any failure. */
async function fetchChunk(
  objectId: string,
  names: string[],
  options: FetchOptions,
): Promise<RawInsight[]> {
  const params: Record<string, string | number | undefined> = {
    ...options.extraParams,
    metric: names.join(','),
  };
  if (options.period) params.period = options.period;
  // Graph wants unix seconds for since/until.
  if (options.since) params.since = Math.floor(options.since.getTime() / 1000);
  if (options.until) params.until = Math.floor(options.until.getTime() / 1000);

  const { data } = await graphRequest<{ data: RawInsight[] }>(
    `${objectId}/${options.edge ?? 'insights'}`,
    {
      accessToken: options.accessToken,
      params,
      signal: options.signal,
    },
  );

  return data.data ?? [];
}

/**
 * The window Graph expects by default for each level.
 *
 * Page and Instagram account metrics are time series; post, video and media
 * metrics are running totals with no period at all, which Graph spells
 * `lifetime`.
 */
export function defaultPeriodFor(level: MetricLevel): MetricPeriod {
  return level === 'page' || level === 'ig_account' ? 'day' : 'lifetime';
}

/** Which edge a level's insights live on. */
function edgeFor(level: MetricLevel): string {
  return level === 'video' ? 'video_insights' : 'insights';
}

/**
 * Fetch a chunk, and if Graph refuses it, split and retry until the bad names
 * are isolated.
 *
 * Only *invalid-request* failures are worth bisecting. An auth error or a rate
 * limit applies to every name equally, so those propagate instead — retrying
 * halves of a throttled request just spends more of the budget.
 */
async function fetchWithBisect(
  objectId: string,
  names: string[],
  options: FetchOptions,
  results: RawInsight[],
  unavailable: UnavailableMetric[],
): Promise<void> {
  if (names.length === 0) return;

  try {
    results.push(...(await fetchChunk(objectId, names, options)));
    return;
  } catch (error) {
    const graphError = asGraphError(error);

    if (graphError.kind === 'auth' || graphError.kind === 'rate_limit') throw graphError;

    if (names.length <= BISECT_FLOOR) {
      unavailable.push({
        name: names[0]!,
        reason: graphError.displayMessage,
        code: graphError.code,
      });
      return;
    }

    const middle = Math.floor(names.length / 2);
    await fetchWithBisect(objectId, names.slice(0, middle), options, results, unavailable);
    await fetchWithBisect(objectId, names.slice(middle), options, results, unavailable);
  }
}

/** Split a list into fixed-size chunks. Exported for testing. */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Read insights for one object, asking for everything in the catalogue that
 * supports the requested period.
 */
export async function fetchInsights(options: {
  objectId: string;
  level: MetricLevel;
  accessToken: string;
  period?: MetricPeriod;
  since?: Date;
  until?: Date;
  /** Restrict to these metric names instead of the whole catalogue. */
  only?: string[];
  /** Extra query parameters, e.g. Instagram's `metric_type` or `breakdown`. */
  extraParams?: Record<string, string | number | undefined>;
}): Promise<InsightsResult> {
  const period = options.period ?? defaultPeriodFor(options.level);

  const candidates = (options.only
    ? options.only
        .map((name) => findMetric(name, options.level))
        .filter((metric): metric is MetricDefinition => Boolean(metric))
    : metricsFor(options.level)
  ).filter((metric) => metric.periods.includes(period));

  const results: RawInsight[] = [];
  const unavailable: UnavailableMetric[] = [];

  for (const names of chunk(candidates.map((metric) => metric.name), CHUNK_SIZE)) {
    await fetchWithBisect(
      options.objectId,
      names,
      {
        accessToken: options.accessToken,
        period,
        since: options.since,
        until: options.until,
        edge: edgeFor(options.level),
        extraParams: options.extraParams,
      },
      results,
      unavailable,
    );
  }

  const series = results.map(toSeries);
  const returned = new Set(series.map((entry) => entry.name));

  return {
    series: series.sort((a, b) => a.name.localeCompare(b.name)),
    unavailable,
    // Asked for, not refused, but nothing came back — usually a Page with no
    // activity in the window, not a broken metric.
    empty: candidates
      .map((metric) => metric.name)
      .filter(
        (name) =>
          !returned.has(name) && !unavailable.some((entry) => entry.name === name),
      ),
  };
}

export interface PageProfile {
  id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  fanCount: number | null;
  followersCount: number | null;
  talkingAboutCount: number | null;
  wereHereCount: number | null;
  ratingCount: number | null;
  overallStarRating: number | null;
  link: string | null;
  verificationStatus: string | null;
  isPublished: boolean | null;
}

/**
 * Read the Page object itself.
 *
 * Worth having separately from insights: these fields need no `read_insights`
 * permission and no date range, so they still work when the insights edge is
 * restricted or empty.
 */
export async function fetchPageProfile(
  pageId: string,
  accessToken: string,
): Promise<PageProfile> {
  const { data } = await graphRequest<Record<string, unknown>>(pageId, {
    accessToken,
    params: { fields: PAGE_PROFILE_FIELDS.join(',') },
  });

  const number = (key: string): number | null =>
    typeof data[key] === 'number' ? (data[key] as number) : null;
  const text = (key: string): string | null =>
    typeof data[key] === 'string' ? (data[key] as string) : null;

  return {
    id: String(data.id ?? pageId),
    name: text('name'),
    username: text('username'),
    category: text('category'),
    fanCount: number('fan_count'),
    followersCount: number('followers_count'),
    talkingAboutCount: number('talking_about_count'),
    wereHereCount: number('were_here_count'),
    ratingCount: number('rating_count'),
    overallStarRating: number('overall_star_rating'),
    link: text('link'),
    verificationStatus: text('verification_status'),
    isPublished: typeof data.is_published === 'boolean' ? data.is_published : null,
  };
}

export interface PostEngagement {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  permalink: string | null;
  createdTime: string | null;
  type: string | null;
}

/** Engagement counters that live on the post object rather than /insights. */
export async function fetchPostEngagement(
  postId: string,
  accessToken: string,
): Promise<PostEngagement> {
  const { data } = await graphRequest<{
    reactions?: { summary?: { total_count?: number } };
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
    permalink_url?: string;
    created_time?: string;
    status_type?: string;
  }>(postId, {
    accessToken,
    params: {
      fields:
        'reactions.summary(total_count).limit(0),comments.summary(true).limit(0),shares,permalink_url,created_time,status_type',
    },
  });

  return {
    // Every kind of reaction; `likes` counted only the thumbs-up.
    reactions: data.reactions?.summary?.total_count ?? data.likes?.summary?.total_count ?? null,
    comments: data.comments?.summary?.total_count ?? null,
    // Absent `shares` means zero, not unknown — Graph omits the field at 0.
    shares: data.shares?.count ?? 0,
    permalink: data.permalink_url ?? null,
    createdTime: data.created_time ?? null,
    type: data.status_type ?? null,
  };
}

export interface MetricAvailability {
  name: string;
  level: MetricLevel;
  category: string;
  description: string;
  period: MetricPeriod;
  available: boolean;
  reason: string | null;
}

/**
 * Ask Graph which catalogue metrics it will actually serve for this object.
 *
 * Run against a real Page, this answers a question no amount of reading the
 * docs will: what this app, on this pinned Graph version, with the permissions
 * it was granted, can genuinely retrieve today.
 */
export async function probeMetrics(options: {
  objectId: string;
  level: MetricLevel;
  accessToken: string;
  period?: MetricPeriod;
}): Promise<MetricAvailability[]> {
  const period = options.period ?? defaultPeriodFor(options.level);
  const definitions = metricsFor(options.level).filter((metric) =>
    metric.periods.includes(period),
  );

  const result = await fetchInsights({
    objectId: options.objectId,
    level: options.level,
    accessToken: options.accessToken,
    period,
  });

  const refused = new Map(result.unavailable.map((entry) => [entry.name, entry.reason]));
  const returned = new Set(result.series.map((entry) => entry.name));

  return definitions.map((metric) => ({
    name: metric.name,
    level: metric.level,
    category: metric.category,
    description: metric.description,
    period,
    available: returned.has(metric.name),
    reason: refused.get(metric.name) ?? (returned.has(metric.name) ? null : 'No data returned.'),
  }));
}

/** Turn a breakdown map into a sorted, capped list for display. */
export function topBreakdown(
  value: number | Record<string, number> | null,
  limit = 10,
): Array<{ key: string; value: number }> {
  if (!value || typeof value === 'number') return [];
  return Object.entries(value)
    .map(([key, count]) => ({ key, value: count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export { GraphError };
