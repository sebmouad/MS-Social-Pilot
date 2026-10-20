import { FacebookApiError } from '../publishing';
import { isFacebookDefiniteRejection } from '../protocol';
import { FACEBOOK_NATIVE_CONFIG, facebookNativePolicyFrom } from '../native-config';
import { interpretFacebookThrottle, type FacebookThrottle } from './throttle';
import { FacebookAttemptStoreUnavailableError } from './types';
import type {
  FacebookNativeAttemptRecord, FacebookNativeAttemptStore, FacebookNativePolicy, FacebookNativeReadTransport, FacebookStatusReadback,
} from './types';

/*
 * Graph read/delete/comment shapes below are UNVERIFIED against live Graph (copied
 * from public documentation memory, mocked tests only). Unknown shapes map to 'unknown',
 * never to published.
 */
const STATUS_FIELDS = ['status', 'published', 'scheduled_publish_time'];

export interface StatusDeps {
  transport: FacebookNativeReadTransport;
  policy?: FacebookNativePolicy;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}
const aborted = (signal?: AbortSignal) => signal?.aborted === true;
const validFinalId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value === value.trim() && value !== '.' && value !== '..' && /^[A-Za-z0-9_.:-]+$/.test(value);
const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});
const waitForSleep = async (sleep: (ms: number) => Promise<void>, ms: number, signal?: AbortSignal) => {
  if (!signal) return sleep(ms);
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { cleanup(); resolve(); };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => sleep(ms)).then(() => { cleanup(); resolve(); }, (error) => { cleanup(); reject(error); });
  });
};
const isMissing = (e: unknown) => e instanceof FacebookApiError && e.code === 100 && e.subcode === 33;
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Map one Graph video-status answer to a neutral status. Pure. */
export function mapFacebookVideoStatus(format: FacebookNativeAttemptRecord['format'], raw: Record<string, unknown>): Omit<FacebookStatusReadback, 'polls'> {
  if (format !== 'video' && format !== 'reel') return { status: 'unknown', detail: 'readback_unsupported' };
  const status = rec(raw.status);
  const video = typeof status?.video_status === 'string' ? status.video_status : null;
  if (!video) return { status: 'unknown', detail: 'status_missing' };
  if (video === 'error' || video === 'expired') return { status: 'failed', detail: video };
  if (['processing', 'uploading', 'in_progress', 'rendering'].includes(video)) return { status: 'processing', detail: video };
  if (video !== 'ready') return { status: 'unknown', detail: 'status_unrecognized' };
  if (format === 'reel') {
    const phase = rec(status?.publishing_phase);
    const p = typeof phase?.status === 'string' ? phase.status : null;
    if (p === 'error') return { status: 'failed', detail: 'publishing_error' };
    if (p === 'complete') {
      // Continue to the explicit publication receipt below.
    } else if (p && ['processing', 'publishing', 'in_progress', 'pending'].includes(p)) {
      return { status: 'processing', detail: p };
    } else {
      return { status: 'unknown', detail: p ? 'publishing_phase_unrecognized' : 'publishing_phase_missing' };
    }
  }
  if (raw.published === true) return { status: 'published', detail: null };
  const scheduledAt = raw.scheduled_publish_time;
  const hasScheduleReceipt = (typeof scheduledAt === 'number' && Number.isFinite(scheduledAt) && scheduledAt > 0)
    || (typeof scheduledAt === 'string' && /^\d+$/.test(scheduledAt) && Number(scheduledAt) > 0);
  if (raw.published === false && hasScheduleReceipt) return { status: 'scheduled', detail: null };
  return { status: 'unknown', detail: 'publication_receipt_missing' };
}

/** Fields requested from a Page's Stories edge. UNVERIFIED against live Graph; mocked tests only. */
export const FACEBOOK_STORY_STATUS_FIELDS: readonly string[] = Object.freeze(['post_id', 'status', 'creation_time']);

/**
 * Map one answer from a Page's Stories edge to a neutral status for the exact final Story id.
 * A Story that is not listed is `unknown`, never absent or failed: the edge is a bounded recent list
 * and Stories expire, so non-membership proves nothing. Only an explicit published entry is positive.
 */
export function mapFacebookStoryStatus(remoteId: string, raw: Record<string, unknown>): Omit<FacebookStatusReadback, 'polls'> {
  const data = raw.data;
  if (!Array.isArray(data)) return { status: 'unknown', detail: 'status_shape_invalid' };
  const matches = data.filter(entry => rec(entry) && (entry as Record<string, unknown>).post_id === remoteId) as Array<Record<string, unknown>>;
  if (matches.length === 0) return { status: 'unknown', detail: 'story_not_listed' };
  if (matches.length > 1) return { status: 'unknown', detail: 'story_ambiguous' };
  const status = matches[0]!.status;
  if (typeof status !== 'string') return { status: 'unknown', detail: 'status_missing' };
  return status.toLowerCase() === 'published' ? { status: 'published', detail: null } : { status: 'unknown', detail: 'status_unrecognized' };
}

/** One read, bounded polling while processing. Reads are safe to repeat; nothing is written. */
export async function readFacebookNativeStatus(record: Pick<FacebookNativeAttemptRecord, 'format' | 'remoteId' | 'knownIds'>, deps: StatusDeps): Promise<FacebookStatusReadback> {
  // Snapshot every value that may otherwise be mutated while transport is awaited.
  const format = record.format;
  const remoteId = record.remoteId;
  const id = validFinalId(remoteId) ? remoteId : null;
  const signal = deps.signal;
  const transport = deps.transport;
  if (aborted(signal)) return { status: 'unknown', detail: 'aborted', polls: 0 };
  if (format === 'story_photo' || format === 'story_video') return { status: 'unknown', detail: 'readback_unsupported', polls: 0 };
  if (format !== 'video' && format !== 'reel') return { status: 'unknown', detail: 'readback_unsupported', polls: 0 };
  if (!id) return { status: 'unknown', detail: 'no_remote_id', polls: 0 };
  const policy = deps.policy ?? facebookNativePolicyFrom();
  const poll = rec(policy.poll);
  const maxPolls = poll?.maxPolls;
  const intervalMs = poll?.intervalMs;
  const maxEntry = FACEBOOK_NATIVE_CONFIG.find((x) => x.key === 'facebook.native.poll.maxPolls');
  const intervalEntry = FACEBOOK_NATIVE_CONFIG.find((x) => x.key === 'facebook.native.poll.intervalMs');
  if (!maxEntry || !intervalEntry || typeof maxPolls !== 'number' || !Number.isInteger(maxPolls) ||
      !maxEntry.schema.safeParse(maxPolls).success ||
      (maxPolls! > 1 && !intervalEntry.schema.safeParse(intervalMs).success)) {
    return { status: 'unknown', detail: 'invalid_poll_policy', polls: 0 };
  }
  const limit = maxPolls!;
  const interval = limit === 1 ? 0 : intervalMs as number;
  const sleep = deps.sleep;
  let last: Omit<FacebookStatusReadback, 'polls'> = { status: 'unknown', detail: 'not_read' };
  let polls = 0;
  while (polls < limit) {
    if (aborted(signal)) return { status: 'unknown', detail: 'aborted', polls };
    polls += 1;
    try {
      // Fresh field storage protects the module constant from a mutating transport.
      const raw = await transport.getGraph(id, [...STATUS_FIELDS], signal);
      if (aborted(signal)) return { status: 'unknown', detail: 'aborted', polls };
      last = rec(raw) ? mapFacebookVideoStatus(format, raw) : { status: 'unknown', detail: 'status_shape_invalid' };
    } catch (e) {
      if (aborted(signal)) return { status: 'unknown', detail: 'aborted', polls };
      // Graph code 100/subcode 33 can mean inaccessible or unsupported as well as
      // absent. It is not proof of absence and must not settle publication state.
      last = { status: 'unknown', detail: 'read_failed' };
    }
    if (last.status !== 'processing' && last.detail !== 'read_failed') break;
    if (polls < limit) {
      if (sleep) await waitForSleep(sleep, interval, signal);
      else await defaultSleep(interval, signal);
      if (aborted(signal)) return { status: 'unknown', detail: 'aborted', polls };
    }
  }
  return { ...last, polls };
}

export interface ReconcileResult { state: FacebookNativeAttemptRecord['state'] | 'not_found' | 'unknown'; readback: FacebookStatusReadback | null; cancelled?: true }

/** Settle an uncertain/started attempt from readback. Never resends. */
export async function reconcileFacebookNativeAttempt(operationId: string, deps: StatusDeps & { attempts: FacebookNativeAttemptStore }): Promise<ReconcileResult> {
  const signal = deps.signal;
  const attempts = deps.attempts;
  const transport = deps.transport;
  if (aborted(signal)) return { state: 'unknown', readback: null, cancelled: true };
  const record = await attempts.get(operationId);
  if (aborted(signal)) return { state: record?.state ?? 'not_found', readback: null, cancelled: true };
  if (!record) return { state: 'not_found', readback: null };
  // Child operation IDs currently use these suffixes. Their remote effects
  // cannot be inferred from the parent video's publication status.
  if (operationId.endsWith(':comment') || operationId.endsWith(':delete')) {
    return { state: record.state, readback: null };
  }
  if (record.state !== 'uncertain' && record.state !== 'started') return { state: record.state, readback: null };
  const stateSnapshot = record.state;
  const remoteIdSnapshot = record.remoteId;
  const knownIdsSnapshot = [...record.knownIds];
  const readback = await readFacebookNativeStatus({ format: record.format, remoteId: remoteIdSnapshot, knownIds: knownIdsSnapshot }, { ...deps, transport, signal });
  if (aborted(signal)) return { state: stateSnapshot, readback, cancelled: true };
  // A readback is evidence only. This scaffold has no authorized,
  // identity-bound proof writer; a read alone cannot confirm durable delivery.
  // A known remote object is also never rejected from a failed status response.
  const state: FacebookNativeAttemptRecord['state'] = stateSnapshot === 'started' ? 'uncertain' : stateSnapshot;
  if (state === stateSnapshot) {
    try {
      const current = await attempts.get(operationId);
      if (aborted(signal)) return { state: current?.state ?? 'not_found', readback, cancelled: true };
      return { state: current?.state ?? 'not_found', readback };
    } catch { return { state: 'uncertain', readback }; }
  }
  try {
    // A CAS must return explicit true; void, false, malformed replies and throws
    // are not receipts. Read the durable row if possible, otherwise stay held.
    const applied: unknown = await attempts.update(operationId, { state }, [stateSnapshot]);
    if (aborted(signal)) return { state: applied === true ? state : stateSnapshot, readback, cancelled: true };
    if (applied === true) return { state, readback };
  } catch { /* resolve below from durable state */ }
  try {
    const current = await attempts.get(operationId);
    if (current) return { state: current.state, readback, ...(aborted(signal) ? { cancelled: true as const } : {}) };
  } catch { /* unresolved CAS outcome stays uncertain */ }
  return { state: 'uncertain', readback };
}

/** Attempt-store reads/begins fail closed with the shared error; nothing is sent. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch { throw new FacebookAttemptStoreUnavailableError(); }
}
/** Recording after a send is best-effort: a failed write must never change or hide a remote outcome. */
async function record(attempts: FacebookNativeAttemptStore, id: string, patch: Parameters<FacebookNativeAttemptStore['update']>[1], expectedStates?: Parameters<FacebookNativeAttemptStore['update']>[2]): Promise<void> {
  try { await attempts.update(id, patch, expectedStates); } catch { /* row stays in its last durable state; reconciliation treats it as uncertain */ }
}

export type FacebookCommentOutcome =
  | { status: 'commented'; commentId: string }
  | { status: 'not_ready'; readback: FacebookStatusReadback }
  | { status: 'unsupported' | 'no_publication' }
  | { status: 'rejected' | 'uncertain'; message: string; throttle?: FacebookThrottle }
  | { status: 'already_attempted'; previous: FacebookNativeAttemptRecord };

/** First comment on a published video/Reel. A write is attempted only after readback shows it is public, and at most once. */
export async function postFacebookNativeFirstComment(publishOperationId: string, message: string,
  deps: StatusDeps & { attempts: FacebookNativeAttemptStore }): Promise<FacebookCommentOutcome> {
  if (aborted(deps.signal)) return { status: 'no_publication' };
  const pub = await guarded(() => deps.attempts.get(publishOperationId));
  if (aborted(deps.signal)) return { status: 'no_publication' };
  const format = pub?.format;
  const state = pub?.state;
  const remoteId = validFinalId(pub?.remoteId) ? pub.remoteId : null;
  const targetId = pub?.targetId;
  const knownIds = pub ? [...pub.knownIds] : [];
  if (!pub || !remoteId || !['published', 'confirmed'].includes(state!)) return { status: 'no_publication' };
  if (format !== 'video' && format !== 'reel') return { status: 'unsupported' };
  const readback = await readFacebookNativeStatus({ format, remoteId, knownIds }, deps);
  if (aborted(deps.signal)) return { status: 'not_ready', readback: { status: 'unknown', detail: 'aborted', polls: readback.polls } };
  if (readback.status !== 'published') return { status: 'not_ready', readback };
  const opId = `${publishOperationId}:comment`;
  // Fail closed: if the idempotency record cannot be written, nothing is sent.
  if (aborted(deps.signal)) return { status: 'not_ready', readback: { status: 'unknown', detail: 'aborted', polls: readback.polls } };
  const begun = await guarded(() => deps.attempts.begin({ operationId: opId, format, state: 'started', knownIds: [remoteId], targetId }));
  if (!begun.created) return { status: 'already_attempted', previous: begun.existing };
  if (aborted(deps.signal)) {
    await record(deps.attempts, opId, { state: 'uncertain' });
    return { status: 'uncertain', message: 'The comment outcome is unknown. Check the post before trying again.' };
  }
  let r: Record<string, unknown>;
  try {
    r = await deps.transport.postGraph(`${remoteId}/comments`, { message });
  } catch (e) {
    const definite = e instanceof FacebookApiError && isFacebookDefiniteRejection(e.status, e.code, e.transient);
    await record(deps.attempts, opId, { state: definite ? 'rejected' : 'uncertain' });
    const th = interpretFacebookThrottle(e);
    const throttle = th ? { throttle: th } : {};
    return definite
      ? { status: 'rejected', message: 'Facebook rejected the comment.', ...throttle }
      : { status: 'uncertain', message: 'The comment outcome is unknown. Check the post before trying again.', ...throttle };
  }
  // The POST was answered; from here the remote outcome is fixed and recording cannot change it.
  const cid = typeof rec(r)?.id === 'string' && (rec(r)!.id as string).trim() ? (rec(r)!.id as string).trim() : null;
  if (!cid) {
    await record(deps.attempts, opId, { state: 'uncertain' });
    return { status: 'uncertain', message: 'Facebook answered without a comment identity. Check the post before trying again.' };
  }
  await record(deps.attempts, opId, { state: 'published', remoteId: cid });
  return { status: 'commented', commentId: cid };
}

export type FacebookDeleteOutcome =
  | { status: 'deleted'; alreadyAbsent: boolean }
  | { status: 'unsupported' | 'no_publication' }
  | { status: 'rejected' | 'uncertain'; message: string; stillPresent?: boolean; throttle?: FacebookThrottle }
  | { status: 'already_attempted'; previous: FacebookNativeAttemptRecord };

/** Delete a published video/Reel at Facebook once; an unclear result is settled by readback, never by resending. */
export async function deleteFacebookNativeRemote(publishOperationId: string, deps: StatusDeps & { attempts: FacebookNativeAttemptStore }): Promise<FacebookDeleteOutcome> {
  if (aborted(deps.signal)) return { status: 'no_publication' };
  const pub = await guarded(() => deps.attempts.get(publishOperationId));
  if (aborted(deps.signal)) return { status: 'no_publication' };
  const format = pub?.format;
  const state = pub?.state;
  const remoteId = validFinalId(pub?.remoteId) ? pub.remoteId : null;
  const targetId = pub?.targetId;
  const knownIds = pub ? [...pub.knownIds] : [];
  if (!pub || !remoteId || (state !== 'published' && state !== 'confirmed')) return { status: 'no_publication' };
  if (format !== 'video' && format !== 'reel') return { status: 'unsupported' };
  const opId = `${publishOperationId}:delete`;
  // Fail closed: if the idempotency record cannot be written, nothing is sent.
  const begun = await guarded(() => deps.attempts.begin({ operationId: opId, format, state: 'started', knownIds: [remoteId], targetId }));
  if (!begun.created) return { status: 'already_attempted', previous: begun.existing };
  const settle = (state: FacebookNativeAttemptRecord['state']) => record(deps.attempts, opId, { state });
  const markDeleted = async () => { await settle('deleted'); await record(deps.attempts, publishOperationId, { state: 'deleted' }, ['published', 'confirmed']); };
  if (aborted(deps.signal)) {
    await settle('uncertain');
    return { status: 'uncertain', message: 'The deletion outcome is unknown. Check the Page before trying again.' };
  }
  let throttle: { throttle: FacebookThrottle } | Record<string, never> = {};
  try {
    const r = await deps.transport.deleteGraph(remoteId);
    if (r.success === true) { await markDeleted(); return { status: 'deleted', alreadyAbsent: false }; }
    if (aborted(deps.signal)) {
      await settle('uncertain');
      return { status: 'uncertain', message: 'The deletion outcome is unknown. Check the Page before trying again.' };
    }
  } catch (e) {
    if (!isMissing(e) && e instanceof FacebookApiError && isFacebookDefiniteRejection(e.status, e.code, e.transient)) {
      await settle('rejected');
      const th = interpretFacebookThrottle(e);
      return { status: 'rejected', message: 'Facebook refused to delete this item.', ...(th ? { throttle: th } : {}) };
    }
    const th = interpretFacebookThrottle(e);
    if (th) throttle = { throttle: th };
  }
  // Unclear answer: settle by a single readback (a read, so safe) instead of resending the delete.
  const rb = await readFacebookNativeStatus({ format, remoteId, knownIds }, { ...deps, policy: { ...(deps.policy ?? facebookNativePolicyFrom()), poll: { maxPolls: 1, intervalMs: 0 } } });
  await settle('uncertain');
  return { status: 'uncertain', message: 'The deletion outcome is unknown. Check the Page before trying again.', stillPresent: rb.status === 'published' || rb.status === 'scheduled' || rb.status === 'processing' ? true : undefined, ...throttle };
}
