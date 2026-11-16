import { prisma } from '@/server/data';
import { AUTOPILOT_LOG_MAX, LEARN_EVERY_DAYS, autopilotOf, learnTimes, postScore, type AutopilotLogEntry, type AutopilotSettings, type Observation } from '../wordpress/autopilot';
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
  if (autopilot.lastLearnedAt && now.getTime() - Date.parse(autopilot.lastLearnedAt) < LEARN_EVERY_DAYS * 86_400_000) return 0;
  const rows = await ports.observations(pages.map(page => page.id), new Date(now.getTime() - best.learnDays * 86_400_000));
  const channels: Record<string, ChannelSettings> = { ...(config.channels ?? {}) };
  const entries: AutopilotLogEntry[] = [];
  for (const [index, page] of pages.entries()) {
    const own = channels[page.id];
    if (own?.paused || (own?.slots?.length && !own.autoTimes) || config.channelSlots?.[page.id]?.length) continue;
    const current = channelConfig(config, page.id).slots;
    const observations: Observation[] = rows.filter(row => row.targetId === page.id).flatMap(row => { const score = postScore(row.insights); return score === null ? [] : [{ at: new Date(row.at), score }]; });
    const learned = learnTimes({ observations, current, timeZone: config.timezone, window: best.window, gapMinutes: best.gapMinutes, channelIndex: index });
    if (JSON.stringify(learned) === JSON.stringify(current)) continue;
    channels[page.id] = { ...own, slots: learned, autoTimes: true };
    entries.push({ at: now.toISOString(), kind: 'times', channelId: page.id, channelName: page.name.slice(0, 200), from: current, to: learned });
  }
  const next = rawConfig(source);
  next.channels = channels;
  next.autopilot = { ...withLog(autopilot, entries), lastLearnedAt: now.toISOString() };
  await ports.saveConfig(source, next);
  source.config = next as SourceRow['config'];
  return entries.length;
}

/** Record activity on the source (healing, supply) without changing anything else. */
export async function logAutopilot(settings: WordpressSettings, source: SourceRow, entries: readonly AutopilotLogEntry[], ports: AutopilotPorts = prismaAutopilotPorts): Promise<void> {
  if (!entries.length) return;
  const next = rawConfig(source);
  next.autopilot = withLog(autopilotOf(configOf(settings, source).autopilot), entries);
  await ports.saveConfig(source, next);
  source.config = next as SourceRow['config'];
}
