/** Product states are fixed persistence semantics, not configurable provider rules. */
export type FirstCommentState = 'not_requested' | 'awaiting_post' | 'ready' | 'sent' | 'needs_review';
export const FIRST_COMMENT_REJECTED = 'rebuild:first_comment_rejected';
export type FirstCommentRecord = {
  status: string;
  remotePostId: string | null;
  firstCommentId?: string | null;
  firstCommentAt?: Date | string | null;
  firstCommentError?: string | null;
};

export function firstCommentState(text: string | null | undefined, row: FirstCommentRecord): FirstCommentState {
  if (!text?.trim()) return 'not_requested';
  if (row.firstCommentId) return 'sent';
  // Legacy errors may have released their claim even after ambiguous acceptance.
  if (row.firstCommentAt || (row.firstCommentError && row.firstCommentError !== FIRST_COMMENT_REJECTED)) return 'needs_review';
  if (row.status !== 'published' || !row.remotePostId) return 'awaiting_post';
  return 'ready';
}

export const FIRST_COMMENT_LABELS: Record<FirstCommentState, string> = {
  not_requested: 'No first comment requested',
  awaiting_post: 'First comment awaits publication',
  ready: 'First comment has not been sent',
  sent: 'First comment recorded as sent',
  needs_review: 'First comment needs review',
};
