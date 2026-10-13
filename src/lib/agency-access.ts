import { WorkspaceRole } from '@prisma/client';

import { changeRole, removeMember } from './team';
import { errors } from './errors';
import { prisma } from './prisma';
import { assertRoom } from './plans';
import { logActivity } from './scheduler/runner';

/**
 * The agency level: everything one person owns, side by side,
 * and who on their team reaches which client, with a role in each.
 *
 * An agency is simply the workspaces a person owns; each is one client. The
 * grid only moves people who are already on one of those workspaces between
 * them — newcomers are still invited, from a workspace's Team screen — and
 * never touches owners or the agency's own customers (the client role).
 */

export const GRANTABLE_ROLES = [WorkspaceRole.admin, WorkspaceRole.editor, WorkspaceRole.contributor, WorkspaceRole.viewer] as const;
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export async function agencyOverview(ownerId: string) {
  const clients = await prisma.workspace.findMany({
    where: { memberships: { some: { userId: ownerId, role: WorkspaceRole.owner } } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      _count: { select: { targets: true, posts: { where: { status: 'scheduled' } } } },
      memberships: { select: { userId: true, role: true, user: { select: { name: true, email: true } } } },
    },
  });

  const people = new Map<string, { id: string; name: string; email: string; roles: Record<string, WorkspaceRole> }>();
  for (const client of clients) {
    for (const member of client.memberships) {
      if (member.userId === ownerId || member.role === WorkspaceRole.client) continue;
      const person = people.get(member.userId) ?? { id: member.userId, name: member.user.name, email: member.user.email, roles: {} };
      person.roles[client.id] = member.role;
      people.set(member.userId, person);
    }
  }

  return {
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      logoUrl: client.logoUrl,
      channels: client._count.targets,
      scheduled: client._count.posts,
    })),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Give a team member a role in one of the owner's clients, change it, or take it away (`null`). */
export async function setClientAccess(options: { ownerId: string; workspaceId: string; userId: string; role: GrantableRole | null }): Promise<void> {
  const { ownerId, workspaceId, userId, role } = options;
  const owns = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: ownerId, workspaceId } } });
  if (owns?.role !== WorkspaceRole.owner) throw errors.notFound();

  // Only people already on this owner's team: the agency is not a way to add strangers.
  const onTeam = await prisma.membership.findFirst({
    where: {
      userId,
      role: { notIn: [WorkspaceRole.owner, WorkspaceRole.client] },
      workspace: { memberships: { some: { userId: ownerId, role: WorkspaceRole.owner } } },
    },
  });
  if (!onTeam) throw errors.notFound();

  const current = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
  if (current && (current.role === WorkspaceRole.owner || current.role === WorkspaceRole.client)) throw errors.notFound();

  if (role === null) {
    if (current) await removeMember(workspaceId, userId, WorkspaceRole.owner);
    return;
  }
  if (current) {
    if (current.role !== role) await changeRole(workspaceId, userId, role, WorkspaceRole.owner);
    return;
  }
  await assertRoom(workspaceId, 'members');
  await prisma.membership.create({ data: { userId, workspaceId, role } });
  await logActivity(workspaceId, 'team.joined', { userId, role, via: 'agency' }, ownerId);
}
