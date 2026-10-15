import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import type { Prisma } from '../../generated/client';

export const TEAM_ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;
export type TeamRole = typeof TEAM_ROLES[number];

export type TeamActor = { userId: string; workspaceId: string };

function validateRole(role: string): asserts role is TeamRole {
  if (!TEAM_ROLES.includes(role as TeamRole)) throw new Error('Choose a valid team role.');
}

async function manager(tx: Prisma.TransactionClient, actor: TeamActor) {
  // Serialize membership changes per workspace so concurrent owner demotions
  // cannot both pass the last-owner count check.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
  const membership = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!membership) throw new Error('You are no longer a member of this workspace.');
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new Error('Only workspace owners and admins can manage the team.');
  return membership.role;
}

async function ensureOwnerInvariant(tx: Prisma.TransactionClient, workspaceId: string, membershipId: string, nextRole?: string) {
  const current = await tx.membership.findUnique({ where: { id: membershipId }, select: { role: true } });
  if (!current) throw new Error('This member is unavailable in the current workspace.');
  if (current.role === 'owner' && nextRole !== 'owner') {
    const count = await tx.membership.count({ where: { workspaceId, role: 'owner' } });
    if (count <= 1) throw new Error('A workspace must keep at least one owner.');
  }
}

export async function addTeamMember(actor: TeamActor, email: string, role: string, targetIds: string[], allPages: boolean) {
  validateRole(role);
  const address = email.trim().toLowerCase();
  if (!address || address.length > 320) throw new Error('Enter a valid email address.');
  return prisma.$transaction(async tx => {
    const actorRole = await manager(tx, actor);
    if (role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can assign the owner role.');
    const user = await tx.user.findUnique({ where: { email: address }, select: { id: true, disabledAt: true } });
    if (!user || user.disabledAt) throw new Error('No active account uses that email. Ask them to create an account first.');
    const existing = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: actor.workspaceId } }, select: { id: true } });
    if (existing) throw new Error('This person is already a workspace member.');
    const targets = await tx.target.findMany({ where: { id: { in: targetIds }, workspaceId: actor.workspaceId }, select: { id: true } });
    if (targets.length !== new Set(targetIds).size) throw new Error('One or more selected channels are unavailable.');
    const id = randomUUID();
    await tx.membership.create({ data: { id, userId: user.id, workspaceId: actor.workspaceId, role } });
    await tx.$executeRaw`UPDATE memberships SET "allPages" = ${allPages} WHERE id = ${id}`;
    if (targetIds.length) {
      await tx.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") SELECT ${id}, target_id FROM UNNEST(${targetIds}::text[]) AS target_id`;
    }
    await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'team.joined', ${JSON.stringify({ userId: user.id, role, targetIds, allPages })}::jsonb, NOW())`;
    return { id, role, name: user.id };
  });
}

export async function updateTeamMember(actor: TeamActor, membershipId: string, role: string, targetIds: string[], allPages: boolean) {
  validateRole(role);
  return prisma.$transaction(async tx => {
    const actorRole = await manager(tx, actor);
    const current = await tx.membership.findFirst({ where: { id: membershipId, workspaceId: actor.workspaceId }, select: { id: true, userId: true, role: true } });
    if (!current) throw new Error('This member is unavailable in the current workspace.');
    if (current.role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can manage an owner membership.');
    if (role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can assign the owner role.');
    if (current.userId === actor.userId && current.role !== role) throw new Error('You cannot change your own role.');
    await ensureOwnerInvariant(tx, actor.workspaceId, current.id, role);
    if (targetIds.length) {
      const targets = await tx.target.findMany({ where: { id: { in: targetIds }, workspaceId: actor.workspaceId }, select: { id: true } });
      if (targets.length !== new Set(targetIds).size) throw new Error('One or more selected channels are unavailable.');
    }
    await tx.membership.update({ where: { id: current.id }, data: { role } });
    await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${current.id}`;
    await tx.$executeRaw`UPDATE memberships SET "allPages" = ${allPages} WHERE id = ${current.id}`;
    if (targetIds.length) await tx.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") SELECT ${current.id}, target_id FROM UNNEST(${targetIds}::text[]) AS target_id`;
    await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'team.roleChanged', ${JSON.stringify({ userId: current.userId, previousRole: current.role, role, targetIds, allPages })}::jsonb, NOW())`;
  });
}

export async function removeTeamMember(actor: TeamActor, membershipId: string) {
  return prisma.$transaction(async tx => {
    const actorRole = await manager(tx, actor);
    const current = await tx.membership.findFirst({ where: { id: membershipId, workspaceId: actor.workspaceId }, select: { id: true, userId: true, role: true } });
    if (!current) throw new Error('This member is unavailable in the current workspace.');
    if (current.role === 'owner' && actorRole !== 'owner') throw new Error('Only an owner can manage an owner membership.');
    if (current.userId === actor.userId) throw new Error('You cannot remove your own workspace access.');
    await ensureOwnerInvariant(tx, actor.workspaceId, current.id);
    await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'team.removed', ${JSON.stringify({ userId: current.userId, role: current.role })}::jsonb, NOW())`;
    await tx.membership.delete({ where: { id: current.id } });
  });
}

export function teamErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('valid team role') || message.includes('valid email')) return 400;
  if (message.includes('already a workspace member') || message.includes('active account') || message.includes('must keep')) return 409;
  if (message.includes('Only workspace owners') || message.includes('Only an owner')) return 403;
  if (message.includes('member of this workspace')) return 401;
  if (message.includes('unavailable') || message.includes('selected channels')) return 404;
  return 500;
}
