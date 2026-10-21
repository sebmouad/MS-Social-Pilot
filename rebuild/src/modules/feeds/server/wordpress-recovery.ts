import type { WpDb } from '../wordpress/db';
import type { FeedAuthorization } from './access';
import { planSource, slotKey, type PlannerPorts } from './wordpress-planner';
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
 * slot is first checked against Publishing: when a post exists for that channel and time it is recorded (never
 * duplicated); only when none exists, and the claim is older than its lease so nothing can still be in flight, is the slot
 * released. Slots that cannot be confirmed stay uncertain. The planner then fills only the released and failed slots.
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
      if (await ports.store.settleIf(source.workspaceId, row.id, 'uncertain', { state: 'planned', postId: post.id, reason: RECONCILED })) out.reconciled += 1;
    } else if (await ports.store.settleIf(source.workspaceId, row.id, 'uncertain', { state: 'failed', reason: NOT_CREATED })) {
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
    try { await ports.cancelPost(auth.actor, row.postId!); } catch { out.notCancelled += 1; continue; }
    out.cancelled += 1;
    await ports.store.settleIf(source.workspaceId, row.id, 'planned', { state: 'failed', reason: CANCELLED, expectedPostId: row.postId }).catch(() => false);
  }
  // Posts that were refused stay scheduled, so a further request would meet them again: more work only when new ones remain.
  if (out.remaining && out.cancelled === 0) out.remaining = false;
  return out;
}
