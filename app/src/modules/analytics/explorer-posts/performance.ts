import { z } from 'zod';
import { prisma } from '@/server/data';
import { analyticsError, localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import type { Actor } from '../server/access';
import { readPosts, type PostRow } from './service';

/**
 * What works on these channels, from stored post measures only: reach and engagement per posting hour, weekday,
 * channel, origin (made in this app or elsewhere) and caption style, plus the best and weakest posts. Built for an
 * agent (or a person) to decide what to change, then to compare the period after the change with the one before.
 * Reach is each post's first stored audience measure; engagement is the channel's own ranking measure.
 */
const REACH_KEYS = ['reach', 'post_total_media_view_unique', 'impressions', 'post_media_view', 'views'] as const;
const MIN_GROUP_POSTS = 5;
const EXAMPLES = 5;

export type PostFacts = {
  postId: string; channelId: string; channelName: string; text: string; publishedAt: Date; url: string | null;
  reach: number | null; engagement: number | null; madeHere: boolean;
  /** The connected profile (social account) the channel was added through. */
  profile?: string;
};
export type GroupRow = { key: string; posts: number; medianReach: number | null; engagementPer100: number | null; lowSample: boolean };
export type Totals = { posts: number; measured: number; medianReach: number | null; totalReach: number; engagementPer100: number | null };
export type Digest = {
  totals: Totals;
  groups: Record<'hour' | 'weekday' | 'channel' | 'profile' | 'origin' | 'opening' | 'question' | 'length', GroupRow[]>;
  best: PostSummary[]; weakest: PostSummary[];
};
export type PostSummary = { postId: string; channel: string; publishedAt: string; url: string | null; reach: number | null; engagement: number | null; madeHere: boolean; text: string };

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const per100 = (posts: PostFacts[]) => {
  const both = posts.filter(p => p.reach !== null && p.engagement !== null);
  const reach = both.reduce((sum, p) => sum + p.reach!, 0);
  return reach > 0 ? Math.round(10000 * both.reduce((sum, p) => sum + p.engagement!, 0) / reach) / 100 : null;
};
export const totalsOf = (posts: PostFacts[]): Totals => {
  const reaches = posts.flatMap(p => p.reach === null ? [] : [p.reach]);
  return { posts: posts.length, measured: reaches.length, medianReach: median(reaches), totalReach: reaches.reduce((a, b) => a + b, 0), engagementPer100: per100(posts) };
};

/** How a caption opens, whether it asks something, and its length: neutral features any network shares. */
export function captionStyle(text: string) {
  const trimmed = text.trim();
  return {
    opening: !trimmed ? 'no text' : /^\p{Extended_Pictographic}/u.test(trimmed) ? 'emoji' : 'words',
    question: !trimmed ? 'no text' : /\?/.test(trimmed) ? 'asks a question' : 'no question',
    length: !trimmed ? 'no text' : trimmed.length < 150 ? 'under 150' : trimmed.length < 300 ? '150-299' : trimmed.length < 600 ? '300-599' : '600+',
  };
}

export function digest(posts: PostFacts[], timeZone: string): Digest {
  const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  const dayOf = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' });
  const group = (key: (p: PostFacts) => string, order: 'key' | 'reach' = 'reach'): GroupRow[] => {
    const by = new Map<string, PostFacts[]>();
    for (const post of posts) { const k = key(post); by.set(k, [...(by.get(k) ?? []), post]); }
    const rows = [...by].map(([k, items]) => {
      const t = totalsOf(items);
      return { key: k, posts: items.length, medianReach: t.medianReach, engagementPer100: t.engagementPer100, lowSample: items.length < MIN_GROUP_POSTS };
    });
    return order === 'key' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => (b.medianReach ?? -1) - (a.medianReach ?? -1));
  };
  const summary = (p: PostFacts): PostSummary => ({ postId: p.postId, channel: p.channelName, publishedAt: p.publishedAt.toISOString(), url: p.url, reach: p.reach, engagement: p.engagement, madeHere: p.madeHere, text: p.text.slice(0, 280) });
  const ranked = posts.filter(p => p.reach !== null).sort((a, b) => b.reach! - a.reach! || (b.engagement ?? 0) - (a.engagement ?? 0));
  return {
    totals: totalsOf(posts),
    groups: {
      hour: group(p => hourOf.format(p.publishedAt).padStart(2, '0') + ':00', 'key'),
      weekday: group(p => dayOf.format(p.publishedAt)),
      channel: group(p => p.channelName),
      profile: group(p => p.profile ?? 'unknown profile'),
      origin: group(p => p.madeHere ? 'made in this app' : 'published elsewhere'),
      opening: group(p => captionStyle(p.text).opening),
      question: group(p => captionStyle(p.text).question),
      length: group(p => captionStyle(p.text).length),
    },
    best: ranked.slice(0, EXAMPLES).map(summary),
    weakest: ranked.slice(-EXAMPLES).reverse().map(summary),
  };
}

const firstValue = (row: PostRow, keys: readonly string[]) => {
  for (const key of keys) { const value = row.measures.find(m => m.key === key)?.value; if (typeof value === 'number') return value; }
  return null;
};

/** Every stored post of the period (bounded by the report row limit), as facts. */
export async function postFacts(actor: Actor, range: { start?: string; end?: string; filter?: '1'; channel?: string[] }): Promise<{ facts: PostFacts[]; complete: boolean; period: { start: string; end: string } }> {
  const data = await readPosts(actor, { ...range, page: 1 }, undefined, true);
  const ids = data.items.map(row => row.postId);
  const own = ids.length ? await prisma.post.findMany({ where: { workspaceId: actor.workspaceId, id: { in: ids } }, select: { id: true } }) : [];
  const madeHere = new Set(own.map(row => row.id));
  const channelIds = [...new Set(data.items.map(row => row.channelId))];
  const owners = channelIds.length ? await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, id: { in: channelIds } }, select: { id: true, socialAccount: { select: { name: true } } } }) : [];
  const profileOf = new Map(owners.map(row => [row.id, row.socialAccount?.name ?? 'unknown profile']));
  const facts = data.items.flatMap(row => row.publishedAt ? [{
    postId: row.postId, channelId: row.channelId, channelName: row.channelName, text: row.text ?? '', publishedAt: row.publishedAt, url: row.url,
    reach: firstValue(row, REACH_KEYS), engagement: row.rankValue, madeHere: madeHere.has(row.postId), profile: profileOf.get(row.channelId),
  }] : []);
  return { facts, complete: data.nextPage === null, period: { start: data.period.start, end: data.period.end } };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const performanceInputSchema = z.object({
  start: day.optional(), end: day.optional(), compareStart: day.optional(), compareEnd: day.optional(),
  filter: z.literal('1').optional(), channel: z.array(z.string().min(1).max(200)).max(500).optional(),
}).strict().refine(v => (v.compareStart === undefined) === (v.compareEnd === undefined), 'compareStart and compareEnd go together.');

/** The digest of one period, and with compareStart/compareEnd the totals of an earlier one to measure a change. */
export async function readContentPerformance(actor: Actor, raw: unknown) {
  try {
    const parsed = performanceInputSchema.safeParse(raw ?? {});
    if (!parsed.success) throw await analyticsError('invalid_request', "Choose valid post filters.");
    const { compareStart, compareEnd, ...range } = parsed.data;
    const workspace = await prisma.workspace.findUnique({ where: { id: actor.workspaceId }, select: { timezone: true } });
    const timeZone = workspace?.timezone || 'UTC';
    const current = await postFacts(actor, range);
    const before = compareStart && compareEnd ? await postFacts(actor, { ...range, start: compareStart, end: compareEnd }) : null;
    return {
      period: current.period, timeZone, complete: current.complete,
      note: 'Medians resist one viral post; groups marked lowSample have fewer than 5 posts. Reach is each post\'s first stored audience measure; engagement is the channel\'s ranking measure (for Facebook: reactions, comments and shares).',
      ...digest(current.facts, timeZone),
      ...(before ? { comparison: { period: before.period, complete: before.complete, totals: totalsOf(before.facts) } } : {}),
    };
  } catch (error) { throw await localizeAnalyticsError(error); }
}

const LEARN_DAYS = 30;
const LEARN_TTL_MS = 3_600_000;
const learned = new Map<string, { at: number; captions: string[] }>();
/**
 * The captions that worked best on the workspace's channels lately: among posts reaching at least the median,
 * the highest engagement per person reached. AI writing follows their style, so content keeps adapting to what
 * the audience answers. Cached an hour per workspace; empty when nothing is measured or analytics is unavailable.
 */
export async function bestCaptions(actor: Actor, limit = 3, now = new Date()): Promise<string[]> {
  const hit = learned.get(actor.workspaceId);
  if (hit && now.getTime() - hit.at < LEARN_TTL_MS) return hit.captions.slice(0, limit);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  let captions: string[] = [];
  try {
    const { facts } = await postFacts(actor, { start: iso(new Date(now.getTime() - LEARN_DAYS * 86_400_000)), end: iso(now) });
    const usable = facts.filter(p => p.text.trim() && p.reach !== null && p.reach > 0 && p.engagement !== null);
    const mid = median(usable.map(p => p.reach!)) ?? 0;
    captions = usable.filter(p => p.reach! >= mid).sort((a, b) => b.engagement! / b.reach! - a.engagement! / a.reach! || b.reach! - a.reach!)
      .map(p => p.text.trim().slice(0, 400)).filter((text, index, all) => all.indexOf(text) === index).slice(0, 5);
  } catch { captions = []; }
  learned.set(actor.workspaceId, { at: now.getTime(), captions });
  return captions.slice(0, limit);
}
