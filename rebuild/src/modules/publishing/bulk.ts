import { actionBulkCopy, publishingActionCopy, publishingActionText } from './action-catalog';
import { z } from 'zod';

/**
 * Bulk post actions (legacy Posts list parity). Each item runs through the same
 * per-post service as the single action, so role, authorship, channel scope,
 * state and provider-neutral publication journal rules apply to every post.
 * Bulk deletion is local-only: remote deletion stays a per-post, explicit choice.
 * Retry re-dispatches only destinations recorded as failed with no remote ID;
 * submitted/uncertain/processing destinations are never re-sent.
 */
export const BULK_ACTIONS = ['delete', 'duplicate', 'reschedule', 'retry'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const BULK_BOUNDS = { maxPosts: 50 } as const;
export const bulkConfirmation = (action: BulkAction, count: number) => `${action.toUpperCase()} ${count} POSTS`;

export const BULK_SCHEMA = z.object({
  action: z.enum(BULK_ACTIONS),
  postIds: z.array(z.string().min(1).max(120)).min(1).max(BULK_BOUNDS.maxPosts),
  requestId: z.string().uuid(),
  confirmation: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
}).strict();
export type BulkInput = z.output<typeof BULK_SCHEMA>;

export type BulkItemOutcome = 'done' | 'needs_review' | 'skipped' | 'failed';
export type BulkItemResult = { postId: string; outcome: BulkItemOutcome; code?: string; message?: string; newPostId?: string };
export type BulkResult = { action: BulkAction; requested: number; done: number; needsReview: number; skipped: number; failed: number; items: BulkItemResult[] };

/** Destination statuses a retry may re-dispatch; everything else is held. */
export function retryableDestinationCount(post: { status: string; targets: Array<{ status: string; remotePostId?: string | null }> }) {
  if (post.status !== 'failed' && post.status !== 'partially_failed') return 0;
  return post.targets.filter(target => target.status === 'failed' && !target.remotePostId).length;
}

export function summarizeBulk(action: BulkAction, items: BulkItemResult[]): BulkResult {
  const count = (outcome: BulkItemOutcome) => items.filter(item => item.outcome === outcome).length;
  return { action, requested: items.length, done: count('done'), needsReview: count('needs_review'), skipped: count('skipped'), failed: count('failed'), items };
}

export type BulkLocale = 'en' | 'fr';
export const BULK_COPY = {
  en: actionBulkCopy(publishingActionText(publishingActionCopy, 'en')),
  fr: actionBulkCopy(publishingActionText(publishingActionCopy, 'fr')),
};
export const bulkCopy = (locale: string | null | undefined) => BULK_COPY[locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en'];
