import type { ResponseMessage } from '../generation/response-time';

export type ResolutionEvent = { itemId: string; kind: 'message' | 'comment'; resolved: boolean; createdAt: Date };

/** Preserve the original start of visitor runs before applying the report window.
 * Reading only messages inside the window invents a new wait when a visitor continues an older run.
 */
export function periodResponseMessages(messages: ResponseMessage[], from: Date, to: Date): ResponseMessage[] {
  const runs: ResponseMessage[][] = [];
  let current: string | null = null;
  let open: ResponseMessage[] | null = null;
  for (const message of messages) {
    if (message.createdTime >= to) continue;
    if (message.conversationId !== current) { current = message.conversationId; open = null; }
    if (!message.fromChannel && !open) { open = []; runs.push(open); }
    if (open) open.push(message);
    if (message.fromChannel) open = null;
  }
  // A resolution closes the latest preceding visitor run, as in the legacy wait model.
  return runs.flatMap((run, index) => {
    const first = run[0]!;
    if (first.createdTime < from) return [];
    const next = runs[index + 1]?.[0];
    const resolution = first.resolvedAt;
    const applies = resolution && resolution >= first.createdTime && (!next || next.conversationId !== first.conversationId || resolution < next.createdTime);
    return run.map(message => ({ ...message, conversationId: JSON.stringify([first.conversationId, index]), resolvedAt: applies ? resolution : null }));
  });
}

/** State at the exclusive report end, never today's state after a later reopen.
 * Missing audit history is explicitly a snapshot fallback, not reconstructed history.
 */
export function resolutionAtEnd(events: ResolutionEvent[], kind: ResolutionEvent['kind'], itemId: string, to: Date): { known: boolean; resolvedAt: Date | null } {
  const history = events.filter(event => event.kind === kind && event.itemId === itemId && event.createdAt < to)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const last = history.at(-1);
  return { known: Boolean(last), resolvedAt: last?.resolved ? last.createdAt : null };
}

export type HistoricalCycle = { startedAt: Date; resolvedAt: Date };
/** Reconstruct completed local workflow cycles from visitor messages and audit events.
 * A reopen without a new visitor message never invents a new duration. Repeated
 * resolve events are counted as events by the caller, but cannot duplicate a cycle.
 */
export function historicalResolutionCycles(messages: Array<{ itemId: string; kind: ResolutionEvent['kind']; createdTime: Date; fromChannel: boolean }>, events: ResolutionEvent[], from: Date, to: Date): HistoricalCycle[] {
  type Point = { at: Date; kind: 'visitor' | 'resolved' | 'reopened'; item: string };
  const points: Point[] = [
    ...messages.filter(message => !message.fromChannel && message.createdTime < to).map(message => ({ at: message.createdTime, kind: 'visitor' as const, item: JSON.stringify([message.kind, message.itemId]) })),
    ...events.filter(event => event.createdAt < to).map(event => ({ at: event.createdAt, kind: event.resolved ? 'resolved' as const : 'reopened' as const, item: JSON.stringify([event.kind, event.itemId]) })),
  ];
  // At equal timestamps, a visitor precedes the event; stable event order comes from SQL.
  points.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'visitor' ? -1 : b.kind === 'visitor' ? 1 : 0));
  const starts = new Map<string, Date>();
  const cycles: HistoricalCycle[] = [];
  for (const point of points) {
    if (point.kind === 'visitor') { if (!starts.has(point.item)) starts.set(point.item, point.at); continue; }
    const start = starts.get(point.item);
    if (point.kind === 'resolved' && start && start >= from) cycles.push({ startedAt: start, resolvedAt: point.at });
    starts.delete(point.item);
  }
  return cycles;
}
