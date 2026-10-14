/**
 * Every kind of event the activity log records.
 *
 * A list rather than a free string, for two reasons. The history screen shows
 * a sentence per action, so an action with no copy behind it is a row reading
 * `post.updated` at somebody — and the compiler now refuses a new action until
 * it is named here, where the test that checks for the missing sentence can
 * see it. And a typo used to be silent: `post.retryed` would have been written
 * to the database and never matched anything again.
 */
export const ACTIVITY_ACTIONS = [
  'account.connected',
  'account.disconnected',
  'ads.discovered',
  'analytics.synced',
  'approvals.disabled',
  'comment.deleted',
  'comment.hidden',
  'comment.unhidden',
  'conversation.replied',
  'instagram.discovered',
  'moderation.ruleChanged',
  'moderation.undone',
  'captionTest.learned',
  'post.approved',
  'post.teamApproved',
  'post.bulkAction',
  'post.bulkUploaded',
  'post.cancelled',
  'post.deleted',
  'post.created',
  'post.recycleStopped',
  'post.recycled',
  'post.rejected',
  'post.retried',
  'post.remoteRemoved',
  'post.submitted',
  'post.undone',
  'post.updated',
  'post.withdrawn',
  'queue.bestTimesAdded',
  'queue.mixScheduled',
  'queue.mixUpdated',
  'settings.changed',
  'target.removed',
  'team.invitationRevoked',
  'team.invited',
  'team.joined',
  'team.pageAccessChanged',
  'team.removed',
  'team.roleChanged',
  'webhook.created',
  'webhook.deleted',
  'workspace.exported',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];
