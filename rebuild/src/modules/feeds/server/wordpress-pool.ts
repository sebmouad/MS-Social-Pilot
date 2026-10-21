import type { WpDb } from '../wordpress/db';
import { supplyLedgerView, scanCandidates, configOf, type PlannerPorts } from './wordpress-planner';
import type { SourceRow } from './wordpress-store';
import type { WordpressSettings } from './wordpress-settings';

export type PoolPage = { targetId: string; targetName: string; eligible: number; daysLeft: number | null; low: boolean };
export type PoolHealth = {
  asOf: string; scanned: number; candidates: number;
  reuse: { enabled: boolean; cooldownDays: number };
  /** False when the scan limit was reached first: the counts are then lower bounds and low is unconfirmed. */
  complete: boolean; slotsPerDay: number; warnDays: number; low: boolean; pages: PoolPage[];
};

/**
 * Recipes still available to each channel and how many days they last at the current posting times.
 * With reuse off, retained history blocks recipes permanently. With reuse on, only confirmed publications beyond the
 * effective cooldown are eligible again. Distinct channels consume the same historical pool. Future returns are not counted.
 * With different recipes on every channel, all channels draw from one pool, so the days left divide by the channel count.
 */
export async function computePoolHealth(input: { settings: WordpressSettings; ports: PlannerPorts; db: WpDb; source: SourceRow; now: Date }): Promise<PoolHealth> {
  const { settings, ports, db, source, now } = input;
  const config = configOf(settings, source);
  const pages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
  const view = await supplyLedgerView(settings, ports, source, now);
  const scan = await scanCandidates(db, settings, source, config, now, () => false);
  const slotsPerDay = config.slots.length;
  const consumers = config.distinctAcrossPages ? Math.max(1, pages.length) : 1;
  const rows: PoolPage[] = pages.map(page => {
    const blocked = view.blocked.get(page.id);
    const eligible = scan.candidates.filter(c => !blocked?.has(c.wpPostId) && (scan.exhausted || !view.reused.get(page.id)?.has(c.wpPostId)) && !(config.distinctAcrossPages && view.taken.has(c.wpPostId))).length;
    const daysLeft = !slotsPerDay ? null : Math.floor(eligible / (slotsPerDay * consumers));
    return { targetId: page.id, targetName: page.name, eligible, daysLeft, low: scan.exhausted && daysLeft !== null && daysLeft < settings.poolWarnDays };
  });
  return { asOf: now.toISOString(), scanned: scan.scanned, candidates: scan.candidates.length, complete: scan.exhausted, slotsPerDay, warnDays: settings.poolWarnDays, reuse: { enabled: settings.reuse.enabled, cooldownDays: Math.max(settings.reuse.cooldownDays, config.cooldownDays) }, low: rows.some(r => r.low), pages: rows };
}

const cache = new Map<string, { at: number; health: PoolHealth }>();
/** Reuse a recent result for `ttlSeconds` (the library is scanned in full otherwise). A failure is never cached. */
export async function cachedPoolHealth(key: string, ttlSeconds: number, now: Date, compute: () => Promise<PoolHealth>): Promise<PoolHealth> {
  for (const [cachedKey, entry] of cache) if (now.getTime() - entry.at >= ttlSeconds * 1000) cache.delete(cachedKey);
  const hit = cache.get(key);
  if (hit && ttlSeconds > 0 && now.getTime() - hit.at < ttlSeconds * 1000) return hit.health;
  const health = await compute();
  if (ttlSeconds > 0) cache.set(key, { at: now.getTime(), health });
  return health;
}
export const forgetPoolHealth = (key: string) => {
  for (const cachedKey of cache.keys()) if (cachedKey === key || cachedKey.startsWith(`${key}|`)) cache.delete(cachedKey);
};
