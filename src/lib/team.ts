import { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { atLeast } from './constants';
import { hashToken, randomToken } from './crypto';
import { AppError, errors } from './errors';
import { sendEmail } from './email/send';
import { invitationEmail } from './email/templates';
import { logActivity } from './scheduler/runner';

/**
 * Team membership and invitations.
 *
 * Invitation tokens are stored hashed, exactly like session tokens: the raw
 * token exists only in the email. A database dump therefore cannot be used to
 * join someone's workspace.
 */

const INVITATION_TTL_DAYS = 7;

/**
 * Nobody may hand out, or take away, a role above their own.
 *
 * The capability check on the route only asks whether the caller may manage
 * the team at all, and admins may. That is not the same question as whether an
 * admin may create an owner. Owner is not a bigger admin: `canManageInstance`
 * is owner-only and deliberately not scoped to a workspace — it gates the Graph
 * credentials, the API version and the feature switches for every client on the
 * installation. An admin who can promote themselves, promote a friend, or
 * demote the owner standing above them has taken the installation, so the rank
 * is enforced in both directions, on the role being granted and on the member
 * being changed.
 */
function assertRankPermits(actorRole: WorkspaceRole, affectedRole: WorkspaceRole): void {
  if (!atLeast(actorRole, affectedRole)) throw errors.noPermission();
}

export class InvitationError extends AppError {}

export interface InvitationResult {
  id: string;
  email: string;
  emailSent: boolean;
  /** Returned so a dev instance without Resend can still complete the flow. */
  acceptUrl: string;
}

export async function inviteMember(options: {
  workspaceId: string;
  invitedById: string;
  /** The inviter's own role, so nobody invites somebody above themselves. */
  actorRole: WorkspaceRole;
  email: string;
  role: WorkspaceRole;
}): Promise<InvitationResult> {
  assertRankPermits(options.actorRole, options.role);

  const email = options.email.trim().toLowerCase();

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: options.workspaceId } }),
    prisma.user.findUniqueOrThrow({ where: { id: options.invitedById } }),
  ]);

  // Already a member: inviting again would create a confusing dead-end link.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId: options.workspaceId } },
    });
    if (membership) {
      throw new AppError({
        key: 'errors.alreadyMember',
        fallback: 'That person is already a member of this workspace.',
        status: 409,
      });
    }
  }

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Re-inviting the same address updates the pending row rather than creating
  // a second one, so the unique constraint holds and the newest link wins.
  const invitation = await prisma.invitation.upsert({
    where: { workspaceId_email: { workspaceId: options.workspaceId, email } },
    create: {
      workspaceId: options.workspaceId,
      email,
      role: options.role,
      tokenHash: hashToken(token),
      invitedById: options.invitedById,
      expiresAt,
    },
    update: {
      role: options.role,
      tokenHash: hashToken(token),
      invitedById: options.invitedById,
      expiresAt,
      acceptedAt: null,
      acceptedByUserId: null,
    },
  });

  const rendered = invitationEmail({
    // Addressed to someone who may not have an account yet, so there is no
    // stored preference — the workspace's own language is the best guess.
    locale: workspace.defaultLocale,
    inviter: inviter.name,
    workspace: workspace.name,
    role: options.role,
    token,
    expiresAt,
    timezone: workspace.timezone,
  });

  const result = await sendEmail({
    to: email,
    template: 'invitation',
    workspaceId: options.workspaceId,
    ...rendered,
  });

  await logActivity(options.workspaceId, 'team.invited', { email, role: options.role }, options.invitedById);

  return {
    id: invitation.id,
    email,
    emailSent: result.status === 'sent',
    acceptUrl: `/invite/${token}`,
  };
}

export interface InvitationDetails {
  id: string;
  email: string;
  role: WorkspaceRole;
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  expiresAt: Date;
}

/** Look up an invitation by its raw token. Returns null for anything invalid. */
export async function findInvitation(token: string): Promise<InvitationDetails | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: true, invitedBy: true },
  });

  if (!invitation || invitation.acceptedAt) return null;

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    workspaceId: invitation.workspaceId,
    workspaceName: invitation.workspace.name,
    inviterName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accept an invitation for a signed-in user.
 *
 * The email must match. Otherwise anyone holding a forwarded link could join
 * with an account the inviter never intended to admit.
 */
export async function acceptInvitation(token: string, userId: string): Promise<string> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!invitation || invitation.acceptedAt) {
    throw new AppError({
      key: 'team.acceptInvalid',
      fallback: 'This invitation link is not valid.',
      status: 404,
    });
  }
  if (invitation.expiresAt < new Date()) {
    throw new AppError({
      key: 'team.acceptExpired',
      fallback: 'This invitation has expired. Ask for a new one.',
      status: 410,
    });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new AppError({
      key: 'team.acceptWrongEmail',
      fallback: `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      params: { email: invitation.email },
      status: 403,
    });
  }

  await prisma.$transaction([
    prisma.membership.upsert({
      where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
      create: { userId, workspaceId: invitation.workspaceId, role: invitation.role },
      update: { role: invitation.role },
    }),
    prisma.notificationSetting.upsert({
      where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
      create: { userId, workspaceId: invitation.workspaceId },
      update: {},
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedByUserId: userId },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveWorkspaceId: invitation.workspaceId },
    }),
  ]);

  await logActivity(invitation.workspaceId, 'team.joined', { userId }, userId);
  return invitation.workspaceId;
}

export async function revokeInvitation(workspaceId: string, invitationId: string): Promise<void> {
  const { count } = await prisma.invitation.deleteMany({ where: { id: invitationId, workspaceId } });
  if (count === 0) throw errors.notFound();
  await logActivity(workspaceId, 'team.invitationRevoked', { invitationId });
}

/**
 * Remove a member.
 *
 * The last owner cannot be removed: a workspace with no owner cannot be
 * administered, invited to, or deleted by anyone.
 */
export async function removeMember(
  workspaceId: string,
  userId: string,
  actorRole: WorkspaceRole,
): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  // Not a member here — including a member of another workspace.
  if (!membership) throw errors.notFound();

  assertRankPermits(actorRole, membership.role);

  if (membership.role === WorkspaceRole.owner) {
    const owners = await prisma.membership.count({
      where: { workspaceId, role: WorkspaceRole.owner },
    });
    if (owners <= 1) {
      throw new AppError({
        key: 'errors.lastOwner',
        fallback: 'A workspace must keep at least one owner.',
        status: 409,
      });
    }
  }

  await prisma.membership.delete({ where: { userId_workspaceId: { userId, workspaceId } } });
  await logActivity(workspaceId, 'team.removed', { userId });
}

export async function changeRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  actorRole: WorkspaceRole,
): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });

  // Both ends of the change: the role being granted, and the role being taken
  // away. Promoting somebody to owner and demoting the sitting owner arrive at
  // the same place.
  assertRankPermits(actorRole, role);
  assertRankPermits(actorRole, membership.role);

  // Same guard as removal, by another route: demoting the last owner would
  // leave the workspace unadministrable.
  if (membership.role === WorkspaceRole.owner && role !== WorkspaceRole.owner) {
    const owners = await prisma.membership.count({
      where: { workspaceId, role: WorkspaceRole.owner },
    });
    if (owners <= 1) {
      throw new AppError({
        key: 'errors.lastOwner',
        fallback: 'A workspace must keep at least one owner.',
        status: 409,
      });
    }
  }

  await prisma.membership.update({
    where: { userId_workspaceId: { userId, workspaceId } },
    data: { role },
  });
  await logActivity(workspaceId, 'team.roleChanged', { userId, role });
}

/**
 * Limit a member to some of the workspace's Pages, or give them all back.
 *
 * Only for people below admin: an admin can change anybody's access, their own
 * included, so limiting one would hold nothing (see `src/lib/page-access.ts`).
 * Ids that are not Pages of this workspace are dropped.
 */
export async function setPageAccess(
  workspaceId: string,
  userId: string,
  access: { all: boolean; targetIds: string[] },
  actorRole: WorkspaceRole,
): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });
  assertRankPermits(actorRole, membership.role);
  if (atLeast(membership.role, WorkspaceRole.admin) && !access.all) {
    throw new AppError({
      key: 'errors.adminsSeeAllPages',
      fallback: 'Owners and admins always have every Page. Change their role first.',
      status: 409,
    });
  }

  const targets = access.all
    ? []
    : await prisma.target.findMany({
        where: { workspaceId, id: { in: access.targetIds } },
        select: { id: true },
      });

  await prisma.$transaction([
    prisma.membership.update({ where: { id: membership.id }, data: { allPages: access.all } }),
    prisma.memberPageAccess.deleteMany({ where: { membershipId: membership.id } }),
    prisma.memberPageAccess.createMany({
      data: targets.map((target) => ({ membershipId: membership.id, targetId: target.id })),
    }),
  ]);
  await logActivity(workspaceId, 'team.pageAccessChanged', {
    userId,
    all: access.all,
    pages: targets.length,
  });
}
