import type { ResponseMessage, MemberResponse } from '../generation/response-time';
import { businessMs, calendarMs, type BusinessHoursSetting } from '../generation/business-hours';

export type MemberOutcome = {
  memberId: string | null; name: string; answered: number;
  slowestMs: number | null; businessSlowestMs: number | null;
  resolved: number; unresolved: number;
  medianResolveMs: number | null; businessMedianResolveMs: number | null;
};

/** Resolution belongs to the last visitor run before the saved resolution,
 * and to its first responder, not necessarily the person who clicked Resolve.
 * Input is the same period-filtered, complete-thread stream as the response report.
 * Only already-listed members are emitted, preserving the Root row ceiling.
 */
export function memberOutcomes(messages: ResponseMessage[], members: MemberResponse[], business: { hours: BusinessHoursSetting; timeZone: string } | null): MemberOutcome[] {
  type Wait = { start: Date; answer?: Date; memberId: string | null; resolved?: Date };
  const byMember = new Map<string | null, Wait[]>();
  let current: string | undefined; let runs: Wait[] = []; let open: Wait | undefined; let resolution: Date | null = null;
  const finish = () => {
    if (resolution) {
      const last = [...runs].reverse().find(run => run.start <= resolution!);
      if (last?.answer && last.answer <= resolution) last.resolved = resolution;
    }
    for (const run of runs) if (run.answer) {
      const list = byMember.get(run.memberId) ?? []; list.push(run); byMember.set(run.memberId, list);
    }
    runs = []; open = undefined; resolution = null;
  };
  for (const message of messages) {
    if (message.conversationId !== current) { finish(); current = message.conversationId; }
    if (!message.fromChannel) {
      if (!open) { open = { start: message.createdTime, memberId: null }; runs.push(open); }
      resolution ??= message.resolvedAt ?? null;
    } else if (open) {
      open.answer = message.createdTime; open.memberId = message.sentById ?? null; open = undefined;
    }
  }
  finish();
  const median = (values: number[]) => {
    if (!values.length) return null;
    values.sort((a, b) => a - b); const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2);
  };
  const maximum = (values: number[]) => values.length ? values.reduce((max, value) => Math.max(max, value), 0) : null;
  return members.map(member => {
    const waits = byMember.get(member.memberId) ?? [];
    const resolved = waits.filter((run): run is Wait & { resolved: Date } => Boolean(run.resolved));
    return {
      memberId: member.memberId, name: member.name, answered: waits.length,
      slowestMs: maximum(waits.map(run => calendarMs(run.start, run.answer!))),
      businessSlowestMs: business ? maximum(waits.map(run => businessMs(run.start, run.answer!, business.hours, business.timeZone))) : null,
      resolved: resolved.length, unresolved: waits.length - resolved.length,
      medianResolveMs: median(resolved.map(run => calendarMs(run.start, run.resolved))),
      businessMedianResolveMs: business ? median(resolved.map(run => businessMs(run.start, run.resolved, business.hours, business.timeZone))) : null,
    };
  });
}
