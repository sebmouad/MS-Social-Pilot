import { Locale, WorkspaceRole } from '@prisma/client';

import { prisma } from '../prisma';
import { canApprove } from '../constants';
import { sendEmail } from './send';
import {
  approvalDecisionEmail,
  approvalRequestEmail,
  connectionExpiredEmail,
  publishFailureEmail,
  tokenExpiringEmail,
} from './templates';

/**
 * Who gets told about what.
 *
 * Every function here resolves recipients from NotificationSetting, which is
 * per user *per workspace* — an agency owner managing eight clients should not
 * be emailed about all eight unless they asked to be.
 *
 * Nothing here throws. These are called from the worker mid-publish and from
 * request handlers after the important write has already committed; a mail
 * problem must not undo either.
 */

type Preference = 'onPublishFailure' | 'onTokenExpiry' | 'onApprovalRequest' | 'onApprovalDecision';

interface Recipient {
  email: string;
  name: string;
  locale: Locale;
}

/**
 * Members of a workspace who opted into `preference`.
 *
 * Absence of a NotificationSetting row means "not yet configured", which is
 * treated as opted *in*: a new workspace must warn about failures before
 * anyone has visited the settings screen.
 */
async function recipientsFor(
  workspaceId: string,
  preference: Preference,
  options: { roles?: WorkspaceRole[] } = {},
): Promise<Recipient[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      workspaceId,
      ...(options.roles ? { role: { in: options.roles } } : {}),
    },
    include: { user: true },
  });

  const settings = await prisma.notificationSetting.findMany({ where: { workspaceId } });
  const byUser = new Map(settings.map((setting) => [setting.userId, setting]));

  return memberships
    .filter((membership) => {
      const setting = byUser.get(membership.userId);
      return setting ? setting[preference] : true;
    })
    .map((membership) => ({
      email: membership.user.email,
      name: membership.user.name,
      locale: membership.user.locale,
    }));
}

async function safely(action: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`[notify] ${label} failed`, error);
  }
}

/** A scheduled post could not be published to a destination. */
export async function notifyPublishFailure(options: {
  workspaceId: string;
  targetName: string;
  reason: string;
  scheduledAt: Date | null;
  postId: string;
}): Promise<void> {
  await safely(async () => {
    const workspace = await prisma.workspace.findUnique({ where: { id: options.workspaceId } });
    if (!workspace) return;

    const recipients = await recipientsFor(options.workspaceId, 'onPublishFailure');

    for (const recipient of recipients) {
      const rendered = publishFailureEmail({
        locale: recipient.locale,
        workspace: workspace.name,
        target: options.targetName,
        scheduledAt: options.scheduledAt,
        timezone: workspace.timezone,
        reason: options.reason,
        postId: options.postId,
      });
      await sendEmail({
        to: recipient.email,
        template: 'publishFailure',
        workspaceId: options.workspaceId,
        ...rendered,
      });
    }
  }, 'publish failure');
}

/** A Facebook connection was revoked or expired. */
export async function notifyConnectionExpired(options: {
  workspaceId: string;
  accountName: string;
}): Promise<void> {
  await safely(async () => {
    const workspace = await prisma.workspace.findUnique({ where: { id: options.workspaceId } });
    if (!workspace) return;

    // Only people who could actually fix it — reconnecting needs admin rights.
    const recipients = await recipientsFor(options.workspaceId, 'onPublishFailure', {
      roles: [WorkspaceRole.owner, WorkspaceRole.admin],
    });

    for (const recipient of recipients) {
      const rendered = connectionExpiredEmail({
        locale: recipient.locale,
        workspace: workspace.name,
        account: options.accountName,
      });
      await sendEmail({
        to: recipient.email,
        template: 'connectionExpired',
        workspaceId: options.workspaceId,
        ...rendered,
      });
    }
  }, 'connection expired');
}

/** A token is approaching expiry — sent before posting breaks, not after. */
export async function notifyTokenExpiring(options: {
  workspaceId: string;
  accountName: string;
  expiresAt: Date;
  days: number;
}): Promise<void> {
  await safely(async () => {
    const workspace = await prisma.workspace.findUnique({ where: { id: options.workspaceId } });
    if (!workspace) return;

    const recipients = await recipientsFor(options.workspaceId, 'onTokenExpiry', {
      roles: [WorkspaceRole.owner, WorkspaceRole.admin],
    });

    for (const recipient of recipients) {
      const rendered = tokenExpiringEmail({
        locale: recipient.locale,
        workspace: workspace.name,
        account: options.accountName,
        expiresAt: options.expiresAt,
        days: options.days,
        timezone: workspace.timezone,
      });
      await sendEmail({
        to: recipient.email,
        template: 'tokenExpiring',
        workspaceId: options.workspaceId,
        ...rendered,
      });
    }
  }, 'token expiring');
}

/** Someone submitted a post for review. */
export async function notifyApprovalRequest(options: {
  workspaceId: string;
  authorName: string;
  scheduledAt: Date | null;
}): Promise<void> {
  await safely(async () => {
    const workspace = await prisma.workspace.findUnique({ where: { id: options.workspaceId } });
    if (!workspace) return;

    const approverRoles = (Object.values(WorkspaceRole) as WorkspaceRole[]).filter(canApprove);
    const recipients = await recipientsFor(options.workspaceId, 'onApprovalRequest', {
      roles: approverRoles,
    });

    for (const recipient of recipients) {
      const rendered = approvalRequestEmail({
        locale: recipient.locale,
        workspace: workspace.name,
        author: options.authorName,
        scheduledAt: options.scheduledAt,
        timezone: workspace.timezone,
      });
      await sendEmail({
        to: recipient.email,
        template: 'approvalRequest',
        workspaceId: options.workspaceId,
        ...rendered,
      });
    }
  }, 'approval request');
}

/** A submitted post was approved or sent back. Goes to its author only. */
export async function notifyApprovalDecision(options: {
  workspaceId: string;
  authorId: string;
  reviewerName: string;
  approved: boolean;
  note?: string | null;
  scheduledAt: Date | null;
}): Promise<void> {
  await safely(async () => {
    const [workspace, author, setting] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: options.workspaceId } }),
      prisma.user.findUnique({ where: { id: options.authorId } }),
      prisma.notificationSetting.findUnique({
        where: { userId_workspaceId: { userId: options.authorId, workspaceId: options.workspaceId } },
      }),
    ]);

    if (!workspace || !author) return;
    if (setting && !setting.onApprovalDecision) return;

    const rendered = approvalDecisionEmail({
      locale: author.locale,
      workspace: workspace.name,
      reviewer: options.reviewerName,
      approved: options.approved,
      note: options.note,
      scheduledAt: options.scheduledAt,
      timezone: workspace.timezone,
    });

    await sendEmail({
      to: author.email,
      template: 'approvalDecision',
      workspaceId: options.workspaceId,
      ...rendered,
    });
  }, 'approval decision');
}
