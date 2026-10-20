import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { rootUserConfirmation, rootUserConfirmationSchema, rootUserIdSchema, type RootUserAction } from '@/lib/root-user-controls';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';

type RootActorRow = { id: string; isInstanceOwner: boolean; disabledAt: Date | null };
type RootTargetRow = { id: string; email: string; isInstanceOwner: boolean; disabledAt: Date | null };

const INVALID_CONFIRMATION = 'Enter the exact confirmation shown.';
const RELOAD_CONFLICT = 'Account state changed. Reload the user list before repeating this action.';
const forbidden = () => new OperationError('forbidden', 'Installation-owner access is required.');
const conflict = (message: string) => new OperationError('conflict', message);

function isSerializationConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
}

async function controlRootUser(actorId: string, userId: string, action: RootUserAction, confirmation: string) {
  const actorResult = rootUserIdSchema.safeParse(actorId);
  const targetResult = rootUserIdSchema.safeParse(userId);
  const confirmationResult = rootUserConfirmationSchema.safeParse(confirmation);
  if (!actorResult.success || !targetResult.success || !confirmationResult.success) {
    throw new OperationError('invalid_request', 'Enter a valid user and confirmation.');
  }

  const [timeout, maxWait] = await Promise.all([
    runtimeConfig('root.accountOperationTimeoutMs'),
    runtimeConfig('root.accountOperationLockWaitMs'),
  ]);

  try {
    return await prisma.$transaction(async tx => {
      const ids = [...new Set([actorId, userId])].sort();
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;

      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, isInstanceOwner: true, disabledAt: true } }) as RootActorRow | null;
      if (!actor?.isInstanceOwner || actor.disabledAt) throw forbidden();

      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isInstanceOwner: true, disabledAt: true } }) as RootTargetRow | null;
      if (!target) throw new OperationError('not_found', 'User not found.');
      if (actorId === target.id) throw conflict('You cannot change access or recovery for your own account.');
      if (confirmation !== rootUserConfirmation(action, target.email)) throw new OperationError('invalid_request', INVALID_CONFIRMATION);
      if (action === 'reset-two-step' && target.isInstanceOwner) {
        throw new OperationError('forbidden', 'An instance owner’s second step cannot be reset here.');
      }

      if (action === 'disable' || action === 'enable') {
        const disabled = action === 'disable';
        if (Boolean(target.disabledAt) === disabled) return { changed: false, sessionsRevoked: 0 };
        if (disabled && target.isInstanceOwner) {
          const activeOwners = await tx.user.count({ where: { isInstanceOwner: true, disabledAt: null } });
          if (activeOwners <= 1) throw conflict('Cannot disable the last active instance owner.');
        }
        const changed = await tx.user.updateMany({
          where: { id: target.id, disabledAt: disabled ? null : { not: null } },
          data: { disabledAt: disabled ? new Date() : null },
        });
        if (changed.count !== 1) throw conflict(RELOAD_CONFLICT);
        const sessionsRevoked = disabled ? (await tx.session.deleteMany({ where: { userId: target.id } })).count : 0;
        const auditAction = disabled ? 'root.user_disabled' : 'root.user_enabled';
        const detail = JSON.stringify({ userId: target.id, sessionsRevoked });
        await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${auditAction}, ${detail}::jsonb, NOW())`;
        return { changed: true, sessionsRevoked };
      }

      if (action === 'sign-out') {
        const sessionsRevoked = (await tx.session.deleteMany({ where: { userId: target.id } })).count;
        const detail = JSON.stringify({ userId: target.id, sessionsRevoked });
        await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.user_signed_out', ${detail}::jsonb, NOW())`;
        return { sessionsRevoked };
      }

      await tx.user.update({ where: { id: target.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } });
      await tx.passkey.deleteMany({ where: { userId: target.id } });
      await tx.recoveryCode.deleteMany({ where: { userId: target.id } });
      const sessionsRevoked = (await tx.session.deleteMany({ where: { userId: target.id } })).count;
      const detail = JSON.stringify({ userId: target.id, sessionsRevoked });
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.user_two_step_reset', ${detail}::jsonb, NOW())`;
      return { sessionsRevoked };
    }, { isolationLevel: 'Serializable', timeout, maxWait });
  } catch (error) {
    if (isSerializationConflict(error)) throw conflict(RELOAD_CONFLICT);
    throw error;
  }
}

/** Installation-owner account control, executed atomically with session revocation and audit. */
export async function setRootUserDisabled(actorId: string, userId: string, disabled: boolean, confirmation: string) {
  return controlRootUser(actorId, userId, disabled ? 'disable' : 'enable', confirmation);
}

export async function revokeRootUserSessions(actorId: string, userId: string, confirmation: string) {
  return controlRootUser(actorId, userId, 'sign-out', confirmation);
}

export async function resetRootUserTwoStep(actorId: string, userId: string, confirmation: string) {
  return controlRootUser(actorId, userId, 'reset-two-step', confirmation);
}

export const rootUserDeletionConfirmation = (email: string) => `DELETE ACCOUNT ${email}`;

/**
 * Root deletion of one account (legacy parity). Only a disabled, non-Root account that is not the sole owner of any
 * workspace. Its posts and invitations stay with their workspaces, credited to the Root operator; API keys it created
 * are revoked and credited the same way; everything personal (sessions, tokens, saved views, memberships) cascades.
 */
export async function deleteRootUser(actorId: string, userId: string, confirmation: string) {
  if (!rootUserIdSchema.safeParse(userId).success || !rootUserConfirmationSchema.safeParse(confirmation).success) throw new OperationError('invalid_request', 'Enter a valid user and confirmation.');
  return prisma.$transaction(async tx => {
    const actors = await tx.$queryRaw<Array<{ isInstanceOwner: boolean; disabledAt: Date | null }>>`SELECT "isInstanceOwner", "disabledAt" FROM users WHERE id = ${actorId} FOR SHARE`;
    if (!actors[0]?.isInstanceOwner || actors[0].disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const rows = await tx.$queryRaw<Array<{ id: string; email: string; isInstanceOwner: boolean; disabledAt: Date | null }>>`SELECT id, email, "isInstanceOwner", "disabledAt" FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = rows[0];
    if (!user) throw new OperationError('not_found', 'Account not found.');
    if (confirmation !== rootUserDeletionConfirmation(user.email)) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
    if (user.id === actorId || user.isInstanceOwner) throw new OperationError('conflict', 'The installation owner account cannot be deleted.');
    if (!user.disabledAt) throw new OperationError('conflict', 'Disable this account before deleting it.');
    const owned = await tx.$queryRaw<Array<{ workspaceId: string; owners: number }>>`SELECT m."workspaceId", (SELECT COUNT(*)::int FROM memberships o WHERE o."workspaceId" = m."workspaceId" AND o.role::text = 'owner') AS owners FROM memberships m WHERE m."userId" = ${userId} AND m.role::text = 'owner' ORDER BY m."workspaceId" FOR UPDATE OF m`;
    if (owned.some(row => row.owners <= 1)) throw new OperationError('conflict', 'This account is the only owner of a workspace. Transfer ownership or delete that workspace first.');
    await tx.$executeRaw`UPDATE posts SET "authorId" = ${actorId} WHERE "authorId" = ${userId}`;
    await tx.$executeRaw`UPDATE posts SET "submittedById" = NULL WHERE "submittedById" = ${userId}`;
    await tx.$executeRaw`UPDATE posts SET "reviewedById" = NULL WHERE "reviewedById" = ${userId}`;
    await tx.$executeRaw`UPDATE invitations SET "invitedById" = ${actorId} WHERE "invitedById" = ${userId}`;
    const revoked = await tx.$executeRaw`UPDATE mcp_api_keys SET "revokedAt" = COALESCE("revokedAt", NOW()), "createdById" = ${actorId} WHERE "createdById" = ${userId}`;
    await tx.$executeRaw`DELETE FROM users WHERE id = ${userId}`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.user_deleted', ${JSON.stringify({ userId, revokedApiKeys: revoked })}::jsonb, NOW())`;
    return { deleted: true as const, userId, revokedApiKeys: revoked };
  });
}
