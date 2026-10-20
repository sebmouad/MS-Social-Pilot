import { FacebookApiError } from '../publishing';
import { isFacebookDefiniteRejection } from '../protocol';
import { facebookNativePolicyFrom } from '../native-config';
import { guarded, record } from './attempt-io';
import { readFacebookNativeStatus, type StatusDeps } from './status';
import { interpretFacebookThrottle, type FacebookThrottle } from './throttle';
import type { FacebookNativeAttemptRecord, FacebookNativeAttemptStore } from './types';

/*
 * Provider-held schedule changes for a native Video post. Cancel (DELETE of the held object) and reschedule
 * (POST scheduled_publish_time on it) are UNVERIFIED against live Graph; mocked tests only. Neither is
 * advertised by the neutral catalog. Both read first and write only while Facebook itself reports the object
 * as scheduled, send at most once per operation, and settle an unclear answer by readback, never by resending.
 * Reels, Stories and feed posts are not provider-scheduled here.
 */
export type FacebookScheduleOutcome =
  | { status: 'cancelled' | 'rescheduled' }
  | { status: 'unsupported' | 'no_publication' }
  | { status: 'not_scheduled'; detail: string | null }
  | { status: 'invalid_schedule'; message: string }
  | { status: 'rejected' | 'uncertain'; message: string; stillScheduled?: boolean; throttle?: FacebookThrottle }
  | { status: 'already_attempted'; previous: FacebookNativeAttemptRecord };

type Deps = StatusDeps & { attempts: FacebookNativeAttemptStore };
const aborted = (signal?: AbortSignal) => signal?.aborted === true;
const validFinalId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value === value.trim() && value !== '.' && value !== '..' && /^[A-Za-z0-9_.:-]+$/.test(value);
const UNCERTAIN = 'The schedule change outcome is unknown. Check the Page before trying again.';

/** Read the held object and write only when Facebook reports it scheduled. Shared by cancel and reschedule. */
async function guardedScheduleWrite(publishOperationId: string, opSuffix: string, deps: Deps,
  write: (remoteId: string) => Promise<Record<string, unknown>>, done: 'cancelled' | 'rescheduled', beforeWrite?: () => FacebookScheduleOutcome | null): Promise<FacebookScheduleOutcome> {
  if (aborted(deps.signal)) return { status: 'no_publication' };
  const pub = await guarded(() => deps.attempts.get(publishOperationId));
  if (aborted(deps.signal)) return { status: 'no_publication' };
  const format = pub?.format;
  const remoteId = validFinalId(pub?.remoteId) ? pub.remoteId : null;
  if (!pub || !remoteId || (pub.state !== 'published' && pub.state !== 'confirmed')) return { status: 'no_publication' };
  if (format !== 'video') return { status: 'unsupported' };
  const early = beforeWrite?.();
  if (early) return early;
  const policy = { ...(deps.policy ?? facebookNativePolicyFrom()) };
  const single = { ...deps, policy: { ...policy, poll: { maxPolls: 1, intervalMs: 0 } } };
  const before = await readFacebookNativeStatus({ format, remoteId, knownIds: [...pub.knownIds] }, single);
  if (before.status !== 'scheduled') return { status: 'not_scheduled', detail: before.status === 'unknown' ? before.detail : before.status };
  const opId = `${publishOperationId}:${opSuffix}`;
  const begun = await guarded(() => deps.attempts.begin({ operationId: opId, format, state: 'started', knownIds: [remoteId], targetId: pub.targetId }));
  if (!begun.created) return { status: 'already_attempted', previous: begun.existing };
  const settle = (state: FacebookNativeAttemptRecord['state']) => record(deps.attempts, opId, { state });
  if (aborted(deps.signal)) { await settle('uncertain'); return { status: 'uncertain', message: UNCERTAIN }; }
  let throttle: { throttle: FacebookThrottle } | Record<string, never> = {};
  try {
    const answer = await write(remoteId);
    if (answer.success === true) {
      if (done === 'cancelled') { await settle('deleted'); await record(deps.attempts, publishOperationId, { state: 'deleted' }, ['published', 'confirmed']); }
      else await settle('published');
      return { status: done };
    }
  } catch (e) {
    if (e instanceof FacebookApiError && isFacebookDefiniteRejection(e.status, e.code, e.transient)) {
      await settle('rejected');
      const th = interpretFacebookThrottle(e);
      return { status: 'rejected', message: 'Facebook refused to change this schedule.', ...(th ? { throttle: th } : {}) };
    }
    const th = interpretFacebookThrottle(e);
    if (th) throttle = { throttle: th };
  }
  // Unclear (non-true answer, ambiguous error or cancellation): one read, never a second write.
  const after = await readFacebookNativeStatus({ format, remoteId, knownIds: [...pub.knownIds] }, single);
  await settle('uncertain');
  return { status: 'uncertain', message: UNCERTAIN, ...(after.status === 'scheduled' ? { stillScheduled: true } : {}), ...throttle };
}

/** Cancel a provider-held native Video before it goes live. */
export function cancelFacebookNativeSchedule(publishOperationId: string, deps: Deps): Promise<FacebookScheduleOutcome> {
  return guardedScheduleWrite(publishOperationId, 'cancel', deps, remoteId => deps.transport.deleteGraph(remoteId), 'cancelled');
}

/** Move a provider-held native Video to a new instant inside the Root schedule window. */
export function rescheduleFacebookNativeSchedule(publishOperationId: string, scheduledAt: Date, deps: Deps & { now?: Date }): Promise<FacebookScheduleOutcome> {
  const policy = deps.policy ?? facebookNativePolicyFrom();
  const now = deps.now ?? new Date();
  const time = scheduledAt instanceof Date ? scheduledAt.getTime() : NaN;
  const unix = Math.floor(time / 1000);
  const check = (): FacebookScheduleOutcome | null => {
    if (!Number.isFinite(time) || !Number.isFinite(now.getTime())) return { status: 'invalid_schedule', message: 'Choose a valid publishing date.' };
    const delta = Math.floor((time - now.getTime()) / 1000);
    if (delta < policy.scheduleMinSeconds) return { status: 'invalid_schedule', message: 'Facebook requires scheduled posts to be further ahead.' };
    if (delta > policy.scheduleMaxSeconds) return { status: 'invalid_schedule', message: 'Facebook cannot hold a post that far ahead.' };
    return null;
  };
  return guardedScheduleWrite(publishOperationId, `reschedule:${unix}`, { ...deps, policy }, remoteId =>
    deps.transport.postGraph(remoteId, { published: 'false', scheduled_publish_time: String(unix) }), 'rescheduled', check);
}
