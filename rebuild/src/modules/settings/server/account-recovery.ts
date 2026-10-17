import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { accountPasswordPolicy, validateNewPassword } from '@/server/account-settings';
import { hashLegacyPassword } from '@/server/auth';
import { mailReady, publicMailOrigin, sendTransactionalMail } from '@/server/mail';

const genericFailure = () => new OperationError('unavailable', 'Password recovery is temporarily unavailable. Try again later.');
const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, 'base64url').length === 32 && Buffer.from(token, 'base64url').toString('base64url') === token;
const emailSchema = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type RecoveryDeps = {
  issue: (email: string, now: Date, ttlMinutes: number) => Promise<{ userId: string; email: string; token: string } | null>;
  tokenIsUsable: (token: string, now: Date) => Promise<boolean>;
  consume: (token: string, passwordHash: string, now: Date) => Promise<boolean>;
  passwordPolicy: typeof accountPasswordPolicy;
  ttlMinutes: () => Promise<number>;
  mailReady: typeof mailReady;
  mailOrigin: typeof publicMailOrigin;
  send: typeof sendTransactionalMail;
  now: () => Date;
};

async function issue(email: string, now: Date, ttlMinutes: number) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, disabledAt: true } });
  if (!user || user.disabledAt) return null;
  const token = randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  return prisma.$transaction(async tx => {
    const active = await tx.$queryRaw<Array<{ id: string; email: string }>>`SELECT id, email FROM users WHERE id = ${user.id} AND "disabledAt" IS NULL FOR UPDATE`;
    if (!active[0]) return null;
    await tx.$executeRaw`DELETE FROM email_tokens WHERE "userId" = ${user.id} AND purpose = 'reset'`;
    await tx.$executeRaw`INSERT INTO email_tokens (id, "userId", purpose, "tokenHash", "expiresAt", "usedAt", "createdAt") VALUES (${randomUUID()}, ${user.id}, 'reset', ${hash}, ${new Date(now.getTime() + ttlMinutes * 60_000)}, NULL, ${now})`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`recovery_${randomUUID()}`}, ${user.id}, 'account.password_recovery_requested', ${JSON.stringify({ delivery: 'email' })}::jsonb, ${now})`;
    return { userId: user.id, email: active[0].email, token };
  });
}

async function consume(token: string, passwordHash: string, now: Date) {
  const hash = tokenHash(token);
  return prisma.$transaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{ id: string; userId: string }>>`SELECT id, "userId" FROM email_tokens WHERE "tokenHash" = ${hash} AND purpose = 'reset' AND "usedAt" IS NULL AND "expiresAt" > ${now}`;
    const candidate = candidates[0];
    if (!candidate) return false;
    // Lock the account before the token, matching the issuance lock order.
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${candidate.userId} AND "disabledAt" IS NULL FOR UPDATE`;
    if (!users[0]) return false;
    const tokens = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM email_tokens WHERE id = ${candidate.id} AND "userId" = ${candidate.userId} AND purpose = 'reset' AND "usedAt" IS NULL AND "expiresAt" > ${now} FOR UPDATE`;
    if (!tokens[0]) return false;
    const claimed = await tx.$executeRaw`UPDATE email_tokens SET "usedAt" = ${now} WHERE id = ${candidate.id} AND "usedAt" IS NULL`;
    if (claimed !== 1) throw new Error('recovery claim changed');
    const changed = await tx.$executeRaw`UPDATE users SET "passwordHash" = ${passwordHash}, "emailVerifiedAt" = COALESCE("emailVerifiedAt", ${now}), "updatedAt" = ${now} WHERE id = ${candidate.userId} AND "disabledAt" IS NULL`;
    if (changed !== 1) throw new Error('account changed');
    await tx.$executeRaw`DELETE FROM sessions WHERE "userId" = ${candidate.userId}`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`recovery_${randomUUID()}`}, ${candidate.userId}, 'account.password_reset', ${JSON.stringify({ sessionsRevoked: true, emailVerified: true, method: 'email' })}::jsonb, ${now})`;
    return true;
  });
}

/** Cheap indexed token check before doing the expensive legacy scrypt hash.
 * `consume` repeats every condition under account/token row locks. */
async function tokenIsUsable(token: string, now: Date) {
  const hash = tokenHash(token);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM email_tokens WHERE "tokenHash" = ${hash} AND purpose = 'reset' AND "usedAt" IS NULL AND "expiresAt" > ${now} LIMIT 1`;
  return rows.length > 0;
}

const defaults: RecoveryDeps = {
  issue,
  consume,
  tokenIsUsable,
  passwordPolicy: accountPasswordPolicy,
  ttlMinutes: async () => runtimeConfig('auth.passwordRecoveryTtlMinutes') as Promise<number>,
  mailReady,
  mailOrigin: publicMailOrigin,
  send: sendTransactionalMail,
  now: () => new Date(),
};

export function createAccountRecoveryService(deps: RecoveryDeps = defaults) {
  return {
    /** Always returns the same result for unknown, disabled, and active addresses. */
    async request(emailInput: unknown): Promise<{ requested: true }> {
      if (typeof emailInput !== 'string' || emailInput.length > 320) return { requested: true };
      const email = emailInput.trim().toLowerCase();
      if (!emailSchema.test(email)) return { requested: true };
      try {
        const ttl = await deps.ttlMinutes();
        if (!Number.isSafeInteger(ttl) || ttl < 5 || ttl > 1440) return { requested: true };
        const [ready, origin] = await Promise.all([deps.mailReady(), deps.mailOrigin()]);
        if (!ready || !origin) return { requested: true };
        const issued = await deps.issue(email, deps.now(), ttl);
        if (!issued) return { requested: true };
        const link = `${origin}/password-recovery#token=${encodeURIComponent(issued.token)}`;
        await deps.send({
          to: issued.email,
          subject: 'Reset your MS Social Pilot password',
          text: `A password reset was requested for your account. If you made this request, open this one-use link to choose a new password:\n\n${link}\n\nIf you did not request this, you can ignore this message.`,
          template: 'account.passwordRecovery',
        });
      } catch {
        // Do not reveal account existence or any mail/database failure detail.
      }
      return { requested: true };
    },
    async reset(token: unknown, password: unknown): Promise<{ reset: true }> {
      if (typeof token !== 'string' || !validToken(token) || typeof password !== 'string') {
        throw new OperationError('invalid_request', 'Enter a valid recovery link and password.');
      }
      let usable: boolean;
      try { usable = await deps.tokenIsUsable(token, deps.now()); }
      catch { throw genericFailure(); }
      if (!usable) throw new OperationError('invalid_request', 'This recovery link is invalid or has expired. Request a new one.');
      let policy;
      try { policy = await deps.passwordPolicy(); }
      catch { throw genericFailure(); }
      if (password.length > 200 || !validateNewPassword(password, { ...policy, maxBytes: Math.min(policy.maxBytes, 800) })) throw new OperationError('invalid_request', `Password must be at least ${policy.minLength} characters and no more than ${Math.min(policy.maxBytes, 800)} bytes.`);
      let encoded: string;
      try { encoded = hashLegacyPassword(password); }
      catch { throw new OperationError('invalid_request', 'Choose a shorter password.'); }
      try {
        if (!(await deps.consume(token, encoded, deps.now()))) throw new OperationError('invalid_request', 'This recovery link is invalid or has expired. Request a new one.');
      } catch (error) {
        if (error instanceof OperationError) throw error;
        throw genericFailure();
      }
      return { reset: true };
    },
  };
}

const service = createAccountRecoveryService();
export const requestPasswordRecovery = service.request;
export const completePasswordRecovery = service.reset;
