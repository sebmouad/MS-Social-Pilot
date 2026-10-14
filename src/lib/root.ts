import { Prisma, WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { errors } from './errors';
import { verifyPassword } from './crypto';
import { sendEmail } from './email/send';
import { clientInvitationEmail, rootTransferEmail } from './email/templates';
import { env } from './env';
import { hashToken, randomToken } from './crypto';
import { clearSecondFactors } from './two-step';
import { ACCESS_SWITCH_KEYS, isAccessSwitchKey, type AccessSwitchKey } from './modules';
import { lockWorkspaceOwners } from './owner-guard';

/**
 * What root can do to the whole installation, from the root section
 * (`/root/*`): see every workspace and user, disable or sign out an account,
 * rename a workspace, revoke any invitation, hand root to someone else.
 *
 * Root also runs each client: suspends or resumes a workspace, switches
 * modules off for a workspace or for one member, adds, re-roles and removes
 * members, and opens any workspace as its owner (a "visit", see
 * `startRootVisit` in auth.ts). Nothing in this file reads a workspace's posts,
 * Pages or tokens itself; a visit goes through the normal screens.
 * Every change is written to `RootActivity`.
 */

export const ROOT_ACTIONS = [
  'config.changed',
  'user.disabled',
  'user.enabled',
  'user.signedOut',
  'session.signedOut',
  'user.twoStepReset',
  'workspace.renamed',
  'workspace.created',
  'workspace.deleted',
  'user.deleted',
  'invitation.revoked',
  'client.invited',
  'client.invitationRevoked',
  'root.transferred',
  'workspace.suspended',
  'workspace.resumed',
  'workspace.modulesChanged',
  'workspace.developerFeatures',
  'workspace.visited',
  'member.added',
  'member.roleChanged',
  'member.modulesChanged',
  'member.removed',
  'plan.changed',
  'subscriber.planChanged',
  'changelog.added',
  'changelog.removed',
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
      suspendedAt: true,
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
    suspended: row.suspendedAt !== null,
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

/**
 * A lost phone: clear someone's second step and end their sessions. Root's
 * own is reset only from the server (scripts/admin/reset-two-step.ts), so a
 * stolen root session cannot strip root's protection.
 */
export async function resetTwoStepFor(actorId: string, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw errors.notFound();
  if (user.isInstanceOwner) throw errors.rootCannotBeDisabled();
  await clearSecondFactors(userId);
  await prisma.session.deleteMany({ where: { userId } });
  await logRootActivity(actorId, 'user.twoStepReset', { email: user.email });
}

export async function renameWorkspace(actorId: string, workspaceId: string, name: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw errors.notFound();
  await prisma.workspace.update({ where: { id: workspaceId }, data: { name } });
  await logRootActivity(actorId, 'workspace.renamed', { from: workspace.name, to: name });
}

/** A new workspace for an existing account, which becomes its owner. */
export async function createWorkspaceAsRoot(actorId: string, name: string, ownerEmail: string): Promise<{ id: string }> {
  const owner = await prisma.user.findUnique({ where: { email: ownerEmail.toLowerCase() } });
  if (!owner) throw errors.noUserWithEmail();
  const { createWorkspace } = await import('./auth');
  const workspace = await createWorkspace({ name, ownerId: owner.id });
  await logRootActivity(actorId, 'workspace.created', { name, owner: owner.email });
  return { id: workspace.id };
}

/** Delete a workspace and everything in it. Its members keep their accounts. */
export async function deleteWorkspaceAsRoot(actorId: string, workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw errors.notFound();
  await prisma.workspace.delete({ where: { id: workspaceId } });
  await logRootActivity(actorId, 'workspace.deleted', { name: workspace.name });
}

/**
 * Delete an account. Posts and invitations it made stay with their
 * workspaces, credited to root; a workspace it alone owns must be handed on
 * or deleted first, so no workspace is left without an owner.
 */
export async function deleteUserAsRoot(actorId: string, userId: string): Promise<void> {
  const user = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({ where: { id: userId } });
    if (!account) throw errors.notFound();
    if (account.isInstanceOwner) throw errors.rootCannotBeDisabled();
    const memberships = await tx.membership.findMany({ where: { userId }, select: { workspaceId: true } });
    for (const workspaceId of memberships.map((m) => m.workspaceId).sort()) await lockWorkspaceOwners(tx, workspaceId);
    const owned = await tx.membership.findMany({ where: { userId, role: WorkspaceRole.owner }, select: { workspaceId: true } });
    for (const { workspaceId } of owned) {
      const owners = await tx.membership.count({ where: { workspaceId, role: WorkspaceRole.owner } });
      if (owners <= 1) throw errors.soleOwner();
    }
    await tx.post.updateMany({ where: { authorId: userId }, data: { authorId: actorId } });
    await tx.post.updateMany({ where: { submittedById: userId }, data: { submittedById: null } });
    await tx.post.updateMany({ where: { reviewedById: userId }, data: { reviewedById: null } });
    await tx.invitation.updateMany({ where: { invitedById: userId }, data: { invitedById: actorId } });
    await tx.user.delete({ where: { id: userId } });
    return account;
  }, { timeout: 30_000 });
  await logRootActivity(actorId, 'user.deleted', { email: user.email });
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

const CLIENT_INVITATION_DAYS = 14;

/**
 * Invite a client to create an account with a workspace of their own — kept
 * apart from every other workspace like any client. The link is returned as
 * well as emailed, so root can send it another way when email is not set up.
 */
export async function inviteClient(options: {
  actorId: string;
  email: string;
  workspaceName: string | null;
}): Promise<{ id: string; url: string; emailed: boolean }> {
  const email = options.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw errors.emailTaken();

  const actor = await prisma.user.findUniqueOrThrow({ where: { id: options.actorId } });
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + CLIENT_INVITATION_DAYS * 24 * 60 * 60 * 1000);
  // A new invitation to the same address replaces the old one.
  await prisma.clientInvitation.deleteMany({ where: { email, acceptedAt: null } });
  const invitation = await prisma.clientInvitation.create({
    data: { email, tokenHash: hashToken(token), workspaceName: options.workspaceName?.trim() || null, invitedById: actor.id, expiresAt },
  });

  const message = clientInvitationEmail({ locale: actor.locale, inviter: actor.name, token, expiresAt });
  const sent = await sendEmail({ to: email, template: 'client.invitation', ...message });
  await logRootActivity(actor.id, 'client.invited', { email });
  return { id: invitation.id, url: `${env.appUrl}/register?client=${token}`, emailed: sent.status === 'sent' };
}

export async function findClientInvitation(token: string) {
  const invitation = await prisma.clientInvitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) return null;
  return invitation;
}

export async function listClientInvitations() {
  const rows = await prisma.clientInvitation.findMany({
    where: { acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    workspaceName: row.workspaceName,
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeClientInvitation(actorId: string, id: string): Promise<void> {
  const invitation = await prisma.clientInvitation.findUnique({ where: { id } });
  if (!invitation) throw errors.notFound();
  await prisma.clientInvitation.delete({ where: { id } });
  await logRootActivity(actorId, 'client.invitationRevoked', { email: invitation.email });
}

/** One workspace as root manages it: switches, members and their modules. */
export async function workspaceDetail(workspaceId: string) {
  const row = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      suspendedAt: true,
      disabledModules: true,
      developerFeatures: true,
      _count: { select: { targets: true, posts: true } },
      memberships: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          allPages: true,
          disabledModules: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, disabledAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    suspended: row.suspendedAt !== null,
    developerFeatures: row.developerFeatures,
    disabledModules: row.disabledModules.filter(isAccessSwitchKey),
    pages: row._count.targets,
    posts: row._count.posts,
    members: row.memberships.map((membership) => ({
      id: membership.id,
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      disabled: membership.user.disabledAt !== null,
      role: membership.role,
      allPages: membership.allPages,
      disabledModules: membership.disabledModules.filter(isAccessSwitchKey),
      createdAt: membership.createdAt.toISOString(),
    })),
  };
}

async function findWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw errors.notFound();
  return workspace;
}

export async function setWorkspaceSuspended(actorId: string, workspaceId: string, suspended: boolean): Promise<void> {
  const workspace = await findWorkspace(workspaceId);
  if ((workspace.suspendedAt !== null) === suspended) return;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { suspendedAt: suspended ? new Date() : null } });
  await logRootActivity(actorId, suspended ? 'workspace.suspended' : 'workspace.resumed', { workspace: workspace.name });
}

export async function setWorkspaceModules(actorId: string, workspaceId: string, disabled: AccessSwitchKey[]): Promise<void> {
  const workspace = await findWorkspace(workspaceId);
  const off = ACCESS_SWITCH_KEYS.filter((key) => disabled.includes(key));
  await prisma.workspace.update({ where: { id: workspaceId }, data: { disabledModules: off } });
  await logRootActivity(actorId, 'workspace.modulesChanged', { workspace: workspace.name, off: off.join(', ') || '—' });
}

/** API keys, MCP and outgoing webhooks for this workspace's owner (off by default). */
export async function setWorkspaceDeveloperFeatures(actorId: string, workspaceId: string, on: boolean): Promise<void> {
  const workspace = await findWorkspace(workspaceId);
  if (workspace.developerFeatures === on) return;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { developerFeatures: on } });
  await logRootActivity(actorId, 'workspace.developerFeatures', { workspace: workspace.name, on: on ? 'on' : 'off' });
}

/** Root adds someone who already has an account; anyone else gets an invitation. */
export async function addMember(actorId: string, workspaceId: string, email: string, role: WorkspaceRole): Promise<void> {
  const workspace = await findWorkspace(workspaceId);
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw errors.rootNoSuchUser();
  const existing = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (existing) throw errors.rootAlreadyMember();
  await prisma.membership.create({ data: { userId: user.id, workspaceId, role } });
  await logRootActivity(actorId, 'member.added', { email: user.email, workspace: workspace.name, role });
}

async function findMembership(membershipId: string) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { email: true } }, workspace: { select: { name: true } } },
  });
  if (!membership) throw errors.notFound();
  return membership;
}

/** A workspace always keeps an owner: the last one cannot be re-roled or removed. */
async function assertNotLastOwner(tx: Prisma.TransactionClient, membership: { workspaceId: string; role: WorkspaceRole }) {
  if (membership.role !== WorkspaceRole.owner) return;
  const owners = await tx.membership.count({
    where: { workspaceId: membership.workspaceId, role: WorkspaceRole.owner },
  });
  if (owners <= 1) throw errors.rootLastOwner();
}

export async function changeMemberRole(actorId: string, membershipId: string, role: WorkspaceRole): Promise<void> {
  const membership = await findMembership(membershipId);
  if (membership.role === role) return;
  await prisma.$transaction(async (tx) => {
    await lockWorkspaceOwners(tx, membership.workspaceId);
    const current = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!current) throw errors.notFound();
    await assertNotLastOwner(tx, current);
    await tx.membership.update({ where: { id: membershipId }, data: { role } });
  });
  await logRootActivity(actorId, 'member.roleChanged', {
    email: membership.user.email,
    workspace: membership.workspace.name,
    from: membership.role,
    to: role,
  });
}

export async function setMemberModules(actorId: string, membershipId: string, disabled: AccessSwitchKey[]): Promise<void> {
  const membership = await findMembership(membershipId);
  const off = ACCESS_SWITCH_KEYS.filter((key) => disabled.includes(key));
  await prisma.membership.update({ where: { id: membershipId }, data: { disabledModules: off } });
  await logRootActivity(actorId, 'member.modulesChanged', {
    email: membership.user.email,
    workspace: membership.workspace.name,
    off: off.join(', ') || '—',
  });
}

export async function removeMemberAsRoot(actorId: string, membershipId: string): Promise<void> {
  const membership = await findMembership(membershipId);
  await prisma.$transaction(async (tx) => {
    await lockWorkspaceOwners(tx, membership.workspaceId);
    const current = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!current) throw errors.notFound();
    await assertNotLastOwner(tx, current);
    await tx.membership.delete({ where: { id: membershipId } });
  });
  await logRootActivity(actorId, 'member.removed', { email: membership.user.email, workspace: membership.workspace.name });
}

/** Logged before root opens a workspace as its owner. */
export async function logVisit(actorId: string, workspaceId: string): Promise<{ member: boolean }> {
  const workspace = await findWorkspace(workspaceId);
  const member = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actorId, workspaceId } },
  });
  await logRootActivity(actorId, 'workspace.visited', { workspace: workspace.name });
  return { member: member !== null };
}
