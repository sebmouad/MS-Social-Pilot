import { Locale, WorkspaceRole } from '@prisma/client';

import { prisma } from '../prisma';
import { sendChat } from '../chat';
import { canApprove } from '../constants';
import { mayUsePage, scopeOf, targetScope } from '../page-access';
import { sendEmail } from './send';
import {
  approvalDecisionEmail,
  approvalRequestEmail,
  connectionExpiredEmail,
  draftUpdatedEmail,
  inboxDigestEmail,
  publishFailureEmail,
  queueEmptyEmail,
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

type Preference = 'onPublishFailure' | 'onTokenExpiry' | 'onApprovalRequest' | 'onApprovalDecision' | 'onQueueEmpty' | 'onDraftUpdated';

/** Events a member can switch off for one Page (`NotificationMute.event`). */
export const PAGE_EVENTS = ['publishFailure', 'newInbox', 'queueEmpty'] as const;
export type PageEvent = (typeof PAGE_EVENTS)[number];

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
  options: { roles?: WorkspaceRole[]; page?: { targetId: string; event: PageEvent } } = {},
): Promise<Recipient[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      workspaceId,
      ...(options.roles ? { role: { in: options.roles } } : {}),
    },
    include: { user: true, pages: { select: { targetId: true } } },
  });

  const [settings, mutes] = await Promise.all([
    prisma.notificationSetting.findMany({ where: { workspaceId } }),
    options.page
      ? prisma.notificationMute.findMany({
          where: { targetId: options.page.targetId, event: options.page.event },
          select: { userId: true },
        })
      : [],
  ]);
  const byUser = new Map(settings.map((setting) => [setting.userId, setting]));
  const muted = new Set(mutes.map((mute) => mute.userId));

  return memberships
    .filter((membership) => {
      const setting = byUser.get(membership.userId);
      if (setting && !setting[preference]) return false;
      // About one Page: only members who may see it, and did not mute it.
      if (options.page) {
        if (!mayUsePage(scopeOf(membership), options.page.targetId)) return false;
        if (muted.has(membership.userId)) return false;
      }
      return true;
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
  targetId: string;
  targetName: string;
  reason: string;
  scheduledAt: Date | null;
  postId: string;
}): Promise<void> {
  await safely(async () => {
    const workspace = await prisma.workspace.findUnique({ where: { id: options.workspaceId } });
    if (!workspace) return;

    const recipients = await recipientsFor(options.workspaceId, 'onPublishFailure', {
      page: { targetId: options.targetId, event: 'publishFailure' },
    });

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
  await sendChat({
    workspaceId: options.workspaceId,
    event: 'publishFailure',
    key: 'publishFailure',
    params: { target: options.targetName, reason: options.reason.slice(0, 300) },
    path: '/posts?status=failed',
  });
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
  await sendChat({
    workspaceId: options.workspaceId,
    event: 'connectionExpired',
    key: 'connectionExpired',
    params: { account: options.accountName },
    path: '/connections',
  });
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
  await sendChat({
    workspaceId: options.workspaceId,
    event: 'approvalRequest',
    key: 'approvalRequest',
    params: { author: options.authorName },
    path: '/approvals',
  });
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
  await sendChat({
    workspaceId: options.workspaceId,
    event: 'approvalDecision',
    key: options.approved ? 'approved' : 'rejected',
    params: { reviewer: options.reviewerName },
    path: '/posts',
  });
}

/**
 * The hourly inbox email: for each member who asked for it, what people wrote
 * to their Pages (minus the Pages they muted) since the last one.
 *
 * Counted by when the sync first stored each comment or message, so a comment
 * written yesterday but read from Facebook this hour still counts, once. Only
 * what still waits: a comment someone already marked done is left out.
 * The first run after switching it on only sets the starting point.
 */
export async function sendInboxDigests(now: Date = new Date()): Promise<number> {
  const settings = await prisma.notificationSetting.findMany({
    where: { onNewInbox: true },
    include: { user: true, workspace: { select: { name: true } } },
  });

  let sent = 0;
  for (const setting of settings) {
    await safely(async () => {
      // Claimed first, so two workers never send the same hour twice.
      const { count: claimed } = await prisma.notificationSetting.updateMany({
        where: { id: setting.id, inboxDigestAt: setting.inboxDigestAt },
        data: { inboxDigestAt: now },
      });
      if (claimed === 0 || !setting.inboxDigestAt) return;
      const since = setting.inboxDigestAt;

      const membership = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: setting.userId, workspaceId: setting.workspaceId } },
        include: { pages: { select: { targetId: true } } },
      });
      if (!membership) return;
      const pages = await prisma.target.findMany({
        where: {
          workspaceId: setting.workspaceId,
          ...targetScope(scopeOf(membership)),
          notificationMutes: { none: { userId: setting.userId, event: 'newInbox' } },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      if (pages.length === 0) return;
      const ids = pages.map((page) => page.id);

      const [comments, messages] = await Promise.all([
        prisma.$queryRaw<Array<{ targetId: string; count: bigint }>>`
          SELECT pt."targetId", count(*) AS count
          FROM "post_comments" c
          JOIN "post_targets" pt ON pt."id" = c."postTargetId"
          JOIN "targets" t ON t."id" = pt."targetId"
          WHERE pt."targetId" = ANY(${ids}) AND c."firstSeenAt" > ${since} AND c."firstSeenAt" <= ${now}
            AND c."resolvedAt" IS NULL AND c."fromId" IS DISTINCT FROM t."providerId"
          GROUP BY pt."targetId"`,
        prisma.$queryRaw<Array<{ targetId: string; count: bigint }>>`
          SELECT cv."targetId", count(*) AS count
          FROM "conversation_messages" m
          JOIN "conversations" cv ON cv."id" = m."conversationId"
          JOIN "targets" t ON t."id" = cv."targetId"
          WHERE cv."targetId" = ANY(${ids}) AND m."firstSeenAt" > ${since} AND m."firstSeenAt" <= ${now}
            AND m."fromId" IS DISTINCT FROM t."providerId"
          GROUP BY cv."targetId"`,
      ]);
      const commentsBy = new Map(comments.map((row) => [row.targetId, Number(row.count)]));
      const messagesBy = new Map(messages.map((row) => [row.targetId, Number(row.count)]));
      const lines = pages
        .map((page) => ({ name: page.name, comments: commentsBy.get(page.id) ?? 0, messages: messagesBy.get(page.id) ?? 0 }))
        .filter((line) => line.comments + line.messages > 0);
      if (lines.length === 0) return;

      const rendered = inboxDigestEmail({ locale: setting.user.locale, workspace: setting.workspace.name, pages: lines });
      await sendEmail({ to: setting.user.email, template: 'inboxDigest', workspaceId: setting.workspaceId, ...rendered });
      sent += 1;
    }, 'inbox digest');
  }
  return sent;
}

/**
 * Pages whose queue ran dry: a Page that had a post scheduled ahead the last
 * time the worker looked, and now has none. Told once per time it runs dry
 * (filling it again re-arms it), to the members who schedule — owners,
 * admins and editors — who may see the Page and did not mute it.
 *
 * Database only, no Graph calls. Facebook-held posts count: they are
 * scheduled posts like any other.
 */
export async function notifyEmptyQueues(now: Date = new Date()): Promise<number> {
  const pages = await prisma.target.findMany({
    where: { enabled: true },
    select: { id: true, name: true, workspaceId: true, queueFilledAt: true, queueEmptyNotifiedAt: true },
  });
  if (pages.length === 0) return 0;

  const ahead = await prisma.postTarget.findMany({
    where: { targetId: { in: pages.map((page) => page.id) }, post: { status: 'scheduled', scheduledAt: { gt: now } } },
    select: { targetId: true },
    distinct: ['targetId'],
  });
  const filled = new Set(ahead.map((row) => row.targetId));

  // Seen with posts ahead: remember it, which arms the next notice.
  if (filled.size > 0) {
    await prisma.target.updateMany({ where: { id: { in: [...filled] } }, data: { queueFilledAt: now } });
  }

  let told = 0;
  for (const page of pages) {
    if (filled.has(page.id) || !page.queueFilledAt) continue;
    if (page.queueEmptyNotifiedAt && page.queueEmptyNotifiedAt >= page.queueFilledAt) continue;
    await safely(async () => {
      // Claimed first, so two workers never send it twice.
      const { count } = await prisma.target.updateMany({
        where: { id: page.id, queueEmptyNotifiedAt: page.queueEmptyNotifiedAt },
        data: { queueEmptyNotifiedAt: now },
      });
      if (count === 0) return;
      const workspace = await prisma.workspace.findUnique({ where: { id: page.workspaceId }, select: { name: true } });
      if (!workspace) return;
      const recipients = await recipientsFor(page.workspaceId, 'onQueueEmpty', {
        roles: [WorkspaceRole.owner, WorkspaceRole.admin, WorkspaceRole.editor],
        page: { targetId: page.id, event: 'queueEmpty' },
      });
      for (const recipient of recipients) {
        const rendered = queueEmptyEmail({
          locale: recipient.locale,
          workspace: workspace.name,
          page: page.name,
          targetId: page.id,
        });
        await sendEmail({ to: recipient.email, template: 'queueEmpty', workspaceId: page.workspaceId, ...rendered });
      }
      told += 1;
    }, 'queue empty');
  }
  return told;
}

/** Statuses of a post that is still being worked on. */
const UNSENT = new Set(['draft', 'pending_approval', 'rejected', 'scheduled']);

/**
 * Somebody else changed a post its author wrote before it went out. Goes to
 * the author only, at most one email an hour, so a colleague saving a draft
 * several times sends one note, not ten.
 */
export async function notifyDraftUpdated(options: {
  workspaceId: string;
  postId: string;
  authorId: string;
  editorId: string;
  editorName: string;
  /** The post's status before the save. */
  previousStatus: string;
  message: string | null;
  now?: Date;
}): Promise<boolean> {
  if (options.authorId === options.editorId || !UNSENT.has(options.previousStatus)) return false;
  let sent = false;
  await safely(async () => {
    const [workspace, membership, setting] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: options.workspaceId }, select: { name: true } }),
      prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: options.authorId, workspaceId: options.workspaceId } },
        include: { user: true },
      }),
      prisma.notificationSetting.findUnique({
        where: { userId_workspaceId: { userId: options.authorId, workspaceId: options.workspaceId } },
      }),
    ]);
    // Someone who left the workspace is not told about its posts.
    if (!workspace || !membership) return;
    if (setting && !setting.onDraftUpdated) return;

    const now = options.now ?? new Date();
    const recent = await prisma.emailLog.count({
      where: { to: membership.user.email, template: 'draftUpdated', createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
    if (recent > 0) return;

    const rendered = draftUpdatedEmail({
      locale: membership.user.locale,
      workspace: workspace.name,
      editor: options.editorName,
      excerpt: (options.message ?? '').slice(0, 140),
      postId: options.postId,
    });
    await sendEmail({ to: membership.user.email, template: 'draftUpdated', workspaceId: options.workspaceId, ...rendered });
    sent = true;
  }, 'draft updated');
  return sent;
}
