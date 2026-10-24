
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { enqueueNotification, loadNotificationPolicy } from '@/modules/settings/notifications/server';
import type { MentionNotifierPort } from '@/modules/publishing/collaboration/ports';
import type { MixDryNotice } from '@/modules/publishing/collaboration/server/executors';
import { lockSelectedResources } from '@/server/platforms/resource-lock';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';

/** Composition boundary: Publishing owns the event; Settings owns personal
 * alert persistence and delivery. These hooks perform no SMTP or provider IO. */
export const publishingMentionNotifications: MentionNotifierPort = {
  async enqueueNoteMention(tx, input) {
    const errorText = await loadPublishingErrorText();
    const policy = await loadNotificationPolicy();
    const recipients = [...new Set(input.recipientIds)].filter(id => id !== input.authorId);
    if (recipients.length > policy.maxRecipientsPerEvent) throw new PublishingOperationError('invalid_request', 'chooseFewerPeopleToNotify', {}, errorText);
    let queued = 0;
    for (const userId of recipients) {
      const result = await enqueueNotification(tx, { eventId: `note_${input.noteId}`, workspaceId: input.workspaceId, userId,
        kind: 'note_mention', postId: input.postId, noteId: input.noteId });
      if (result.inserted) queued += 1;
    }
    return { queued };
  },
};

export async function enqueueMixDryNotifications(tx: Prisma.TransactionClient, notice: MixDryNotice & { eventId: string }) {
  const errorText = await loadPublishingErrorText();
  const policy = await loadNotificationPolicy();
  await lockPublishingTargets(tx, notice.workspaceId, [notice.targetId]);
  await lockSelectedResources(tx, notice.workspaceId, [{ kind: 'target', id: notice.targetId }]);
  const recipients = await tx.$queryRaw<Array<{ userId: string }>>`SELECT m."userId" FROM memberships m JOIN users u ON u.id=m."userId" WHERE m."workspaceId"=${notice.workspaceId} AND m.role::text IN ('owner','admin') AND u."disabledAt" IS NULL AND (m."allPages" OR EXISTS (SELECT 1 FROM member_page_access a WHERE a."membershipId"=m.id AND a."targetId"=${notice.targetId})) ORDER BY m.id ASC LIMIT ${policy.maxRecipientsPerEvent + 1}`;
  if (recipients.length > policy.maxRecipientsPerEvent) throw new PublishingOperationError('unavailable', 'theNotificationRecipientLimitNeedsReview', {}, errorText);
  for (const { userId } of recipients) {
    await enqueueNotification(tx, { eventId: notice.eventId, workspaceId: notice.workspaceId, userId, kind: 'mix_dry', targetId: notice.targetId, labelId: notice.labelId });
  }
}
