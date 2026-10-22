import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';

export const installationTransferConfirmation = (email: string) => `TRANSFER INSTALLATION TO ${email}`;

/**
 * Hand the private installation (Root) to another active account. Exactly one installation owner exists before and
 * after; the previous owner keeps their account and workspace memberships but loses Root on their next request.
 * Both accounts are locked in a stable order so two transfers cannot interleave.
 */
export async function transferInstallationOwnership(actorId: string, input: unknown) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const confirmation = typeof value.confirmation === 'string' ? value.confirmation : '';
  if (!email || email.length > synchronousPolicy('root.emailMaxCharacters')) throw new OperationError('invalid_request', 'Enter the email of an existing active account.');
  if (confirmation.length > synchronousPolicy('root.confirmationMaxCharacters') || confirmation !== installationTransferConfirmation(email)) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  return prisma.$transaction(async tx => {
    const target = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${email}`;
    const targetId = target[0]?.id;
    if (!targetId) throw new OperationError('not_found', 'No account uses that email.');
    if (targetId === actorId) throw new OperationError('conflict', 'You already administer this installation.');
    const rows = await tx.$queryRaw<Array<{ id: string; isInstanceOwner: boolean; disabledAt: Date | null }>>`SELECT id, "isInstanceOwner", "disabledAt" FROM users WHERE id IN (${actorId}, ${targetId}) ORDER BY id FOR UPDATE`;
    const actor = rows.find(row => row.id === actorId);
    const next = rows.find(row => row.id === targetId);
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    if (!next || next.disabledAt) throw new OperationError('conflict', 'Choose an active account.');
    await tx.$executeRaw`UPDATE users SET "isInstanceOwner" = true, "updatedAt" = NOW() WHERE id = ${targetId}`;
    await tx.$executeRaw`UPDATE users SET "isInstanceOwner" = false, "updatedAt" = NOW() WHERE id = ${actorId}`;
    const owners = await tx.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM users WHERE "isInstanceOwner" = true`;
    if (owners[0]?.count !== 1) throw new OperationError('conflict', 'The installation must have exactly one owner. Nothing was changed.');
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.installation_transferred', ${JSON.stringify({ fromUserId: actorId, toUserId: targetId })}::jsonb, NOW())`;
    return { transferred: true as const, toUserId: targetId };
  });
}
