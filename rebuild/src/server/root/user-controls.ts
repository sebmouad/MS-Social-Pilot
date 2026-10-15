import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';

/** Installation-owner account control, executed atomically with session revocation and audit. */
export async function setRootUserDisabled(actorId: string, userId: string, disabled: boolean, confirmation: string) {
  return prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isInstanceOwner: true, disabledAt: true } });
    if (!target) throw new Error('User not found.');
    if (actorId === target.id) throw new Error('You cannot change access to your own account.');
    if (confirmation !== `${disabled ? 'DISABLE' : 'ENABLE'} ${target.email}`) throw new Error('Enter the exact confirmation shown.');
    if (Boolean(target.disabledAt) === disabled) return { changed: false, sessionsRevoked: 0 };
    if (disabled && target.isInstanceOwner) {
      const activeOwners = await tx.user.count({ where: { isInstanceOwner: true, disabledAt: null } });
      if (activeOwners <= 1) throw new Error('Cannot disable the last active instance owner.');
    }
    const changed = await tx.user.updateMany({
      where: { id: target.id, disabledAt: disabled ? null : { not: null } },
      data: { disabledAt: disabled ? new Date() : null },
    });
    if (changed.count !== 1) throw new Error('Account state changed; reload and try again.');
    const sessionsRevoked = disabled ? (await tx.session.deleteMany({ where: { userId: target.id } })).count : 0;
    const action = disabled ? 'root.user_disabled' : 'root.user_enabled';
    const detail = JSON.stringify({ userId: target.id, sessionsRevoked });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${action}, ${detail}::jsonb, NOW())`;
    return { changed: true, sessionsRevoked };
  }, { isolationLevel: 'Serializable' });
}

export async function revokeRootUserSessions(actorId: string, userId: string, confirmation: string) {
  return prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!target) throw new Error('User not found.');
    if (actorId === target.id) throw new Error('You cannot change access to your own account.');
    if (confirmation !== `SIGN OUT ${target.email}`) throw new Error('Enter the exact confirmation shown.');
    const sessionsRevoked = (await tx.session.deleteMany({ where: { userId: target.id } })).count;
    const detail = JSON.stringify({ userId: target.id, sessionsRevoked });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${'root.user_signed_out'}, ${detail}::jsonb, NOW())`;
    return { sessionsRevoked };
  });
}

export async function resetRootUserTwoStep(actorId: string, userId: string, confirmation: string) {
  return prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isInstanceOwner: true } });
    if (!target) throw new Error('User not found.');
    if (target.isInstanceOwner) throw new Error('An instance owner’s second step cannot be reset here.');
    if (actorId === target.id) throw new Error('You cannot change access to your own account.');
    if (confirmation !== `RESET TWO-STEP ${target.email}`) throw new Error('Enter the exact confirmation shown.');
    await tx.user.update({ where: { id: target.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } });
    await tx.passkey.deleteMany({ where: { userId: target.id } });
    await tx.recoveryCode.deleteMany({ where: { userId: target.id } });
    const sessionsRevoked = (await tx.session.deleteMany({ where: { userId: target.id } })).count;
    const detail = JSON.stringify({ userId: target.id, sessionsRevoked });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${'root.user_two_step_reset'}, ${detail}::jsonb, NOW())`;
    return { sessionsRevoked };
  });
}
