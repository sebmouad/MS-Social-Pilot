import type { Actor, KeyDate, Locale } from '../contracts';
import { listCalendarEntries } from './service';
import { keyDateOn } from './seasons';
import { settings } from './settings';

export type Milestone = { id: string; title: string };

/**
 * Key dates for the days on the Publishing calendar board, from the same scoped service as the Dates screen, REST and MCP.
 * Follows every page up to the Root row limit and refuses a larger set (returns {}) rather than marking some days only.
 * Any denial or failure leaves the board without milestones.
 */
export async function loadBoardMilestones(actor: Actor & { locale: Locale }, days: readonly string[], targetId?: string): Promise<Record<string, Milestone[]>> {
 if (!days.length) return {};
 try {
  const { policy } = await settings(actor.locale);
  const dates: KeyDate[] = [];
  for (let offset = 0; offset <= policy.maxRows; offset += policy.pageSize) {
   const page = await listCalendarEntries(actor, 'dates', { from: days[0], to: days[days.length - 1], offset, ...(targetId ? { targetId } : {}) });
   if (!('items' in page)) return {};
   dates.push(...(page.items as KeyDate[]));
   if (!page.hasMore) {
    const out: Record<string, Milestone[]> = {};
    for (const day of days) { const hits = dates.filter(d => keyDateOn(d, day)); if (hits.length) out[day] = hits.map(d => ({ id: d.id, title: d.title })); }
    return out;
   }
  }
  return {};
 } catch { return {}; }
}
