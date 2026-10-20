import { z } from 'zod';

export type NotificationActor = { userId: string; workspaceId: string };
export const NOTIFICATION_EVENTS = ['note_mention', 'mix_dry', 'publish_failure', 'connection_expired', 'token_expiring', 'approval_request', 'approval_decision', 'inbox_digest', 'queue_empty', 'draft_updated', 'moderation_alert', 'negative_spike'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export type NotificationMute = { targetId: string; event: 'queueEmpty' };

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const notificationPreferenceUpdateSchema = z.object({
  onPublishFailure: z.boolean().optional(),
  onTokenExpiry: z.boolean().optional(),
  onApprovalRequest: z.boolean().optional(),
  onApprovalDecision: z.boolean().optional(),
  onNewInbox: z.boolean().optional(),
  onDraftUpdated: z.boolean().optional(),
  onModerationAlert: z.boolean().optional(),
  onNoteMention: z.boolean().optional(),
  onQueueEmpty: z.boolean().optional(),
  mutes: z.array(z.object({ targetId: identifier, event: z.literal('queueEmpty') }).strict()).max(5000).optional(),
  confirmation: z.string().max(500),
}).strict().refine(value => (value.onNoteMention !== undefined || value.onQueueEmpty !== undefined || value.mutes !== undefined || value.onPublishFailure !== undefined || value.onTokenExpiry !== undefined || value.onApprovalRequest !== undefined || value.onApprovalDecision !== undefined || value.onNewInbox !== undefined || value.onDraftUpdated !== undefined || value.onModerationAlert !== undefined));
export type NotificationPreferenceUpdate = z.infer<typeof notificationPreferenceUpdateSchema>;

export const notificationPageSchema = z.object({ page: z.number().int().min(1).max(10000).optional(), unreadOnly: z.boolean().optional() }).strict();
export const notificationIdActionSchema = z.object({ id: identifier, confirmation: z.string().max(500) }).strict();
export const notificationEnqueueSchema = z.object({
  eventId: identifier,
  workspaceId: identifier,
  userId: identifier,
  kind: z.enum(NOTIFICATION_EVENTS),
  accountId: identifier.optional(), postId: identifier.optional(), noteId: identifier.optional(), targetId: identifier.optional(), labelId: identifier.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'note_mention' && (!value.postId || !value.noteId)) ctx.addIssue({ code: 'custom', message: 'A note mention requires a post and note.' });
  if (['publish_failure', 'approval_request', 'approval_decision', 'draft_updated'].includes(value.kind) && !value.postId) ctx.addIssue({ code: 'custom', message: 'This event requires a post.' });
  if (['connection_expired', 'token_expiring'].includes(value.kind) && !value.accountId) ctx.addIssue({ code: 'custom', message: 'This event requires a connection.' });
  if (['inbox_digest', 'queue_empty', 'moderation_alert', 'negative_spike'].includes(value.kind) && !value.targetId) ctx.addIssue({ code: 'custom', message: 'This event requires a channel.' });
  if (value.kind === 'mix_dry' && !value.targetId) ctx.addIssue({ code: 'custom', message: 'A dry content mix requires a selected target.' });
});
export type NotificationEnqueueInput = z.infer<typeof notificationEnqueueSchema>;

export const notificationConfirmation = {
  updatePreferences: () => 'UPDATE NOTIFICATION PREFERENCES',
  read: (id: string) => `READ NOTIFICATION ${id}`,
  delete: (id: string) => `DELETE NOTIFICATION ${id}`,
} as const;

export type NotificationPreferenceView = {
  locale?: 'en' | 'fr';
  preferences: { onNoteMention: boolean; onQueueEmpty: boolean; onPublishFailure?: boolean; onTokenExpiry?: boolean; onApprovalRequest?: boolean; onApprovalDecision?: boolean; onNewInbox?: boolean; onDraftUpdated?: boolean; onModerationAlert?: boolean };
  configured: boolean;
  mutes: NotificationMute[];
  channels: Array<{ id: string; name: string }>;
  maxMutes: number;
};
export type NotificationRow = {
  id: string; kind: NotificationEvent; createdAt: Date; updatedAt: Date; readAt: Date | null; emailSentAt: Date | null;
  emailState: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';
  accountId?: string | null; title: string; body: string; available: boolean; postId: string | null; noteId: string | null; targetId: string | null; labelId: string | null;
};
export type NotificationPage = { items: NotificationRow[]; page: number; pageSize: number; hasMore: boolean };
