import { deleteAccountSupplementaryData } from '@/server/data-control/account';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { accountPasswordPolicy, validateNewPassword } from '@/server/account-settings';
import { hashStoredPassword } from '@/server/auth';
import { mailReady, publicMailOrigin, sendTransactionalMail } from '@/server/mail';

/**
 * Self-service registration (Root `auth.openRegistration`, off by default).
 *
 * An account is created unverified and without a workspace; the one-use email link proves the address and only
 * then creates the person's own workspace as owner. Until then the account has no membership, so it can reach no
 * workspace data. Responses never reveal whether an address already has an account: an existing address receives
 * a "you already have an account" email instead.
 */
const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, 'base64url').length === 32 && Buffer.from(token, 'base64url').toString('base64url') === token;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const unavailable = () => new OperationError('unavailable', 'Sign-up is temporarily unavailable. Try again later.');
/** Shared advisory key so two sign-ups for one address queue instead of racing. */
const lockKey = (email: string) => JSON.stringify(['registration', email]);

export type RegistrationDeps = {
  open: () => Promise<boolean>;
  ttlMinutes: () => Promise<number>;
  mailReady: typeof mailReady;
  mailOrigin: typeof publicMailOrigin;
  send: typeof sendTransactionalMail;
  now: () => Date;
};
const defaults: RegistrationDeps = {
  open: async () => (await runtimeConfig('auth.openRegistration')) === true,
  ttlMinutes: async () => Number(await runtimeConfig('auth.emailVerificationTtlMinutes')),
  mailReady, mailOrigin: publicMailOrigin, send: sendTransactionalMail, now: () => new Date(),
};

/** Whether the sign-up page should be offered: open, with working email. */
export async function registrationAvailable(deps: RegistrationDeps = defaults): Promise<boolean> {
  try { return (await deps.open()) && (await deps.mailReady()) && Boolean(await deps.mailOrigin()); } catch { return false; }
}

async function ttl(deps: RegistrationDeps) {
  const value = await deps.ttlMinutes();
  if (!Number.isSafeInteger(value) || value < 15 || value > 10080) throw unavailable();
  return value;
}

async function issueVerification(userId: string, now: Date, minutes: number, db?: Prisma.TransactionClient) {
  const token = randomBytes(32).toString('base64url');
  const issue = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`DELETE FROM email_tokens WHERE "userId" = ${userId} AND purpose = 'verify' AND "usedAt" IS NULL`;
    await tx.$executeRaw`INSERT INTO email_tokens (id, "userId", purpose, "tokenHash", "expiresAt", "usedAt", "createdAt") VALUES (${randomUUID()}, ${userId}, 'verify', ${tokenHash(token)}, ${new Date(now.getTime() + minutes * 60_000)}, NULL, ${now})`;
  };
  if (db) await issue(db); else await prisma.$transaction(issue);
  return token;
}

const verifyMail = (to: string, link: string) => ({
  to, subject: 'Confirm your MS Social Pilot email',
  text: `Welcome to MS Social Pilot. Open this one-use link to confirm your email and create your workspace:\n\n${link}\n\nIf you did not sign up, you can ignore this message.`,
  template: 'account.verifyEmail',
});
const existingMail = (to: string, origin: string) => ({
  to, subject: 'You already have an MS Social Pilot account',
  text: `Someone tried to sign up with this email, but it already has an account. Sign in at ${origin}/sign-in, or reset your password at ${origin}/password-recovery.\n\nIf this was not you, you can ignore this message.`,
  template: 'account.registrationExisting',
});

export function createRegistrationService(deps: RegistrationDeps = defaults) {
  return {
    async register(input: unknown): Promise<{ requested: true }> {
      const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      const name = typeof value.name === 'string' ? value.name.trim() : '';
      const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
      const password = typeof value.password === 'string' ? value.password : '';
      if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new OperationError('invalid_request', 'Enter your name (up to 120 characters).');
      if (email.length > 320 || !emailPattern.test(email)) throw new OperationError('invalid_request', 'Enter a valid email address.');
      if (!(await registrationAvailable(deps))) throw new OperationError('forbidden', 'Sign-up is closed. Ask a workspace owner to invite you.');
      const policy = await accountPasswordPolicy().catch(() => { throw unavailable(); });
      if (password.length > 200 || !validateNewPassword(password, { ...policy, maxBytes: Math.min(policy.maxBytes, 800) })) {
        throw new OperationError('invalid_request', `Password must be at least ${policy.minLength} characters and no more than ${Math.min(policy.maxBytes, 800)} bytes.`);
      }
      const minutes = await ttl(deps);
      const origin = await deps.mailOrigin();
      if (!origin) throw unavailable();
      const passwordHash = hashStoredPassword(password); // slow on purpose; outside the lock
      const now = deps.now();
      let created: { id: string } | null = null;
      try {
        created = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(email)}, 0))::text`;
          const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
          if (existing) return null;
          const plan = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM plans WHERE "isDefault" = true ORDER BY position, id LIMIT 1`;
          const id = randomUUID();
          await tx.user.create({ data: { id, email, name, passwordHash } });
          await tx.$executeRaw`UPDATE users SET "planId" = ${plan[0]?.id ?? null}, "emailVerifiedAt" = NULL, "isInstanceOwner" = false WHERE id = ${id}`;
          await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${id}, 'account.registered', ${JSON.stringify({ method: 'open_registration' })}::jsonb, ${now})`;
          return { id };
        });
      } catch { throw unavailable(); }
      try {
        if (created) {
          const token = await issueVerification(created.id, now, minutes);
          await deps.send(verifyMail(email, `${origin}/verify-email#token=${encodeURIComponent(token)}`));
        } else {
          await deps.send(existingMail(email, origin));
        }
      } catch { /* Same answer either way; the person can resend from the sign-in page. */ }
      return { requested: true };
    },

    /** Same generic answer for unknown, verified and unverified addresses. */
    async resend(emailInput: unknown): Promise<{ requested: true }> {
      if (typeof emailInput !== 'string' || emailInput.length > 320) return { requested: true };
      const email = emailInput.trim().toLowerCase();
      if (!emailPattern.test(email)) return { requested: true };
      try {
        if (!(await registrationAvailable(deps))) return { requested: true };
        const [minutes, origin] = await Promise.all([ttl(deps), deps.mailOrigin()]);
        const rows = await prisma.$queryRaw<Array<{ id: string; disabledAt: Date | null; emailVerifiedAt: Date | null }>>`SELECT id, "disabledAt", "emailVerifiedAt" FROM users WHERE email = ${email} LIMIT 1`;
        const user = rows[0];
        if (!user || user.disabledAt || user.emailVerifiedAt || !origin) return { requested: true };
        const token = await issueVerification(user.id, deps.now(), minutes);
        await deps.send(verifyMail(email, `${origin}/verify-email#token=${encodeURIComponent(token)}`));
      } catch { /* generic */ }
      return { requested: true };
    },

    /** Proves the address and, for a new self-registered account, creates its own workspace as owner. */
    async verify(token: unknown): Promise<{ verified: true; workspaceId: string | null }> {
      if (typeof token !== 'string' || !validToken(token)) throw new OperationError('invalid_request', 'This confirmation link is invalid or has expired. Request a new one.');
      const now = deps.now();
      const hash = tokenHash(token);
      try {
        return await prisma.$transaction(async tx => {
          const rows = await tx.$queryRaw<Array<{ id: string; userId: string }>>`SELECT id, "userId" FROM email_tokens WHERE "tokenHash" = ${hash} AND purpose = 'verify' AND "usedAt" IS NULL AND "expiresAt" > ${now} FOR UPDATE`;
          const row = rows[0];
          if (!row) throw new OperationError('invalid_request', 'This confirmation link is invalid or has expired. Request a new one.');
          const users = await tx.$queryRaw<Array<{ name: string; disabledAt: Date | null }>>`SELECT name, "disabledAt" FROM users WHERE id = ${row.userId} FOR UPDATE`;
          if (!users[0] || users[0].disabledAt) throw new OperationError('invalid_request', 'This confirmation link is invalid or has expired. Request a new one.');
          await tx.$executeRaw`UPDATE email_tokens SET "usedAt" = ${now} WHERE id = ${row.id}`;
          await tx.$executeRaw`UPDATE users SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", ${now}), "updatedAt" = ${now} WHERE id = ${row.userId}`;
          const memberships = await tx.membership.count({ where: { userId: row.userId } });
          let workspaceId: string | null = null;
          if (memberships === 0) {
            workspaceId = randomUUID();
            const label = `${users[0].name.slice(0, 80)}'s workspace`;
            const base = label.normalize('NFKD').toLowerCase().replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
            await tx.workspace.create({ data: { id: workspaceId, name: label, slug: `${base}-${workspaceId}`, timezone: 'UTC', memberships: { create: { id: randomUUID(), userId: row.userId, role: 'owner' } } } });
            await tx.$executeRaw`UPDATE users SET "lastActiveWorkspaceId" = ${workspaceId} WHERE id = ${row.userId}`;
          }
          await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${row.userId}, 'account.email_verified', ${JSON.stringify({ workspaceCreated: workspaceId !== null })}::jsonb, ${now})`;
          return { verified: true as const, workspaceId };
        });
      } catch (error) {
        if (error instanceof OperationError) throw error;
        throw unavailable();
      }
    },
  };
}

const service = createRegistrationService();
export const registerAccount = service.register;
export const resendVerification = service.resend;
export const verifyEmail = service.verify;

/** Evidence distinguishes self-registration from existing or invited unverified accounts. Alias must be `u`. */
export const unverifiedRegistrationWhere = Prisma.sql`
  u."emailVerifiedAt" IS NULL AND u."isInstanceOwner" = false
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m."userId" = u.id)
  AND EXISTS (SELECT 1 FROM root_activities r WHERE r."actorId" = u.id
    AND r.action = 'account.registered' AND r.detail->>'method' = 'open_registration')`;

/** Caller holds the target user lock and current installation authority in this transaction. */
export async function requireUnverifiedRegistration(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; email: string; disabledAt: Date | null }>>`
    SELECT u.id, u.email, u."disabledAt" FROM users u WHERE u.id = ${userId} AND ${unverifiedRegistrationWhere} FOR UPDATE OF u`;
  if (!rows[0]) throw new OperationError('conflict', 'This account is no longer an unverified self-registration without workspace access.');
  return rows[0];
}

/** Reuses registration availability, TTL, token replacement and mail. Never claims a generic public resend sent mail. */
export async function resendUnverifiedRegistration(tx: Prisma.TransactionClient, userId: string, deps: RegistrationDeps = defaults) {
  const user = await requireUnverifiedRegistration(tx, userId);
  if (user.disabledAt || !(await registrationAvailable(deps))) throw new OperationError('unavailable', 'Verification mail is unavailable. Check registration and mail configuration.');
  const minutes = await ttl(deps);
  const origin = await deps.mailOrigin();
  if (!origin) throw unavailable();
  const token = await issueVerification(user.id, deps.now(), minutes, tx);
  // A send with an uncertain receipt stays uncertain; it must never be labelled sent by the operator UI.
  try { return { delivery: (await deps.send(verifyMail(user.email, `${origin}/verify-email#token=${encodeURIComponent(token)}`))).status }; }
  catch { return { delivery: 'uncertain' as const }; }
}

export async function deleteUnverifiedRegistration(tx: Prisma.TransactionClient, userId: string) {
  await requireUnverifiedRegistration(tx, userId);
  // Production FKs cascade personal authentication material and detach historical Root activity.
  // Restrictive foreign keys refuse unexpected owned content rather than deleting workspace data.
  await deleteAccountSupplementaryData(tx, userId);
  const removed = await tx.$executeRaw`DELETE FROM users WHERE id = ${userId}`;
  if (removed !== 1) throw new OperationError('conflict', 'This account changed. Reload before trying again.');
  return { deleted: true as const, userId };
}
