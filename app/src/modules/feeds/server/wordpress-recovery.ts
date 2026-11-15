import type { WpDb } from '../wordpress/db';
import type { FeedAuthorization } from './access';
import { LEFT_EMPTY, planSource, slotKey, type PlannerPorts } from './wordpress-planner';
import type { WordpressSettings } from './wordpress-settings';
import type { LedgerRow, SourceRow } from './wordpress-store';

/** Reasons recorded on a slot by the recovery steps below (shown to members through the planned-posts table). */
export const RECONCILED = 'reconciled';
export const NOT_CREATED = 'not_created';
export const CANCELLED = 'cancelled';

const inScope = (auth: FeedAuthorization, row: Pick<LedgerRow, 'targetId'>) => auth.actor.allowedTargetIds === undefined || auth.actor.allowedTargetIds.includes(row.targetId);

export type RetryOutcome = {
  /** Failed or uncertain upcoming slots examined. */
  considered: number;
  /** Uncertain slots whose post was found in Publishing and recorded as scheduled; nothing was created. */
  reconciled: number;
  /** Uncertain slots confirmed to have no post and released for planning. */
  released: number;
  /** Uncertain slots left as they are: too recent to judge, or Publishing could not be checked. */
  unconfirmed: number;
  planned: number; failed: number; uncertain: number; unfilled: number;
};

/**
 * Re-plan the upcoming slots whose post is definitively not created. A failed slot never produced a post. An uncertain
 * slot is first checked against Publishing using durable recipe identity, regardless of the post
 * state or current time. Unknown identity or absence proof stays uncertain. Only definitive absence from the port,
 * after the claim lease ends, permits release. Slots that cannot be confirmed stay uncertain. The planner then fills only the released and failed slots.
 */
export async function retryRecipeSlots(ctx: { settings: WordpressSettings; ports: PlannerPorts; db: WpDb; now: Date }, source: SourceRow, auth: FeedAuthorization): Promise<RetryOutcome> {
  const { settings, ports, now } = ctx;
  const out: RetryOutcome = { considered: 0, reconciled: 0, released: 0, unconfirmed: 0, planned: 0, failed: 0, uncertain: 0, unfilled: 0 };
  await ports.store.expireStale(source.id, new Date(now.getTime() - settings.claimLeaseSeconds * 1000));
  const rows = (await ports.store.unresolved(source.id, now, settings.runBudget)).filter(row => inScope(auth, row));
  out.considered = rows.length;
  const retry = new Set<string>();
  const lease = settings.claimLeaseSeconds * 1000;
  for (const row of rows) {
    const key = slotKey(row.targetId, row.slotAt);
    if (row.state === 'failed') { retry.add(key); continue; }
    if (now.getTime() - row.claimedAt.getTime() < lease) { out.unconfirmed += 1; continue; }
    let post: { id: string } | null;
    try { post = await ports.postForSlot(source.workspaceId, row.targetId, row.slotAt); } catch { out.unconfirmed += 1; continue; }
    if (post) {
      if (await ports.store.settleIf(source.workspaceId, row.id, 'uncertain', { state: 'planned', postId: post.id, reason: RECONCILED, expectedPostId: row.postId })) out.reconciled += 1;
    } else if (await ports.store.settleIf(source.workspaceId, row.id, 'uncertain', { state: 'failed', reason: NOT_CREATED, expectedPostId: row.postId })) {
      out.released += 1; retry.add(key);
    }
  }
  if (!retry.size) return out;
  const planned = await planSource({ settings, ports, db: ctx.db, budget: { left: settings.runBudget }, now, retry }, source, auth);
  return { ...out, planned: planned.planned, failed: planned.failed, uncertain: planned.uncertain, unfilled: planned.unfilled };
}

export type CancelOutcome = {
  cancelled: number;
  /** Posts Publishing would not cancel (already publishing or published, edited, or outside the member's rights). */
  notCancelled: number;
  /** True when more scheduled posts remain: repeat the request. */
  remaining: boolean;
};

/**
 * Cancel the source's scheduled, not yet published posts through Publishing's own cancel (the post returns to a draft, a
 * platform-held copy is removed first). Only posts this source planned are touched. Each slot is released for planning
 * only after its post was cancelled, so a refused cancel leaves the slot and the post exactly as they were.
 */
export async function cancelPlannedPosts(ctx: { settings: WordpressSettings; ports: PlannerPorts; now: Date }, source: SourceRow, auth: FeedAuthorization): Promise<CancelOutcome> {
  const { settings, ports, now } = ctx;
  const limit = settings.pauseCancel.batchSize;
  const rows = (await ports.store.plannedUpcoming(source.id, now, limit + 1)).filter(row => inScope(auth, row));
  const out: CancelOutcome = { cancelled: 0, notCancelled: 0, remaining: rows.length > limit };
  for (const row of rows.slice(0, limit)) {
    try { await ports.cancelPost(auth.actor, row.postId!); } catch {
      out.notCancelled += 1;
      // Retain the held post and state, but rotate this attempted row behind untouched work.
      await ports.store.deferCancellation?.(source.workspaceId, row.id, row.postId!);
      continue;
    }
    out.cancelled += 1;
    await ports.store.settleIf(source.workspaceId, row.id, 'planned', { state: 'failed', reason: CANCELLED, expectedPostId: row.postId }).catch(() => false);
  }
  return out;
}

export const REPLACED = 'replaced';
/** What a member can do to one planned slot (2026-11-15). */
export type SlotAction = { kind: 'replace' } | { kind: 'leave_empty' } | { kind: 'fill' } | { kind: 'choose'; wpPostId: string } | { kind: 'exclude' };
export type ReplaceOutcome = { replaced: boolean; planned: number; unfilled: number };

/**
 * Change one upcoming slot. Its post (when it has one) goes through Publishing's own cancel (a platform-held copy is
 * removed first) and the cancelled draft is deleted; a post Publishing will not cancel (publishing, published or edited)
 * leaves everything as it was. Then: replace/exclude plan another recipe (the old one is not chosen again for this time),
 * choose plans exactly the member's recipe, leave_empty keeps the time empty until fill plans it again.
 */
export async function changeRecipeSlot(ctx: { settings: WordpressSettings; ports: PlannerPorts; db: WpDb; now: Date }, source: SourceRow, auth: FeedAuthorization, row: LedgerRow, action: SlotAction,
  deleteDraft: (postId: string) => Promise<void>, setSlot: (fields: { skipped?: string[]; reason?: string | null }) => Promise<void>): Promise<ReplaceOutcome> {
  const { settings, ports, now } = ctx;
  const none = { replaced: false, planned: 0, unfilled: 0 };
  if (!inScope(auth, row) || row.slotAt.getTime() <= now.getTime()) return none;
  if (action.kind === 'fill') {
    if (row.reason !== LEFT_EMPTY) return none;
    await setSlot({ reason: CANCELLED });
  } else if (row.state === 'planned' && row.postId) {
    try { await ports.cancelPost(auth.actor, row.postId); } catch { return none; }
    await deleteDraft(row.postId).catch(() => undefined);
    if (!await ports.store.settleIf(source.workspaceId, row.id, 'planned', { state: 'failed', reason: action.kind === 'leave_empty' ? LEFT_EMPTY : REPLACED, expectedPostId: row.postId })) return none;
  } else if (row.state === 'failed') {
    if (action.kind === 'leave_empty') await setSlot({ reason: LEFT_EMPTY });
  } else return none;
  if (action.kind === 'leave_empty') return { replaced: true, planned: 0, unfilled: 0 };
  if (action.kind === 'replace' || action.kind === 'exclude') await setSlot({ skipped: [...new Set([...row.skipped, row.wpPostId])] });
  const key = slotKey(row.targetId, row.slotAt);
  const planned = await planSource({ settings, ports, db: ctx.db, budget: { left: settings.runBudget }, now, retry: new Set([key]),
    ...(action.kind === 'choose' ? { force: new Map([[key, action.wpPostId]]) } : {}) }, source, auth);
  return { replaced: true, planned: planned.planned, unfilled: planned.unfilled };
}
