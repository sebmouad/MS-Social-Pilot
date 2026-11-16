import { prisma } from '@/server/data';
import { AUTOPILOT_LOG_MAX, LEARN_EVERY_DAYS, LEARN_VERSION, autopilotOf, hourStats, learnTimes, relativeByHour, postScore, type AutopilotLogEntry, type AutopilotSettings, type Observation } from '../wordpress/autopilot';
import { channelConfig, type ChannelSettings } from '../wordpress/recipe';
import { configOf } from './wordpress-planner';
import type { SourceRow } from './wordpress-store';
import type { WordpressSettings } from './wordpress-settings';

/** What the autopilot reads and writes outside the planner; replaced in tests. */
export type AutopilotPorts = {
  /** Published posts of these channels since `from`, with their stored results. */
  observations(channelIds: readonly string[], from: Date): Promise<Array<{ targetId: string; at: Date; insights: unknown }>>;
  saveConfig(source: SourceRow, config: Record<string, unknown>): Promise<void>;
  /** Planned recipe slots since `from` whose post failed to publish. */
  failedPublications(sourceId: string, from: Date): Promise<Array<{ id: string; targetId: string; slotAt: Date; wpPostId: string; title: string; skipped: string[] }>>;
  /** Upcoming slots left uncertain by an interrupted run (claim expired, no post saved). */
  stranded?(sourceId: string, from: Date): Promise<Array<{ id: string; workspaceId: string; targetId: string; slotAt: Date; claimedAt: Date; title: string; permalink: string | null }>>;
  /** A post created for that slot around its claim: the recipe's link in the first comment or its title on the picture. */
  createdFor?(slot: { workspaceId: string; targetId: string; claimedAt: Date; title: string; permalink: string | null }): Promise<string | null>;
  settleStranded?(workspaceId: string, id: string, outcome: { postId: string } | { released: true }): Promise<boolean>;
};

export const prismaAutopilotPorts: AutopilotPorts = {
  async observations(channelIds, from) {
    if (!channelIds.length) return [];
    return prisma.$queryRaw<Array<{ targetId: string; at: Date; insights: unknown }>>`SELECT "targetId", "createdTime" AS at, insights FROM external_posts
      WHERE "targetId" = ANY(${[...channelIds]}::text[]) AND "createdTime" >= ${from} AND insights IS NOT NULL`;
  },
  async saveConfig(source, config) {
    await prisma.$executeRaw`UPDATE wordpress_recipe_sources SET config = ${JSON.stringify(config)}::jsonb, "updatedAt" = NOW() WHERE id = ${source.id} AND "workspaceId" = ${source.workspaceId}`;
  },
  async stranded(sourceId, from) {
    return prisma.$queryRaw<Array<{ id: string; workspaceId: string; targetId: string; slotAt: Date; claimedAt: Date; title: string; permalink: string | null }>>`SELECT id, "workspaceId", "targetId", "slotAt", "claimedAt", title, permalink FROM wordpress_recipe_plans
      WHERE "sourceId" = ${sourceId} AND state = 'uncertain' AND reason = 'claim_expired' AND "postId" IS NULL AND "slotAt" > ${from}`;
  },
  async createdFor(slot) {
    // Posts on that channel created from just before the claim until an hour after it (a run never lasts longer).
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p JOIN post_targets pt ON pt."postId" = p.id
      WHERE p."workspaceId" = ${slot.workspaceId} AND pt."targetId" = ${slot.targetId}
        AND p."createdAt" >= ${new Date(slot.claimedAt.getTime() - 60_000)} AND p."createdAt" <= ${new Date(slot.claimedAt.getTime() + 3_600_000)}
        AND ((${slot.permalink}::text IS NOT NULL AND strpos(COALESCE(p."firstComment", ''), ${slot.permalink ?? ''}) > 0) OR p.media::text LIKE ${`%${slot.title.slice(0, 100).replace(/[%_\\]/g, '')}%`})
      ORDER BY p."createdAt" ASC LIMIT 1`;
    return rows[0]?.id ?? null;
  },
  async settleStranded(workspaceId, id, outcome) {
    const changed = 'postId' in outcome
      ? await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET state = 'planned', "postId" = ${outcome.postId}, reason = 'reconciled', "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${workspaceId} AND state = 'uncertain' AND "postId" IS NULL`
      : await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET state = 'failed', reason = 'not_created', "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${workspaceId} AND state = 'uncertain' AND "postId" IS NULL`;
    return changed === 1;
  },
  async failedPublications(sourceId, from) {
    const rows = await prisma.$queryRaw<Array<{ id: string; targetId: string; slotAt: Date; wpPostId: string; title: string | null; skipped: unknown }>>`SELECT l.id, l."targetId", l."slotAt", l."wpPostId", l.title, l.skipped
      FROM wordpress_recipe_plans l JOIN post_targets pt ON pt."postId" = l."postId" AND pt."targetId" = l."targetId"
      WHERE l."sourceId" = ${sourceId} AND l.state = 'planned' AND l."slotAt" >= ${from} AND pt.status::text = 'failed'`;
    return rows.map(row => ({ ...row, title: row.title ?? '', skipped: Array.isArray(row.skipped) ? row.skipped.filter((id): id is string => typeof id === 'string') : [] }));
  },
};

/** Add entries to the source's activity log, newest first, keeping the most recent ones. */
export function withLog(autopilot: AutopilotSettings, entries: readonly AutopilotLogEntry[]): AutopilotSettings {
  return { ...autopilot, log: [...entries, ...(autopilot.log ?? [])].slice(0, AUTOPILOT_LOG_MAX) };
}

const rawConfig = (source: SourceRow): Record<string, unknown> => (source.config && typeof source.config === 'object' ? { ...(source.config as Record<string, unknown>) } : {});

/**
 * Best times (2026-11-16): at most once every LEARN_EVERY_DAYS, move each channel's times to its strongest hours of
 * the last `learnDays` days. Channels a member gave their own times, and paused channels, are left alone. Planned
 * posts keep their times; the planner never doubles a day (see planSource). Returns the channels changed.
 */
export async function learnBestTimes(settings: WordpressSettings, source: SourceRow, pages: ReadonlyArray<{ id: string; name: string }>, now: Date, ports: AutopilotPorts = prismaAutopilotPorts): Promise<number> {
  const config = configOf(settings, source);
  const autopilot = autopilotOf(config.autopilot);
  const best = autopilot.bestTimes;
  if (!best.enabled || best.apply !== 'auto' || !pages.length) return 0;
  if (autopilot.lastLearnedAt && autopilot.learnVersion === LEARN_VERSION && now.getTime() - Date.parse(autopilot.lastLearnedAt) < LEARN_EVERY_DAYS * 86_400_000) return 0;
  const rows = await ports.observations(pages.map(page => page.id), new Date(now.getTime() - best.learnDays * 86_400_000));
  const channels: Record<string, ChannelSettings> = { ...(config.channels ?? {}) };
  const learnedTimes: Record<string, string[]> = { ...(autopilot.learnedTimes ?? {}) };
  const entries: AutopilotLogEntry[] = [];
  const scored = (targetId: string): Observation[] => rows.filter(row => row.targetId === targetId).flatMap(row => { const score = postScore(row.insights); return score === null ? [] : [{ at: new Date(row.at), score }]; });
  // What every channel saw at each hour, each relative to its own usual: evidence for hours a channel never tried.
  const pooled = new Map<number, number[]>();
  for (const page of pages) for (const [hour, values] of relativeByHour(scored(page.id), config.timezone)) pooled.set(hour, [...(pooled.get(hour) ?? []), ...values]);
  const hourValues: Record<string, Record<string, number>> = {};
  for (const [index, page] of pages.entries()) {
    hourValues[page.id] = Object.fromEntries(hourStats(scored(page.id), config.timezone, best.window, pooled).map(stat => [String(stat.hour), Number.isFinite(stat.value) ? Math.min(1000, Math.round(stat.value * 100) / 100) : 1]));
    const own = channels[page.id];
    if (own?.paused || (own?.slots?.length && !own.autoTimes) || config.channelSlots?.[page.id]?.length) continue;
    const current = channelConfig(config, page.id).slots;
    const learned = learnTimes({ observations: scored(page.id), current, timeZone: config.timezone, window: best.window, gapMinutes: best.gapMinutes, channelIndex: index, pooled });
    if (JSON.stringify(learned) === JSON.stringify(current)) continue;
    learnedTimes[page.id] = learned;
    // Times learned earlier were kept on the channel itself; they move to the autopilot's own record.
    if (own?.autoTimes) { const { slots: _slots, autoTimes: _auto, ...rest } = own; channels[page.id] = rest; }
    entries.push({ at: now.toISOString(), kind: 'times', channelId: page.id, channelName: page.name.slice(0, 200), from: current, to: learned });
  }
  const next = rawConfig(source);
  next.channels = channels;
  next.autopilot = { ...withLog(autopilot, entries), hourValues, learnedTimes, lastLearnedAt: now.toISOString(), learnVersion: LEARN_VERSION };
  await ports.saveConfig(source, next);
  source.config = next as SourceRow['config'];
  return entries.length;
}

/** Record activity on the source (healing, supply) without changing anything else. */
export async function logAutopilot(settings: WordpressSettings, source: SourceRow, entries: readonly AutopilotLogEntry[], ports: AutopilotPorts = prismaAutopilotPorts, handled: readonly string[] = []): Promise<void> {
  if (!entries.length && !handled.length) return;
  const next = rawConfig(source);
  const current = autopilotOf(configOf(settings, source).autopilot);
  next.autopilot = { ...withLog(current, entries), ...(handled.length ? { radarHandled: [...handled, ...(current.radarHandled ?? [])].slice(0, 300) } : {}) };
  await ports.saveConfig(source, next);
  source.config = next as SourceRow['config'];
}

/**
 * Self-healing for interrupted runs (2026-11-16): an upcoming slot left uncertain with no saved post is settled with proof.
 * A post created for it around the claim (the recipe's link in its first comment, or its title on the picture) settles it
 * as planned; when none exists the slot is released and planned again. Never a blind resend.
 */
export async function healStranded(sourceId: string, now: Date, ports: AutopilotPorts = prismaAutopilotPorts): Promise<{ reconciled: number; released: number; titles: string[] }> {
  const out = { reconciled: 0, released: 0, titles: [] as string[] };
  if (!ports.stranded || !ports.createdFor || !ports.settleStranded) return out;
  for (const slot of await ports.stranded(sourceId, now)) {
    // Only claims older than an hour: a run still in progress is never second-guessed.
    if (now.getTime() - slot.claimedAt.getTime() < 3_600_000) continue;
    const postId = await ports.createdFor(slot);
    if (postId) { if (await ports.settleStranded(slot.workspaceId, slot.id, { postId })) out.reconciled++; }
    else if (await ports.settleStranded(slot.workspaceId, slot.id, { released: true })) { out.released++; out.titles.push(slot.title); }
  }
  return out;
}
