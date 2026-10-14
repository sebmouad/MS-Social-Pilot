import { prisma } from "./data";

const MANAGER_ROLES = new Set(["owner", "admin"]);
export type ConnectionMutationActor = { userId: string; workspaceId: string };

/** Toggle a discovered destination within the actor's current workspace. */
export async function setTargetSelection(actor: ConnectionMutationActor, targetId: string, enabled: boolean) {
  const membership = await currentMembership(actor);
  if (!MANAGER_ROLES.has(membership.role)) throw new Error("Only workspace owners and admins can change connections.");
  const target = await prisma.target.findFirst({
    where: { id: targetId, workspaceId: actor.workspaceId },
    select: { id: true, socialAccountId: true },
  });
  if (!target) throw new Error("This channel is unavailable in the current workspace.");
  if (enabled && !target.socialAccountId) throw new Error("Reconnect this source before selecting it.");
  if (enabled && target.socialAccountId) {
    const source = await prisma.socialAccount.findFirst({
      where: { id: target.socialAccountId, workspaceId: actor.workspaceId, invalidatedAt: null },
      select: { id: true },
    });
    if (!source) throw new Error("Reconnect this source before selecting it.");
  }
  await prisma.target.updateMany({ where: { id: target.id, workspaceId: actor.workspaceId }, data: { enabled } });
}

/** Toggle a discovered ad account within the actor's current workspace. */
export async function setAdAccountSelection(actor: ConnectionMutationActor, accountId: string, enabled: boolean) {
  const membership = await currentMembership(actor);
  if (!MANAGER_ROLES.has(membership.role)) throw new Error("Only workspace owners and admins can change connections.");
  const account = await prisma.adAccount.findFirst({
    where: { id: accountId, workspaceId: actor.workspaceId },
    select: { id: true, socialAccountId: true },
  });
  if (!account) throw new Error("This advertising account is unavailable in the current workspace.");
  if (enabled && !account.socialAccountId) throw new Error("Reconnect the source before selecting it.");
  if (enabled && account.socialAccountId) {
    const source = await prisma.socialAccount.findFirst({
      where: { id: account.socialAccountId, workspaceId: actor.workspaceId, invalidatedAt: null },
      select: { id: true },
    });
    if (!source) throw new Error("Reconnect the source before selecting it.");
  }
  await prisma.adAccount.updateMany({ where: { id: account.id, workspaceId: actor.workspaceId }, data: { enabled } });
}

async function currentMembership(actor: ConnectionMutationActor) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new Error("You are no longer a member of this workspace.");
  return membership;
}
