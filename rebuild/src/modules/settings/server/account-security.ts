import { createHash, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { verifyPassword } from '@/server/auth';
import { needsTwoStepEnrollment } from '@/server/auth-policy';
import { authRateLimit } from '@/server/auth-flow';
import { hit } from '@/server/rate-limit';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';
import { matchTotp, newTotpSecret, otpauthUri } from '@/server/totp';
import { auditAccountMutation, accountPasswordPolicy } from '@/server/account-settings';
import { authorizeAccountSession, type AccountActor } from './account';

import { securityConfirmations } from './account-security-contract';
export { securityConfirmations } from './account-security-contract';
const invalid = () => new OperationError('invalid_request', 'Check your password, verification code and confirmation.');
export async function readAccountSecurity(actor: AccountActor) {
  await authorizeAccountSession(actor);
  const limit = await runtimeConfig('settings.accountPasskeyLimit');
  const [user, passkeys, roles, policy] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { totpEnabledAt: true, isInstanceOwner: true } }),
    prisma.passkey.findMany({ where: { userId: actor.userId }, take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, name: true, createdAt: true, lastUsedAt: true } }),
    prisma.membership.findMany({ where: { userId: actor.userId }, select: { role: true } }), runtimeConfig('security.twoStep'),
  ]);
  if (!user) throw new OperationError('not_found', 'Account unavailable.');
  if (passkeys.length > limit) throw new OperationError('conflict', 'Your passkey list is too large. Contact your administrator.');
  return { twoStepEnabled: Boolean(user.totpEnabledAt), required: needsTwoStepEnrollment(policy, user.isInstanceOwner, roles.map(r => r.role)), passkeys };
}

/** Every transport uses this account-scoped, password-verified and audited state transition. */
export async function changeAccountSecurity(actor: AccountActor, action: 'begin' | 'enable' | 'disable' | 'remove', input: unknown) {
  await authorizeAccountSession(actor, true);
  const parsed = z.object({ currentPassword: z.string().min(1), code: z.string().optional(), id: z.string().min(1).optional(), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const value = parsed.data;
  const expected = action === 'remove' ? value.id && securityConfirmations.remove(value.id) : securityConfirmations[action];
  if (!expected || value.confirmation !== expected) throw invalid();
  if (!hit(`account-security:${actor.userId}`, await authRateLimit()).allowed) throw new OperationError('forbidden', 'Too many attempts. Wait before trying again.');
  const [passwordPolicy, issuer, recoveryCount] = await Promise.all([accountPasswordPolicy(), runtimeConfig('settings.accountAuthenticatorIssuer'), runtimeConfig('auth.recoveryCodeCount')]);
  if (Buffer.byteLength(value.currentPassword, 'utf8') > passwordPolicy.maxBytes) throw invalid();
  return prisma.$transaction(async tx => {
    // Serialize credential changes, including removal of the final required factor.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.userId } });
    if (!user || user.disabledAt || !verifyPassword(value.currentPassword, user.passwordHash)) throw invalid();
    const session = await tx.session.findUnique({ where: { tokenHash: actor.sessionTokenHash } });
    if (!session || session.userId !== actor.userId || session.pending || session.expiresAt <= new Date()) throw new OperationError('unauthorized', 'Sign in to continue.');
    const [roles, policy, passkeyCount] = await Promise.all([
      tx.membership.findMany({ where: { userId: actor.userId }, select: { role: true } }), runtimeConfig('security.twoStep'), tx.passkey.count({ where: { userId: actor.userId } }),
    ]);
    const required = needsTwoStepEnrollment(policy, user.isInstanceOwner, roles.map(r => r.role));
    if (action === 'begin') {
      if (user.totpEnabledAt) throw new OperationError('conflict', 'An authenticator is already enabled.');
      const secret = newTotpSecret();
      await tx.user.update({ where: { id: user.id }, data: { totpPendingSecret: encryptSecret(secret) } });
      await auditAccountMutation(tx, user.id, 'account.two_step_setup_started', {});
      return { ok: true, secret, uri: otpauthUri({ secret, account: user.email, issuer }) };
    }
    if (action === 'enable') {
      if (user.totpEnabledAt || !user.totpPendingSecret) throw new OperationError('conflict', 'Start authenticator setup again.');
      const step = matchTotp(decryptSecret(user.totpPendingSecret), value.code ?? '');
      if (step === null) throw invalid();
      // Shared sign-in protocol accepts ten normalized alphanumeric characters (server/two-step.ts).
      const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
      const recoveryCodes = Array.from({ length: recoveryCount }, () => Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join(''));
      await tx.user.update({ where: { id: user.id }, data: { totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step } });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({ data: recoveryCodes.map(code => ({ id: randomUUID(), createdAt: new Date(), userId: user.id, codeHash: createHash('sha256').update(code).digest('hex') })) });
      await auditAccountMutation(tx, user.id, 'account.two_step_enabled', {});
      await tx.$executeRaw`DELETE FROM trusted_devices WHERE "userId" = ${user.id}`;
      await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: actor.sessionTokenHash } } });
      return { ok: true, recoveryCodes };
    }
    if (action === 'disable') {
      if (!user.totpEnabledAt || !user.totpSecret) throw new OperationError('conflict', 'Authenticator is already disabled.');
      if (required && passkeyCount === 0) throw new OperationError('forbidden', 'Your account requires two-step verification. Keep a verification method enabled.');
      const step = matchTotp(decryptSecret(user.totpSecret), value.code ?? '');
      if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) throw invalid();
      await tx.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await auditAccountMutation(tx, user.id, 'account.two_step_disabled', {});
    } else {
      if (required && !user.totpEnabledAt && passkeyCount <= 1) throw new OperationError('forbidden', 'Your account requires two-step verification. Keep a verification method enabled.');
      const removed = await tx.passkey.deleteMany({ where: { userId: user.id, id: value.id } });
      if (removed.count !== 1) throw new OperationError('not_found', 'Passkey unavailable.');
      await auditAccountMutation(tx, user.id, 'account.passkey_removed', { passkeyId: value.id });
    }
    await tx.$executeRaw`DELETE FROM trusted_devices WHERE "userId" = ${user.id}`;
    await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: actor.sessionTokenHash } } });
    return { ok: true };
  });
}
