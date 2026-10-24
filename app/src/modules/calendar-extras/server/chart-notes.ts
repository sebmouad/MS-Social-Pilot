import type { Actor, Locale, Note } from '../contracts';
import type { Copy } from '../copy';
import { listCalendarEntries } from './service';
import { settings } from './settings';

export type ChartAnnotations = { notes: Note[]; noteColors: string[]; copy: Pick<Copy, 'notesCaption' | 'global'> };

/**
 * Notes for an annotated chart, through the same scoped service as the Notes screen, REST and MCP.
 * Follows every page up to the Root row limit; a result that would exceed it is refused (returns null) instead of
 * showing a partial set of marks. Any denial or failure also returns null: the chart then renders without marks.
 */
export async function loadChartAnnotations(actor: Actor & { locale: Locale }, from: string, to: string, channelIds?: readonly string[]): Promise<ChartAnnotations | null> {
 try {
  const { policy, copy } = await settings(actor.locale);
  const notes: Note[] = [];
  for (let offset = 0; offset <= policy.maxRows; offset += policy.pageSize) {
   const page = await listCalendarEntries(actor, 'notes', { from, to, offset });
   if (!('items' in page)) return null;
   notes.push(...(page.items as Note[]));
   if (!page.hasMore) {
    const visible = channelIds ? notes.filter(n => n.targetId === null || channelIds.includes(n.targetId)) : notes;
    return visible.length ? { notes: visible, noteColors: policy.colors, copy: { notesCaption: copy.notesCaption, global: copy.global } } : null;
   }
  }
  return null;
 } catch { return null; }
}
