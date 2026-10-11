import { Prisma, WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { errors } from './errors';
import { verifyPassword } from './crypto';
import { sendEmail } from './email/send';
import { rootTransferEmail } from './email/templates';

/**
 * What root can do to the whole installation, from the root section
 * (`/root/*`): see every workspace and user, disable or sign out an account,
 * rename a workspace, revoke any invitation, hand root to someone else.
 *
 * Root does not pass workspace checks here: opening another client's
 * workspace as root is an owner decision still to take (PERMISSIONS.md), so
 * nothing in this file reads or changes a workspace's posts, Pages or tokens.
 * Every change is written to `RootActivity`.
 */

export const ROOT_ACTIONS = [
  'config.changed',
  'user.disabled',
  'user.enabled',
  'user.signedOut',
  'workspace.renamed',
  'invitation.revoked',
  'root.transferred',
] as const;

export type RootAction = (typeof ROOT_ACTIONS)[number];

export async function logRootActivity(
  actorId: string | null,
  action: RootAction,
  detail: Prisma.InputJsonValue = {},
): Promise<void> {
  await prisma.rootActivity.create({ data: { actorId, action, detail } });
}

export async function rootOverview() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [workspaces, users, disabled, pages, pendingInvitations, scheduled, failed] = await Promise.all([
    prisma.workspace.count(),
    prisma.user.count(),
    prisma.user.count({ where: { disabledAt: { not: null } } }),
    prisma.target.count(),
    prisma.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.post.count({ where: { status: 'scheduled' } }),
    prisma.postTarget.count({ where: { status: 'failed', updatedAt: { gte: since } } }),
  ]);
  return { workspaces, users, disabled, pages, pendingInvitations, scheduled, failed };
}

export async function listWorkspaces() {
  const rows = await prisma.workspace.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      createdAt: true,
      _count: { select: { memberships: true, targets: true, posts: true } },
      memberships: {
        where: { role: WorkspaceRole.owner },
        select: { user: { select: { name: true, email: true } } },
        take: 3,
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
    members: row._count.memberships,
    pages: row._count.targets,
    posts: row._count.posts,
    owners: row.memberships.map((membership) => membership.user.name || membership.user.email),
  }));
}

export async function listUsers() {
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      name: true,
      isInstanceOwner: true,
      disabledAt: true,
      createdAt: true,
      memberships: { select: { role: true, workspace: { select: { name: true } } } },
      sessions: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    isRoot: row.isInstanceOwner,
    disabled: row.disabledAt !== null,
    createdAt: row.createdAt.toISOString(),
    lastSignIn: row.sessions[0]?.createdAt.toISOString() ?? null,
    memberships: row.memberships.map((membership) => ({ workspace: membership.workspace.name, role: membership.role })),
  }));
}

/** Disable or re-enable an account. Disabling also ends every session it has. */
export async function setUserDisabled(actorId: string, userId: string, disabled: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw errors.notFound();
  // Root locking itself out would leave the installation with nobody to undo it.
  if (user.isInstanceOwner) throw errors.rootCannotBeDisabled();

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null } }),
    ...(disabled ? [prisma.session.deleteMany({ where: { userId } })] : []),
  ]);
  await logRootActivity(actorId, disabled ? 'user.disabled' : 'user.enabled', { email: user.email });
}

/** End every session of an account: the next request from any of its browsers is signed out. */
export async function signOutUser(actorId: string, userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw errors.notFound();
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  await logRootActivity(actorId, 'user.signedOut', { email: user.email, sessions: count });
  return count;
}

export async function renameWorkspace(actorId: string, workspaceId: string, name: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw errors.notFound();
  await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
  await logRootActivity(actorId, 'workspace.renamed', { from: workspace.name, to: name });
}

/** Invitations still waiting, in every workspace. */
export async function listInvitations() {
  const rows = await prisma.invitation.findMany({
    where: { acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      workspace: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    workspace: row.workspace.name,
    invitedBy: row.invitedBy.name || row.invitedBy.email,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeInvitation(actorId: string, invitationId: string): Promise<void> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    include: { workspace: { select: { name: true } } },
  });
  if (!invitation) throw errors.notFound();
  await prisma.invitation.delete({ where: { id: invitationId } });
  await logRootActivity(actorId, 'invitation.revoked', { email: invitation.email, workspace: invitation.workspace.name });
}

/**
 * Hand root to another account, confirmed with root's own password. Both
 * people are emailed when email is set up. There is no way back from the web:
 * the new root can hand it back, or the server's operator can run
 * `scripts/admin/set-root.ts` over SSH.
 */
export async function transferRoot(options: { actorId: string; password: string; toUserId: string }): Promise<void> {
  const actor = await prisma.user.findUnique({ where: { id: options.actorId } });
  if (!actor?.isInstanceOwner) throw errors.notFound();
  if (!verifyPassword(options.password, actor.passwordHash)) throw errors.currentPasswordWrong();

  const target = await prisma.user.findUnique({ where: { id: options.toUserId } });
  if (!target || target.id === actor.id) throw errors.notFound();
  if (target.disabledAt) throw errors.rootTargetDisabled();

  await prisma.$transaction([
    prisma.user.update({ where: { id: actor.id }, data: { isInstanceOwner: false } }),
    prisma.user.update({ where: { id: target.id }, data: { isInstanceOwner: true } }),
  ]);
  await logRootActivity(actor.id, 'root.transferred', { from: actor.email, to: target.email });

  for (const [person, forNewRoot] of [
    [target, true],
    [actor, false],
  ] as const) {
    const email = rootTransferEmail({ locale: person.locale, from: actor.name, to: target.name, forNewRoot });
    await sendEmail({ to: person.email, template: 'root.transferred', ...email });
  }
}

export async function listRootActivity(limit = 200) {
  const rows = await prisma.rootActivity.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action as RootAction,
    detail: (row.detail ?? {}) as Record<string, string | number>,
    actor: row.actor ? row.actor.name || row.actor.email : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Every member of every workspace with role, Page scope and last sign-in, for the privileges audit. */
export async function privilegesByMember(where: Prisma.MembershipWhereInput = {}) {
  const rows = await prisma.membership.findMany({
    where,
    orderBy: [{ workspace: { name: 'asc' } }, { createdAt: 'asc' }],
    select: {
      role: true,
      allPages: true,
      workspace: { select: { name: true } },
      user: {
        select: {
          name: true,
          email: true,
          isInstanceOwner: true,
          disabledAt: true,
          sessions: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
      _count: { select: { pages: true } },
    },
  });
  return rows.map((row) => ({
    workspace: row.workspace.name,
    name: row.user.name,
    email: row.user.email,
    isRoot: row.user.isInstanceOwner,
    disabled: row.user.disabledAt !== null,
    role: row.role,
    // Owners and admins always see every Page, whatever `allPages` says.
    pages: row.allPages || row.role === WorkspaceRole.owner || row.role === WorkspaceRole.admin ? null : row._count.pages,
    lastSignIn: row.user.sessions[0]?.createdAt.toISOString() ?? null,
  }));
}
