import { z } from 'zod';

export type NotificationActor = { userId: string; workspaceId: string };
export const NOTIFICATION_EVENTS = ['note_mention', 'mix_dry'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export type NotificationMute = { targetId: string; event: 'queueEmpty' };

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const notificationPreferenceUpdateSchema = z.object({
  onNoteMention: z.boolean().optional(),
  onQueueEmpty: z.boolean().optional(),
  mutes: z.array(z.object({ targetId: identifier, event: z.literal('queueEmpty') }).strict()).max(5000).optional(),
  confirmation: z.string().max(500),
}).strict().refine(value => value.onNoteMention !== undefined || value.onQueueEmpty !== undefined || value.mutes !== undefined);
export type NotificationPreferenceUpdate = z.infer<typeof notificationPreferenceUpdateSchema>;

export const notificationPageSchema = z.object({ page: z.number().int().min(1).max(10000).optional(), unreadOnly: z.boolean().optional() }).strict();
export const notificationIdActionSchema = z.object({ id: identifier, confirmation: z.string().max(500) }).strict();
export const notificationEnqueueSchema = z.object({
  eventId: identifier,
  workspaceId: identifier,
  userId: identifier,
  kind: z.enum(NOTIFICATION_EVENTS),
  postId: identifier.optional(), noteId: identifier.optional(), targetId: identifier.optional(), labelId: identifier.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'note_mention' && (!value.postId || !value.noteId)) ctx.addIssue({ code: 'custom', message: 'A note mention requires a post and note.' });
  if (value.kind === 'mix_dry' && !value.targetId) ctx.addIssue({ code: 'custom', message: 'A dry content mix requires a selected target.' });
});
export type NotificationEnqueueInput = z.infer<typeof notificationEnqueueSchema>;

export const notificationConfirmation = {
  updatePreferences: () => 'UPDATE NOTIFICATION PREFERENCES',
  read: (id: string) => `READ NOTIFICATION ${id}`,
  delete: (id: string) => `DELETE NOTIFICATION ${id}`,
} as const;

export type NotificationPreferenceView = {
  preferences: { onNoteMention: boolean; onQueueEmpty: boolean };
  configured: boolean;
  mutes: NotificationMute[];
  channels: Array<{ id: string; name: string }>;
  maxMutes: number;
};
export type NotificationRow = {
  id: string; kind: NotificationEvent; createdAt: Date; updatedAt: Date; readAt: Date | null; emailSentAt: Date | null;
  emailState: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';
  title: string; body: string; available: boolean; postId: string | null; noteId: string | null; targetId: string | null; labelId: string | null;
};
export type NotificationPage = { items: NotificationRow[]; page: number; pageSize: number; hasMore: boolean };
