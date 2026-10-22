import { enqueueChatEvent } from '@/modules/notifications/chat-channels/server/delivery';
import type { ChatEvent } from '@/modules/notifications/chat-channels/contracts';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { enqueueNotification, loadNotificationPolicy } from './server';
import type { NotificationEnqueueInput } from './contracts';

/** Event producers call inside their state-change transaction; no external I/O. */
export async function emitWorkspaceAlert(tx: Prisma.TransactionClient, input: Omit<NotificationEnqueueInput, 'userId'> & { recipientId?: string }) {
  const chatEvents: Partial<Record<NotificationEnqueueInput['kind'], ChatEvent>> = {
    publish_failure: 'publishFailure', connection_expired: 'connectionExpired', token_expiring: 'connectionExpired',
    approval_request: 'approvalRequest', approval_decision: 'approvalDecision', inbox_digest: 'inboxAlert',
    moderation_alert: 'inboxAlert', negative_spike: 'inboxAlert',
  };
  const chatEvent = chatEvents[input.kind];
  const { recipientId: _chatRecipient, ...chatSource } = input;
  if (chatEvent) await enqueueChatEvent(tx, { workspaceId: input.workspaceId, eventId: input.eventId, event: chatEvent, source: chatSource });
  const policy = await loadNotificationPolicy();
  const recipients = await tx.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${input.workspaceId} AND u."disabledAt" IS NULL AND (${input.recipientId ?? null}::text IS NULL OR m."userId" = ${input.recipientId ?? null}) ORDER BY m.id LIMIT ${policy.maxRecipientsPerEvent + 1}`;
  if (recipients.length > policy.maxRecipientsPerEvent) throw new OperationError('unavailable', 'The notification recipient limit needs review.');
  const { recipientId: _recipientId, ...event } = input;
  let queued = 0;
  for (const { userId } of recipients) if ((await enqueueNotification(tx, { ...event, userId })).inserted) queued++;
  return { queued };
}
