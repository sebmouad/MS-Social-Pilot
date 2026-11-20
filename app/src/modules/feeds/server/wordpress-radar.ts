import { prisma } from '@/server/data';
import type { AutopilotLogEntry, AutopilotSettings } from '../wordpress/autopilot';
import type { FeedActor } from './access';

/**
 * Viral radar and « let a hot post breathe » (2026-11-16, docs/autopilot-plan.md). A recipe post that reaches `factor`
 * times its channel's usual audience within two hours is hot: the channel's next post waits (up to `maxDelayMinutes`),
 * and the recipe goes to the channels with the biggest usual audience in their weakest upcoming slot, each with its own
 * post (2026-11-20: « most similar » meant closest usual reach, so a hit on a mid-size Page only ever went to near-empty
 * Pages and never to « Recettes - Faciles », where most of the reach is).
 */
export type RecentPost = { planId: string; targetId: string; wpPostId: string; title: string; postId: string; publishedAt: Date };
export type UpcomingSlot = { planId: string; targetId: string; wpPostId: string; slotAt: Date; score: number | null };

export type RadarPorts = {
  /** Recipe posts of the source published since `from`. */
  recent(sourceId: string, from: Date): Promise<RecentPost[]>;
  /** Read the post's latest numbers from the platform, then its people reached (null when unknown). */
  reach(workspaceId: string, postId: string, targetId: string): Promise<number | null>;
  /** Posts published between `from` and `until` with their stored reach (no platform call), for late hits; optional. */
  storedHits?(sourceId: string, from: Date, until: Date): Promise<Array<RecentPost & { reach: number }>>;
  /** Usual people reached per channel (median of its posts since `from`). */
  medians(targetIds: readonly string[], from: Date): Promise<Map<string, number>>;
  /** The channel's next scheduled post within the window, and the one after it. */
  nextPosts(workspaceId: string, targetId: string, from: Date, until: Date): Promise<Array<{ postId: string; scheduledAt: Date }>>;
  reschedule(actor: FeedActor, postId: string, at: Date): Promise<void>;
  /** Planned, upcoming recipe slots of the source. */
  upcoming(sourceId: string, from: Date, until: Date): Promise<UpcomingSlot[]>;
  /** Put this recipe in that slot (its post is replaced); false when the slot could not be changed. */
  choose(planId: string, wpPostId: string): Promise<boolean>;
};

/** What a usual post of the channel has reached at this age: a quarter at once, all of it after three hours. */
export const expectedAt = (median: number, ageMinutes: number) => median * Math.min(1, 0.25 + 0.25 * Math.max(0, ageMinutes) / 60);
/** People a post must reach before it can count as hot, whatever the channel (2026-11-16: 110 people was called viral). */
export const MIN_HOT_REACH = 200;
/** A post past its first two hours is a late hit at 10× its channel's usual and at least this many people. */
export const LATE_HIT_REACH = 20_000;
export const isLateHit = (reach: number, median: number) => median > 0 && reach >= Math.max(LATE_HIT_REACH, 10 * median);
/**
 * Hot: `factor` times what a usual post has at this age, at least the channel's usual full reach, and at least
 * MIN_HOT_REACH people. Young posts get credit for having had little time; small numbers never trigger anything.
 */
export function isHot(input: { reach: number; median: number; ageMinutes: number; factor: number }): boolean {
  if (!(input.median > 0) || !(input.reach > 0)) return false;
  return input.reach >= Math.max(MIN_HOT_REACH, input.median, input.factor * expectedAt(input.median, input.ageMinutes));
}

/** Channels a hit should go to: the biggest usual audience first, never the hot one itself, and (given the hit's reach) only channels whose usual reach is at most half of it. */
export function biggestAudiences(hot: string, medians: ReadonlyMap<string, number>, count: number, reach = Infinity): string[] {
  return [...medians.keys()].filter(id => id !== hot && (medians.get(id) ?? 0) * 2 <= reach).sort((a, b) => (medians.get(b) ?? 0) - (medians.get(a) ?? 0) || a.localeCompare(b)).slice(0, count);
}

/** Next post's new time: `delay` later on Facebook's 5-minute marks, at least 30 minutes before the post after it. */
export function breatheTime(next: Date, following: Date | null, delayMinutes: number): Date | null {
  let at = next.getTime() + delayMinutes * 60_000;
  if (following) at = Math.min(at, following.getTime() - 30 * 60_000);
  at = Math.floor(at / 300_000) * 300_000;
  return at > next.getTime() ? new Date(at) : null;
}

/** Least time between two channels receiving the same hit. */
export const SPREAD_GAP_MS = 3 * 3_600_000;

export type RadarOutcome = { entries: AutopilotLogEntry[]; handled: string[] };

export async function runRadar(input: { timeZone?: string; pilot: AutopilotSettings; sourceId: string; workspaceId: string; actor: FeedActor; now: Date; handled: ReadonlySet<string>; names: ReadonlyMap<string, string>; blocked: (targetId: string, wpPostId: string) => boolean }, ports: RadarPorts): Promise<RadarOutcome> {
  const { pilot, now } = input;
  const out: RadarOutcome = { entries: [], handled: [] };
  if (!pilot.radar.enabled && !pilot.breathe.enabled) return out;
  const recent = (await ports.recent(input.sourceId, new Date(now.getTime() - 2 * 3_600_000))).filter(post => !input.handled.has(post.planId));
  const medians = await ports.medians([...input.names.keys()], new Date(now.getTime() - 30 * 86_400_000));
  const name = (id: string) => input.names.get(id) ?? '';
  /** Spread a hit to the channels with the biggest audience, once (shared by fresh and late hits, 2026-11-20). */
  const spreadHit = async (post: RecentPost, reach: number) => {
    const slots = await ports.upcoming(input.sourceId, new Date(now.getTime() + 3 * 3_600_000), new Date(now.getTime() + 72 * 3_600_000));
    const spread: string[] = []; let already = 0, noSlot = 0, refused = 0;
    const chosenTimes: number[] = [];
    // A hit only goes where it is big news (2026-11-20: a 324-reach post, then 23,000-reach ones, replaced planned recipes
    // on a Page whose usual post reaches 21,000): a channel whose usual reach is at most half the hit's own reach.
    for (const target of biggestAudiences(post.targetId, medians, pilot.radar.pages * 2, reach)) {
      if (spread.length >= pilot.radar.pages) break;
      if (input.blocked(target, post.wpPostId) || slots.some(slot => slot.targetId === target && slot.wpPostId === post.wpPostId)) { already++; continue; }
      // The channel's weakest upcoming slot gives way; slots are spread over the days ahead, one per channel.
      // Spread over the days ahead (2026-11-16): never within three hours of another channel getting this hit, so Pages
      // do not post the same recipe at the same minute (the first live spread put five Pages at 11:00).
      const apart = (slot: UpcomingSlot) => chosenTimes.every(at => Math.abs(at - slot.slotAt.getTime()) >= SPREAD_GAP_MS);
      const mine = slots.filter(s => s.targetId === target).sort((a, b) => (a.score ?? 50) - (b.score ?? 50) || a.slotAt.getTime() - b.slotAt.getTime());
      const slot = mine.find(apart);
      if (!slot) { noSlot++; continue; }
      if (await ports.choose(slot.planId, post.wpPostId).catch(() => false)) { spread.push(name(target) || target); chosenTimes.push(slot.slotAt.getTime()); } else refused++;
    }
    // Every outcome is said, so a radar that did nothing is never a mystery (2026-11-16).
    const why = [already ? `${already} already had this recipe` : '', noSlot ? `${noSlot} had no free time in the next three days` : '', refused ? `${refused} could not be changed` : ''].filter(Boolean).join(', ');
    out.entries.push({ at: now.toISOString(), kind: 'radar', channelId: post.targetId, channelName: name(post.targetId), text: spread.length ? `Planned on ${spread.length} channels with the biggest audience: ${spread.join(', ')}.${why ? ` Others: ${why}.` : ''}` : `Not spread to other channels: ${why || 'no similar channel'}.`,
      code: spread.length ? 'spread' : 'notSpread', params: { count: spread.length, channels: spread.join(', ').slice(0, 400), already, noSlot, refused } });
  };
  for (const post of recent) {
    const reach = await ports.reach(input.workspaceId, post.postId, post.targetId).catch(() => null);
    const median = medians.get(post.targetId);
    if (reach === null || median === undefined) continue;
    const ageMinutes = (now.getTime() - post.publishedAt.getTime()) / 60_000;
    const factor = Math.min(pilot.radar.enabled ? pilot.radar.factor : Infinity, pilot.breathe.enabled ? pilot.breathe.factor : Infinity);
    if (!isHot({ reach, median, ageMinutes, factor })) continue;
    out.handled.push(post.planId);
    const times = Math.round(reach / expectedAt(median, ageMinutes) * 10) / 10;
    const hours = Math.max(1, Math.round(ageMinutes / 60));
    out.entries.push({ at: now.toISOString(), kind: 'radar', channelId: post.targetId, channelName: name(post.targetId), text: `« ${post.title.slice(0, 120)} » is taking off: ${reach} people reached in ${hours} h, ${times}× what a post usually has by then.`, code: 'hot', params: { title: post.title.slice(0, 120), reach, hours, times } });
    if (pilot.breathe.enabled && isHot({ reach, median, ageMinutes, factor: pilot.breathe.factor })) {
      const [next, following] = await ports.nextPosts(input.workspaceId, post.targetId, now, new Date(now.getTime() + pilot.breathe.maxDelayMinutes * 60_000 + 3 * 3_600_000));
      if (next && next.scheduledAt.getTime() - now.getTime() <= pilot.breathe.maxDelayMinutes * 60_000) {
        const at = breatheTime(next.scheduledAt, following?.scheduledAt ?? null, pilot.breathe.maxDelayMinutes);
        if (at) {
          try { await ports.reschedule(input.actor, next.postId, at); out.entries.push({ at: now.toISOString(), kind: 'radar', channelId: post.targetId, channelName: name(post.targetId), text: `The next post waits until ${at.toISOString().slice(11, 16)} UTC so this one keeps its reach.`, code: 'breathe', params: { time: new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: input.timeZone ?? 'Europe/Paris' }).format(at) } }); }
          catch { /* a post that cannot move keeps its time */ }
        }
      }
    }
    if (pilot.radar.enabled && pilot.radar.mode === 'auto' && isHot({ reach, median, ageMinutes, factor: pilot.radar.factor })) await spreadHit(post, reach);
  }
  // Late hits (2026-11-20): a post that grew over a day or two (« Pains aux raisins » 631k, « Mini-quiches » 408k) was past
  // the two-hour window and never spread. Posts from the last 10 days whose stored reach is far above their channel's usual
  // are spread once too; only fresh posts are read live and only they delay the next post.
  if (pilot.radar.enabled && pilot.radar.mode === 'auto' && ports.storedHits) {
    const late = (await ports.storedHits(input.sourceId, new Date(now.getTime() - 10 * 86_400_000), new Date(now.getTime() - 2 * 3_600_000)).catch(() => []))
      // Its own mark: a post handled while fresh (often spread only to small Pages, or not at all) can still be spread once late.
      .filter(post => !input.handled.has(`late:${post.planId}`));
    for (const post of late) {
      const median = medians.get(post.targetId);
      if (median === undefined || !isLateHit(post.reach, median)) continue;
      out.handled.push(`late:${post.planId}`);
      out.entries.push({ at: now.toISOString(), kind: 'radar', channelId: post.targetId, channelName: name(post.targetId), text: `« ${post.title.slice(0, 120)} » became a hit: ${post.reach} people reached, ${Math.round(post.reach / median * 10) / 10}× usual.`, code: 'hotShort', params: { title: post.title.slice(0, 120), reach: post.reach, times: Math.round(post.reach / median * 10) / 10 } });
      await spreadHit(post, post.reach);
    }
  }
  return out;
}

export function prismaRadarPorts(choose: RadarPorts['choose']): RadarPorts {
  return {
    async recent(sourceId, from) {
      return prisma.$queryRaw<RecentPost[]>`SELECT l.id AS "planId", l."targetId", l."wpPostId", l.title, l."postId", pt."publishedAt" FROM wordpress_recipe_plans l
        JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId"
        WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND pt.status::text = 'published' AND pt."publishedAt" >= ${from}`;
    },
    async reach(workspaceId, postId, targetId) {
      const { syncPostMetrics } = await import('@/modules/publishing/server/sync-post-metrics');
      const results = await syncPostMetrics(workspaceId, postId);
      const mine = results.find(result => result.targetId === targetId);
      return mine ? mine.reach || mine.views || null : null;
    },
    async storedHits(sourceId, from, until) {
      const rows = await prisma.$queryRaw<Array<RecentPost & { reach: number | null }>>`SELECT l.id AS "planId", l."targetId", l."wpPostId", l.title, l."postId", pt."publishedAt",
          COALESCE((ep.insights->>'post_total_media_view_unique')::numeric, (ep.insights->>'reach')::numeric)::int AS reach
        FROM wordpress_recipe_plans l
        JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId" AND pt.status::text = 'published'
        JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
        WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${until}
          AND COALESCE(ep.insights->>'post_total_media_view_unique', ep.insights->>'reach') ~ '^[0-9.]+$'
        ORDER BY 7 DESC LIMIT 20`;
      return rows.flatMap(row => row.reach ? [{ ...row, reach: Number(row.reach) }] : []);
    },
    async medians(targetIds, from) {
      if (!targetIds.length) return new Map();
      const rows = await prisma.$queryRaw<Array<{ targetId: string; median: number | null }>>`SELECT "targetId", percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE((insights->>'post_total_media_view_unique')::numeric, (insights->>'reach')::numeric)) AS median
        FROM external_posts WHERE "targetId" = ANY(${[...targetIds]}::text[]) AND "createdTime" >= ${from} AND insights IS NOT NULL
          AND COALESCE(insights->>'post_total_media_view_unique', insights->>'reach') ~ '^[0-9.]+$' GROUP BY "targetId"`;
      return new Map(rows.filter(row => Number(row.median) > 0).map(row => [row.targetId, Number(row.median)]));
    },
    async nextPosts(workspaceId, targetId, from, until) {
      return prisma.$queryRaw<Array<{ postId: string; scheduledAt: Date }>>`SELECT p.id AS "postId", p."scheduledAt" FROM posts p JOIN post_targets pt ON pt."postId" = p.id
        WHERE p."workspaceId" = ${workspaceId} AND pt."targetId" = ${targetId} AND p.status::text = 'scheduled' AND p."scheduledAt" > ${from} AND p."scheduledAt" <= ${until}
        ORDER BY p."scheduledAt" ASC LIMIT 2`;
    },
    async reschedule(actor, postId, at) {
      const { reschedulePostToInstant } = await import('@/modules/publishing/server/lifecycle');
      await reschedulePostToInstant(actor, postId, at);
    },
    async upcoming(sourceId, from, until) {
      return prisma.$queryRaw<UpcomingSlot[]>`SELECT id AS "planId", "targetId", "wpPostId", "slotAt", score FROM wordpress_recipe_plans
        WHERE "sourceId" = ${sourceId} AND state = 'planned' AND "postId" IS NOT NULL AND "slotAt" > ${from} AND "slotAt" <= ${until}`;
    },
    choose,
  };
}
