import type { WpDb } from '../wordpress/db';
import { ledgerView, scanCandidates, configOf, type PlannerPorts } from './wordpress-planner';
import type { SourceRow } from './wordpress-store';
import type { WordpressSettings } from './wordpress-settings';

const MS_DAY = 86_400_000;

export type PoolPage = { targetId: string; targetName: string; eligible: number; daysLeft: number | null; low: boolean };
export type PoolHealth = {
  asOf: string; scanned: number; candidates: number;
  /** False when the scan limit was reached first: the counts are then lower bounds. */
  complete: boolean; slotsPerDay: number; warnDays: number; low: boolean; pages: PoolPage[];
};

/**
 * Recipes still available to each channel and how many days they last at the current posting times.
 * A recipe is eligible for a channel when it has no planned or recent post there (inside the repost cooldown) and, when
 * channels must differ, is not already planned for another channel. Recipes that return after the cooldown are not counted.
 * With different recipes on every channel, all channels draw from one pool, so the days left divide by the channel count.
 */
export async function computePoolHealth(input: { settings: WordpressSettings; ports: PlannerPorts; db: WpDb; source: SourceRow; now: Date }): Promise<PoolHealth> {
  const { settings, ports, db, source, now } = input;
  const config = configOf(settings, source);
  const pages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
  const windowStart = new Date(now.getTime() - config.cooldownDays * MS_DAY);
  const view = ledgerView(await ports.store.ledgerSince(source.id, windowStart.getTime() < now.getTime() ? windowStart : now), now);
  const scan = await scanCandidates(db, settings, source, config, now, () => false);
  const slotsPerDay = config.slots.length;
  const consumers = config.distinctAcrossPages ? Math.max(1, pages.length) : 1;
  const rows: PoolPage[] = pages.map(page => {
    const blocked = view.blocked.get(page.id);
    const eligible = scan.candidates.filter(c => !blocked?.has(c.wpPostId) && !(config.distinctAcrossPages && view.taken.has(c.wpPostId))).length;
    const daysLeft = config.cooldownDays === 0 || !slotsPerDay ? null : Math.floor(eligible / (slotsPerDay * consumers));
    return { targetId: page.id, targetName: page.name, eligible, daysLeft, low: daysLeft !== null && daysLeft < settings.poolWarnDays };
  });
  return { asOf: now.toISOString(), scanned: scan.scanned, candidates: scan.candidates.length, complete: scan.exhausted, slotsPerDay, warnDays: settings.poolWarnDays, low: rows.some(r => r.low), pages: rows };
}

const cache = new Map<string, { at: number; health: PoolHealth }>();
/** Reuse a recent result for `ttlSeconds` (the library is scanned in full otherwise). A failure is never cached. */
export async function cachedPoolHealth(key: string, ttlSeconds: number, now: Date, compute: () => Promise<PoolHealth>): Promise<PoolHealth> {
  const hit = cache.get(key);
  if (hit && ttlSeconds > 0 && now.getTime() - hit.at < ttlSeconds * 1000) return hit.health;
  const health = await compute();
  cache.set(key, { at: now.getTime(), health });
  return health;
}
export const forgetPoolHealth = (key: string) => { cache.delete(key); };
