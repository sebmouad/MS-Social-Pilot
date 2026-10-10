import type { FeedLinkPreview, FeedMedia } from '@/components/FeedPost';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Page analysis: what the numbers say, as opposed to what the numbers are.
 *
 * Every other analytics view shows figures and leaves the reading to whoever
 * is looking. This one reads them: how this period compares with the last, how
 * regularly the Page posts, which formats and which hours work for *this*
 * audience, which posts stood out, and — from those — a short list of findings
 * a person can act on.
 *
 * Pure: posts and Page totals in, analysis out. The database half lives in
 * `page-analysis-data.ts`, so every rule here can be tested with a handful of
 * literal posts rather than a seeded Page.
 *
 * Two principles run through it.
 *
 * **Interactions, not "engaged users".** Reactions, comments and shares come
 * off the post object itself, need no insights permission and have survived
 * every Graph version. `post_engaged_users` was withdrawn by Meta, so a rate
 * built on it reads zero on any recent Page. Reach is used as the denominator
 * where it exists, and a post without it simply has no rate.
 *
 * **Compare the Page with itself.** There is no industry benchmark in here to
 * be wrong about. "Video does 2.1× your average" is a fact about this Page;
 * "video does well on Facebook" is a claim nobody here can check.
 */

export type PostFormat = 'photo' | 'video' | 'link' | 'text' | 'other';

export const POST_FORMATS: PostFormat[] = ['photo', 'video', 'link', 'text', 'other'];

export interface AnalysedPost {
  id: string;
  /** Published through this app, or found on the Page. */
  source: 'app' | 'page';
  message: string;
  url: string | null;
  /** The picture the feed shows with it, when there is one. */
  imageUrl?: string | null;
  /** What it carries, as the feed card draws it. */
  media?: FeedMedia[];
  linkPreview?: FeedLinkPreview | null;
  publishedAt: Date;
  format: PostFormat;
  reach: number | null;
  impressions: number | null;
  reactions: number;
  comments: number;
  shares: number;
  clicks: number | null;
  /** Reactions + comments + shares. */
  interactions: number;
  /** Interactions per hundred people reached, or null without reach. */
  rate: number | null;
}

/** Figures for the Page itself, summed over a window. Null where not served. */
export interface PageTotals {
  reach: number | null;
  engagements: number | null;
  profileViews: number | null;
  follows: number | null;
  unfollows: number | null;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Graph's `status_type`, reduced to what a person would call the post. */
export function formatOfStatusType(statusType: string | null | undefined): PostFormat {
  switch (statusType) {
    case 'added_photos':
      return 'photo';
    case 'added_video':
      return 'video';
    case 'shared_story':
      return 'link';
    case 'mobile_status_update':
    case 'wall_post':
      return 'text';
    default:
      return 'other';
  }
}

/** A post written here: what it carries decides what it is. */
export function formatOfAppPost(media: Array<{ kind: string }>, link: string | null): PostFormat {
  if (media.some((item) => item.kind === 'video')) return 'video';
  if (media.some((item) => item.kind === 'image')) return 'photo';
  if (link) return 'link';
  return 'text';
}

/** Interactions per hundred people reached, to one decimal. */
export function rateOf(interactions: number, reach: number | null): number | null {
  if (reach === null || reach <= 0) return null;
  return Math.round((interactions / reach) * 1000) / 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Percentage change, whole number. Null when there is nothing to compare
 * against: "up from zero" is not a percentage.
 */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

const clamp = (value: number, low = 0, high = 100) => Math.min(high, Math.max(low, value));

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

export interface PostSummary {
  posts: number;
  interactions: number;
  avgInteractions: number | null;
  medianRate: number | null;
  /** Summed over the posts that report it. */
  reach: number | null;
}

export function summarise(posts: AnalysedPost[]): PostSummary {
  const interactions = posts.reduce((sum, post) => sum + post.interactions, 0);
  const reaches = posts.map((post) => post.reach).filter((value): value is number => value !== null);
  const rates = posts.map((post) => post.rate).filter((value): value is number => value !== null);

  return {
    posts: posts.length,
    interactions,
    avgInteractions: posts.length > 0 ? Math.round(interactions / posts.length) : null,
    medianRate: rates.length > 0 ? Math.round(median(rates)! * 10) / 10 : null,
    reach: reaches.length > 0 ? reaches.reduce((sum, value) => sum + value, 0) : null,
  };
}

export type KpiKey =
  | 'posts'
  | 'interactions'
  | 'avgInteractions'
  | 'medianRate'
  | 'reach'
  | 'netFollows';

export interface Kpi {
  key: KpiKey;
  current: number | null;
  previous: number | null;
  change: number | null;
}

export function netFollows(totals: PageTotals): number | null {
  if (totals.follows === null && totals.unfollows === null) return null;
  return (totals.follows ?? 0) - (totals.unfollows ?? 0);
}

/**
 * This period against the one before it, of the same length.
 *
 * Reach prefers the Page's own figure, which counts each person once across
 * every post, and falls back to the sum over posts when the Page-level metric
 * is not served — so it is never both, and never compared across the two.
 */
export function compareKpis(input: {
  current: PostSummary;
  previous: PostSummary;
  currentTotals: PageTotals;
  previousTotals: PageTotals;
}): Kpi[] {
  const pageReach = input.currentTotals.reach !== null;
  const reachNow = pageReach ? input.currentTotals.reach : input.current.reach;
  const reachBefore = pageReach ? input.previousTotals.reach : input.previous.reach;

  const net = netFollows(input.currentTotals);
  const netBefore = netFollows(input.previousTotals);

  const kpi = (key: KpiKey, current: number | null, previous: number | null): Kpi => ({
    key,
    current,
    previous,
    change: change(current, previous),
  });

  return [
    kpi('posts', input.current.posts, input.previous.posts),
    kpi('interactions', input.current.interactions, input.previous.interactions),
    kpi('avgInteractions', input.current.avgInteractions, input.previous.avgInteractions),
    kpi('medianRate', input.current.medianRate, input.previous.medianRate),
    kpi('reach', reachNow, reachBefore),
    kpi('netFollows', net, netBefore),
  ];
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export interface CadenceWeek {
  /** Monday of the week, as a local date: yyyy-MM-dd. */
  week: string;
  posts: number;
}

export interface Cadence {
  weeks: CadenceWeek[];
  perWeek: number;
  /** Weeks in the window with no post at all. */
  quietWeeks: number;
  /** The longest stretch without a post, counting up to the window's edges. */
  longestGapDays: number;
  /** When the longest gap ends. */
  gapEndsAt: Date | null;
  /** Whole days since the most recent post in the window; null with none. */
  daysSinceLast: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** yyyy-MM-dd of the Monday of the local week `date` falls in. */
function mondayOf(date: Date, timeZone: string): string {
  const local = formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
  const isoWeekday = Number(formatInTimeZone(date, timeZone, 'i')); // 1 = Monday
  const midnight = Date.parse(`${local}T00:00:00Z`);
  return new Date(midnight - (isoWeekday - 1) * DAY_MS).toISOString().slice(0, 10);
}

export function cadence(posts: AnalysedPost[], from: Date, to: Date, timeZone: string): Cadence {
  const counts = new Map<string, number>();

  // Every week the window touches, so a week with nothing in it is a zero on
  // the chart rather than a missing bar nobody notices.
  const first = mondayOf(from, timeZone);
  const last = mondayOf(to, timeZone);
  for (let week = Date.parse(`${first}T00:00:00Z`); week <= Date.parse(`${last}T00:00:00Z`); week += 7 * DAY_MS) {
    counts.set(new Date(week).toISOString().slice(0, 10), 0);
  }
  for (const post of posts) {
    const week = mondayOf(post.publishedAt, timeZone);
    if (counts.has(week)) counts.set(week, counts.get(week)! + 1);
  }

  const times = posts
    .map((post) => post.publishedAt.getTime())
    .filter((time) => time >= from.getTime() && time <= to.getTime())
    .sort((a, b) => a - b);
  const edges = [from.getTime(), ...times, to.getTime()];

  let longest = 0;
  let gapEnd: number | null = null;
  for (let index = 1; index < edges.length; index += 1) {
    const gap = edges[index]! - edges[index - 1]!;
    if (gap > longest) {
      longest = gap;
      gapEnd = edges[index]!;
    }
  }

  const weeks = [...counts.entries()].map(([week, count]) => ({ week, posts: count }));
  const days = Math.max(1, (to.getTime() - from.getTime()) / DAY_MS);

  return {
    weeks,
    perWeek: Math.round((times.length / days) * 7 * 10) / 10,
    quietWeeks: weeks.filter((week) => week.posts === 0).length,
    longestGapDays: Math.floor(longest / DAY_MS),
    gapEndsAt: gapEnd === null ? null : new Date(gapEnd),
    daysSinceLast:
      times.length > 0 ? Math.floor((to.getTime() - times[times.length - 1]!) / DAY_MS) : null,
  };
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export interface FormatRow {
  format: PostFormat;
  posts: number;
  /** Share of all posts, as a percentage. */
  share: number;
  avgInteractions: number;
  medianRate: number | null;
  avgReach: number | null;
  /** Average interactions against the Page's overall average: 1 is par. */
  lift: number | null;
}

export function formatBreakdown(posts: AnalysedPost[]): FormatRow[] {
  const overall = mean(posts.map((post) => post.interactions));

  return POST_FORMATS.map((format) => {
    const group = posts.filter((post) => post.format === format);
    if (group.length === 0) return null;

    const avg = mean(group.map((post) => post.interactions))!;
    const rates = group.map((post) => post.rate).filter((value): value is number => value !== null);
    const reaches = group.map((post) => post.reach).filter((value): value is number => value !== null);

    return {
      format,
      posts: group.length,
      share: Math.round((group.length / posts.length) * 100),
      avgInteractions: Math.round(avg),
      medianRate: rates.length > 0 ? Math.round(median(rates)! * 10) / 10 : null,
      avgReach: reaches.length > 0 ? Math.round(mean(reaches)!) : null,
      lift: overall && overall > 0 ? Math.round((avg / overall) * 10) / 10 : null,
    };
  })
    .filter((row): row is FormatRow => row !== null)
    .sort((a, b) => b.avgInteractions - a.avgInteractions);
}

// ---------------------------------------------------------------------------
// When to post
// ---------------------------------------------------------------------------

/** Hours per heatmap column. Three: eight blocks a day, readable on a phone. */
export const BLOCK_HOURS = 3;
export const BLOCKS_PER_DAY = 24 / BLOCK_HOURS;

export interface HashtagRow {
  /** Lower-cased, with its #: "#sourdough". */
  tag: string;
  posts: number;
  avgInteractions: number;
  avgReach: number | null;
  /** Average interactions against the Page's overall average: 1 is par. */
  lift: number | null;
}

/** Hashtags as Facebook links them: letters, digits and underscores after a #. */
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/**
 * How the posts carrying each hashtag did, against the Page's typical post.
 *
 * Only hashtags used on at least `minPosts` posts are ranked: one post with a
 * lucky tag says nothing about the tag. Case is folded, so #Paris and #paris
 * are one hashtag, as they are on Facebook.
 */
export function hashtagBreakdown(posts: AnalysedPost[], minPosts = 2): HashtagRow[] {
  const overall = mean(posts.map((post) => post.interactions));
  const byTag = new Map<string, AnalysedPost[]>();
  for (const post of posts) {
    const tags = new Set((post.message.match(HASHTAG) ?? []).map((tag) => tag.toLowerCase()));
    for (const tag of tags) byTag.set(tag, [...(byTag.get(tag) ?? []), post]);
  }

  return [...byTag.entries()]
    .filter(([, tagged]) => tagged.length >= minPosts)
    .map(([tag, tagged]) => {
      const avgInteractions = mean(tagged.map((post) => post.interactions)) ?? 0;
      const reaches = tagged.map((post) => post.reach).filter((reach): reach is number => reach !== null);
      return {
        tag,
        posts: tagged.length,
        avgInteractions,
        avgReach: mean(reaches),
        lift: overall ? avgInteractions / overall : null,
      };
    })
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0) || b.posts - a.posts);
}

export type CaptionTrait = 'short' | 'medium' | 'long' | 'question' | 'emoji' | 'hashtags' | 'link';

export interface CaptionRow {
  trait: CaptionTrait;
  posts: number;
  /** Share of all posts, as a percentage. */
  share: number;
  avgInteractions: number;
  lift: number | null;
}

/** Any pictographic character: what people mean by "an emoji". */
const EMOJI = /\p{Extended_Pictographic}/u;
const URL_IN_TEXT = /https?:\/\/\S+/i;
/** Not global: `test` on a global pattern carries its position between calls. */
const HAS_HASHTAG = /#[\p{L}\p{N}_]+/u;

/**
 * Which kinds of caption do best here: by length, and whether it asks a
 * question, uses emoji, carries hashtags or a link.
 *
 * Length is measured without links and hashtags, which inflate it without
 * being anything a reader reads. A trait on fewer than two posts is left out.
 */
export function captionBreakdown(posts: AnalysedPost[]): CaptionRow[] {
  const overall = mean(posts.map((post) => post.interactions));
  const traitsOf = (post: AnalysedPost): CaptionTrait[] => {
    const text = post.message.replace(new RegExp(URL_IN_TEXT, 'gi'), '').replace(HASHTAG, '').trim();
    const traits: CaptionTrait[] = [text.length < 80 ? 'short' : text.length <= 250 ? 'medium' : 'long'];
    if (text.includes('?')) traits.push('question');
    if (EMOJI.test(post.message)) traits.push('emoji');
    if (HAS_HASHTAG.test(post.message)) traits.push('hashtags');
    if (post.format === 'link' || URL_IN_TEXT.test(post.message)) traits.push('link');
    return traits;
  };

  const groups = new Map<CaptionTrait, AnalysedPost[]>();
  for (const post of posts) {
    for (const trait of traitsOf(post)) groups.set(trait, [...(groups.get(trait) ?? []), post]);
  }

  const order: CaptionTrait[] = ['short', 'medium', 'long', 'question', 'emoji', 'hashtags', 'link'];
  return order
    .filter((trait) => (groups.get(trait)?.length ?? 0) >= 2)
    .map((trait) => {
      const group = groups.get(trait)!;
      const avgInteractions = mean(group.map((post) => post.interactions)) ?? 0;
      return {
        trait,
        posts: group.length,
        share: posts.length ? Math.round((group.length / posts.length) * 100) : 0,
        avgInteractions,
        lift: overall ? avgInteractions / overall : null,
      };
    });
}

export interface TimeCell {
  /** 0 = Sunday, matching `QueueSlot.dayOfWeek`. */
  weekday: number;
  /** First hour of the block, local time. */
  hour: number;
  posts: number;
  avgInteractions: number | null;
  /** Average interactions against the Page's median post: 1 is par. */
  lift: number | null;
}

export interface BestTimes {
  cells: TimeCell[];
  /** The strongest blocks with enough posts behind them, best first. */
  best: TimeCell[];
  /** How many posts the grid is built from. */
  sample: number;
}

/** Posts a block needs before it can be called a good time rather than a lucky one. */
export const MIN_POSTS_PER_SLOT = 2;

export function bestTimes(posts: AnalysedPost[], timeZone: string): BestTimes {
  const baseline = median(posts.map((post) => post.interactions));
  const buckets = new Map<string, number[]>();

  for (const post of posts) {
    const weekday = Number(formatInTimeZone(post.publishedAt, timeZone, 'i')) % 7;
    const hour = Number(formatInTimeZone(post.publishedAt, timeZone, 'H'));
    const key = `${weekday}:${Math.floor(hour / BLOCK_HOURS) * BLOCK_HOURS}`;
    buckets.set(key, [...(buckets.get(key) ?? []), post.interactions]);
  }

  const cells: TimeCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let block = 0; block < BLOCKS_PER_DAY; block += 1) {
      const hour = block * BLOCK_HOURS;
      const values = buckets.get(`${weekday}:${hour}`) ?? [];
      const avg = mean(values);
      cells.push({
        weekday,
        hour,
        posts: values.length,
        avgInteractions: avg === null ? null : Math.round(avg),
        lift: avg !== null && baseline && baseline > 0 ? Math.round((avg / baseline) * 10) / 10 : null,
      });
    }
  }

  const best = cells
    .filter((cell) => cell.posts >= MIN_POSTS_PER_SLOT && cell.lift !== null && cell.lift > 1)
    .sort((a, b) => b.lift! - a.lift! || b.posts - a.posts)
    .slice(0, 3);

  return { cells, best, sample: posts.length };
}

// ---------------------------------------------------------------------------
// Health score
// ---------------------------------------------------------------------------

export type HealthComponentKey = 'consistency' | 'momentum' | 'growth' | 'reach';

export interface HealthComponent {
  key: HealthComponentKey;
  /** 0–100. */
  score: number;
  weight: number;
}

export interface Health {
  /** 0–100, or null when there is not enough to judge anything. */
  score: number | null;
  band: 'strong' | 'steady' | 'attention' | null;
  components: HealthComponent[];
}

/** Posts a week the consistency score treats as full marks. */
export const TARGET_POSTS_PER_WEEK = 3;

/**
 * One number for "how is this Page doing", from four things that can each be
 * explained in a sentence — never a black box.
 *
 * - **Consistency**: posting at the target rate, with quiet weeks costing.
 * - **Momentum**: interactions per post against the previous period.
 * - **Growth**: net follows as a share of the audience.
 * - **Reach**: people reached against the previous period.
 *
 * A component with no data is left out and the rest re-weighted, rather than
 * scored zero: a Page whose follower figures Meta stopped serving is not doing
 * badly at growth, it is unmeasured.
 */
export function healthScore(input: {
  cadence: Cadence;
  kpis: Kpi[];
  followers: number | null;
}): Health {
  const byKey = new Map(input.kpis.map((kpi) => [kpi.key, kpi]));
  const components: HealthComponent[] = [];

  const weeks = input.cadence.weeks.length;
  if (weeks > 0) {
    const rate = Math.min(1, input.cadence.perWeek / TARGET_POSTS_PER_WEEK);
    const quiet = input.cadence.quietWeeks / weeks;
    components.push({ key: 'consistency', score: Math.round(clamp(100 * rate * (1 - quiet * 0.5))), weight: 30 });
  }

  const momentum = byKey.get('avgInteractions')?.change;
  if (momentum !== null && momentum !== undefined) {
    // Level is 50; doubling is 100; halving is 25.
    components.push({ key: 'momentum', score: Math.round(clamp(50 + momentum / 2)), weight: 30 });
  }

  const net = byKey.get('netFollows')?.current;
  if (net !== null && net !== undefined && input.followers && input.followers > 0) {
    // Holding steady is 50; growing 2% of the audience in the window is 100.
    const growth = (net / input.followers) * 100;
    components.push({ key: 'growth', score: Math.round(clamp(50 + growth * 25)), weight: 20 });
  }

  const reach = byKey.get('reach')?.change;
  if (reach !== null && reach !== undefined) {
    components.push({ key: 'reach', score: Math.round(clamp(50 + reach / 2)), weight: 20 });
  }

  if (components.length === 0) return { score: null, band: null, components };

  const weight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = Math.round(
    components.reduce((sum, component) => sum + component.score * component.weight, 0) / weight,
  );

  return {
    score,
    band: score >= 70 ? 'strong' : score >= 45 ? 'steady' : 'attention',
    components,
  };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type FindingTone = 'good' | 'warning' | 'info';

export interface Finding {
  tone: FindingTone;
  /** Key under `pageAnalysis.findings`. */
  key: string;
  params: Record<string, string | number>;
}

/** Posts a format needs before it is compared with anything. */
export const MIN_POSTS_PER_FORMAT = 3;

/**
 * The few things worth saying, most useful first.
 *
 * Each rule states a fact about this Page and the evidence for it. None of them
 * fires on a sample too small to mean anything — two posts at 18:00 that did
 * well are not a best time — and a Page with nothing to say gets no findings
 * rather than filler.
 */
export function findings(input: {
  kpis: Kpi[];
  cadence: Cadence;
  formats: FormatRow[];
  times: BestTimes;
  top: AnalysedPost[];
  medianInteractions: number | null;
  lastSyncedAt: Date | null;
  now: Date;
}): Finding[] {
  const out: Finding[] = [];
  const byKey = new Map(input.kpis.map((kpi) => [kpi.key, kpi]));

  const since = input.cadence.daysSinceLast;
  if ((byKey.get('posts')?.current ?? 0) === 0) {
    out.push({ tone: 'warning', key: 'noPosts', params: {} });
  } else if (since !== null && since >= 7) {
    // Quiet *now* matters more than quiet once: it is the one still costing reach.
    out.push({ tone: 'warning', key: 'goneQuiet', params: { days: since } });
  } else if (input.cadence.longestGapDays >= 10) {
    out.push({ tone: 'warning', key: 'longGap', params: { days: input.cadence.longestGapDays } });
  }

  const momentum = byKey.get('avgInteractions')?.change;
  if (momentum !== null && momentum !== undefined && Math.abs(momentum) >= 10) {
    out.push({
      tone: momentum > 0 ? 'good' : 'warning',
      key: momentum > 0 ? 'interactionsUp' : 'interactionsDown',
      params: { percent: Math.abs(momentum) },
    });
  }

  const reach = byKey.get('reach')?.change;
  if (reach !== null && reach !== undefined && Math.abs(reach) >= 10) {
    out.push({
      tone: reach > 0 ? 'good' : 'warning',
      key: reach > 0 ? 'reachUp' : 'reachDown',
      params: { percent: Math.abs(reach) },
    });
  }

  const comparable = input.formats.filter((row) => row.posts >= MIN_POSTS_PER_FORMAT);
  if (comparable.length >= 2) {
    const best = comparable[0]!;
    const worst = comparable[comparable.length - 1]!;
    if (worst.avgInteractions > 0 && best.avgInteractions / worst.avgInteractions >= 1.5) {
      out.push({
        tone: 'info',
        key: 'bestFormat',
        params: {
          best: best.format,
          worst: worst.format,
          ratio: Math.round((best.avgInteractions / worst.avgInteractions) * 10) / 10,
        },
      });
    }
    // The format posted most is not the one that works: worth saying plainly.
    const mostPosted = [...comparable].sort((a, b) => b.posts - a.posts)[0]!;
    if (mostPosted.format !== best.format && mostPosted.lift !== null && mostPosted.lift < 1) {
      out.push({
        tone: 'info',
        key: 'mostPostedUnderperforms',
        params: { format: mostPosted.format, share: mostPosted.share, best: best.format },
      });
    }
  }

  const slot = input.times.best[0];
  if (slot && slot.lift !== null && slot.lift >= 1.3) {
    out.push({
      tone: 'info',
      key: 'bestTime',
      params: { weekday: slot.weekday, hour: slot.hour, lift: slot.lift, posts: slot.posts },
    });
  }

  const standout = input.top[0];
  if (standout && input.medianInteractions && input.medianInteractions > 0) {
    const ratio = standout.interactions / input.medianInteractions;
    if (ratio >= 3) {
      out.push({ tone: 'good', key: 'standoutPost', params: { ratio: Math.round(ratio * 10) / 10 } });
    }
  }

  const net = byKey.get('netFollows')?.current;
  if (net !== null && net !== undefined && net < 0) {
    out.push({ tone: 'warning', key: 'losingFollowers', params: { count: Math.abs(net) } });
  }

  if (input.lastSyncedAt) {
    const age = Math.floor((input.now.getTime() - input.lastSyncedAt.getTime()) / DAY_MS);
    if (age >= 2) out.push({ tone: 'info', key: 'stale', params: { days: age } });
  } else {
    out.push({ tone: 'info', key: 'neverSynced', params: {} });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface PageAnalysis {
  kpis: Kpi[];
  health: Health;
  cadence: Cadence;
  formats: FormatRow[];
  hashtags: HashtagRow[];
  captions: CaptionRow[];
  times: BestTimes;
  top: AnalysedPost[];
  bottom: AnalysedPost[];
  findings: Finding[];
  /** The posts behind it all, for the export and the drill-down. */
  sample: { current: number; previous: number; timing: number };
}

export function analyse(input: {
  current: AnalysedPost[];
  previous: AnalysedPost[];
  /** A longer history for the time-of-day grid, which needs more posts. */
  timing: AnalysedPost[];
  currentTotals: PageTotals;
  previousTotals: PageTotals;
  followers: number | null;
  from: Date;
  to: Date;
  timeZone: string;
  lastSyncedAt: Date | null;
  now: Date;
}): PageAnalysis {
  const current = summarise(input.current);
  const kpis = compareKpis({
    current,
    previous: summarise(input.previous),
    currentTotals: input.currentTotals,
    previousTotals: input.previousTotals,
  });

  const rhythm = cadence(input.current, input.from, input.to, input.timeZone);
  const formats = formatBreakdown(input.current);
  const times = bestTimes(input.timing, input.timeZone);

  const ranked = [...input.current].sort(
    (a, b) => b.interactions - a.interactions || b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
  const top = ranked.slice(0, 5);
  // The weakest, but never the same posts as the strongest on a small Page.
  const bottom = ranked.length > 8 ? ranked.slice(-3).reverse() : [];

  return {
    kpis,
    health: healthScore({ cadence: rhythm, kpis, followers: input.followers }),
    cadence: rhythm,
    formats,
    hashtags: hashtagBreakdown(input.current),
    captions: captionBreakdown(input.current),
    times,
    top,
    bottom,
    findings: findings({
      kpis,
      cadence: rhythm,
      formats,
      times,
      top,
      medianInteractions: median(input.current.map((post) => post.interactions)),
      lastSyncedAt: input.lastSyncedAt,
      now: input.now,
    }),
    sample: { current: input.current.length, previous: input.previous.length, timing: input.timing.length },
  };
}
