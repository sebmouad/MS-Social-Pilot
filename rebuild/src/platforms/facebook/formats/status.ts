import { FacebookApiError } from '../publishing';
import { isFacebookDefiniteRejection } from '../protocol';
import { facebookNativePolicyFrom } from '../native-config';
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
}
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isMissing = (e: unknown) => e instanceof FacebookApiError && e.code === 100 && e.subcode === 33;
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Map one Graph video-status answer to a neutral status. Pure. */
export function mapFacebookVideoStatus(format: FacebookNativeAttemptRecord['format'], raw: Record<string, unknown>): Omit<FacebookStatusReadback, 'polls'> {
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

/** One read, bounded polling while processing. Reads are safe to repeat; nothing is written. */
export async function readFacebookNativeStatus(record: Pick<FacebookNativeAttemptRecord, 'format' | 'remoteId' | 'knownIds'>, deps: StatusDeps): Promise<FacebookStatusReadback> {
  const policy = deps.policy ?? facebookNativePolicyFrom();
  const id = record.remoteId ?? record.knownIds[0];
  if (!id) return { status: 'unknown', detail: 'no_remote_id', polls: 0 };
  if (record.format === 'story_photo') return { status: 'unknown', detail: 'readback_unsupported', polls: 0 };
  const sleep = deps.sleep ?? defaultSleep;
  let last: Omit<FacebookStatusReadback, 'polls'> = { status: 'unknown', detail: 'not_read' };
  let polls = 0;
  while (polls < policy.poll.maxPolls) {
    polls += 1;
    try {
      last = mapFacebookVideoStatus(record.format, await deps.transport.getGraph(id, STATUS_FIELDS));
    } catch (e) {
      // Graph code 100/subcode 33 can mean inaccessible or unsupported as well as
      // absent. It is not proof of absence and must not settle publication state.
      last = { status: 'unknown', detail: 'read_failed' };
    }
    if (last.status !== 'processing' && last.detail !== 'read_failed') break;
    if (polls < policy.poll.maxPolls) await sleep(policy.poll.intervalMs);
  }
  return { ...last, polls };
}

export interface ReconcileResult { state: FacebookNativeAttemptRecord['state'] | 'not_found'; readback: FacebookStatusReadback | null }

/** Settle an uncertain/started attempt from readback. Never resends. */
export async function reconcileFacebookNativeAttempt(operationId: string, deps: StatusDeps & { attempts: FacebookNativeAttemptStore }): Promise<ReconcileResult> {
  const record = await deps.attempts.get(operationId);
  if (!record) return { state: 'not_found', readback: null };
  // Child operation IDs currently use these suffixes. Their remote effects
  // cannot be inferred from the parent video's publication status.
  if (operationId.endsWith(':comment') || operationId.endsWith(':delete')) {
    return { state: record.state, readback: null };
  }
  if (record.state !== 'uncertain' && record.state !== 'started') return { state: record.state, readback: null };
  const readback = await readFacebookNativeStatus(record, deps);
  let state: FacebookNativeAttemptRecord["state"] = record.state;
  if (readback.status === 'published' || readback.status === 'scheduled') state = 'confirmed';
  else if (readback.status === 'failed') state = 'rejected';
  else if (record.state === 'started') state = 'uncertain'; // a crash mid-attempt is never assumed unsent
  if (state !== record.state) {
    // Compare-and-set on the state we read: a concurrent settle or a deletion wins over this late read.
    const applied = await deps.attempts.update(operationId, { state, remoteId: record.remoteId ?? record.knownIds[0] ?? null }, [record.state]);
    if (applied === false) {
      const current = await deps.attempts.get(operationId);
      return { state: current?.state ?? record.state, readback };
    }
  }
  return { state, readback };
}

/** Attempt-store reads/begins fail closed with the shared error; nothing is sent. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch { throw new FacebookAttemptStoreUnavailableError(); }
}
/** Recording after a send is best-effort: a failed write must never change or hide a remote outcome. */
async function record(attempts: FacebookNativeAttemptStore, id: string, patch: Parameters<FacebookNativeAttemptStore['update']>[1]): Promise<void> {
  try { await attempts.update(id, patch); } catch { /* row stays in its last durable state; reconciliation treats it as uncertain */ }
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
  const pub = await guarded(() => deps.attempts.get(publishOperationId));
  const id = pub?.remoteId ?? pub?.knownIds[0];
  if (!pub || !id || !['published', 'confirmed'].includes(pub.state)) return { status: 'no_publication' };
  if (pub.format !== 'video' && pub.format !== 'reel') return { status: 'unsupported' };
  const readback = await readFacebookNativeStatus(pub, deps);
  if (readback.status !== 'published') return { status: 'not_ready', readback };
  const opId = `${publishOperationId}:comment`;
  // Fail closed: if the idempotency record cannot be written, nothing is sent.
  const begun = await guarded(() => deps.attempts.begin({ operationId: opId, format: pub.format, state: 'started', knownIds: [id], targetId: pub.targetId }));
  if (!begun.created) return { status: 'already_attempted', previous: begun.existing };
  let r: Record<string, unknown>;
  try {
    r = await deps.transport.postGraph(`${id}/comments`, { message });
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
  const cid = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
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
  const pub = await guarded(() => deps.attempts.get(publishOperationId));
  const id = pub?.remoteId ?? pub?.knownIds[0];
  if (!pub || !id || pub.state === 'started' || pub.state === 'rejected') return { status: 'no_publication' };
  if (pub.format !== 'video' && pub.format !== 'reel') return { status: 'unsupported' };
  const opId = `${publishOperationId}:delete`;
  // Fail closed: if the idempotency record cannot be written, nothing is sent.
  const begun = await guarded(() => deps.attempts.begin({ operationId: opId, format: pub.format, state: 'started', knownIds: [id], targetId: pub.targetId }));
  if (!begun.created) return { status: 'already_attempted', previous: begun.existing };
  const settle = (state: FacebookNativeAttemptRecord['state']) => record(deps.attempts, opId, { state });
  const markDeleted = async () => { await settle('deleted'); await record(deps.attempts, publishOperationId, { state: 'deleted' }); };
  let throttle: { throttle: FacebookThrottle } | Record<string, never> = {};
  try {
    const r = await deps.transport.deleteGraph(id);
    if (r.success === true) { await markDeleted(); return { status: 'deleted', alreadyAbsent: false }; }
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
  const rb = await readFacebookNativeStatus(pub, { ...deps, policy: { ...(deps.policy ?? facebookNativePolicyFrom()), poll: { maxPolls: 1, intervalMs: 0 } } });
  await settle('uncertain');
  return { status: 'uncertain', message: 'The deletion outcome is unknown. Check the Page before trying again.', stillPresent: rb.status === 'published' || rb.status === 'scheduled' || rb.status === 'processing' ? true : undefined, ...throttle };
}
