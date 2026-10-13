/**
 * One-time links sent by email: prove the address after a
 * self-service sign-up, or choose a new password. Only the token's sha256 is
 * stored; a link works once, and a newer one replaces the older.
 */
import { prisma } from './prisma';
import { hashPassword, hashToken, randomToken } from './crypto';
import { sendEmail } from './email/send';
import { passwordResetEmail, verifyEmailEmail } from './email/templates';

export type EmailTokenPurpose = 'verify' | 'reset';

const TTL_MS: Record<EmailTokenPurpose, number> = {
  verify: 3 * 24 * 60 * 60 * 1000,
  // Short: whoever holds the link can take the account.
  reset: 60 * 60 * 1000,
};

export async function issueEmailToken(userId: string, purpose: EmailTokenPurpose, now = new Date()): Promise<string> {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.emailToken.deleteMany({ where: { userId, purpose } }),
    prisma.emailToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + TTL_MS[purpose]) },
    }),
  ]);
  return token;
}

/** The user the link belongs to, once; null for an unknown, used or expired link. */
export async function consumeEmailToken(token: string, purpose: EmailTokenPurpose, now = new Date()): Promise<string | null> {
  if (!token) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= now) return null;
  // Two clicks at once: only the one that marks it used wins.
  const claimed = await prisma.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  return claimed.count === 1 ? row.userId : null;
}

export async function sendVerificationEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, locale: true, emailVerifiedAt: true } });
  if (!user || user.emailVerifiedAt) return;
  const token = await issueEmailToken(userId, 'verify');
  await sendEmail({ to: user.email, template: 'account.verifyEmail', ...verifyEmailEmail({ locale: user.locale, name: user.name, token }) });
}

/** The address is proven: the person may use the app. */
export async function verifyEmail(token: string): Promise<boolean> {
  const userId = await consumeEmailToken(token, 'verify');
  if (!userId) return false;
  await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  return true;
}

/**
 * Email a reset link if the address has an account that may sign in. Says
 * nothing either way, so the form cannot be used to find out who has one.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, locale: true, disabledAt: true },
  });
  if (!user || user.disabledAt) return;
  const token = await issueEmailToken(user.id, 'reset');
  await sendEmail({ to: user.email, template: 'account.passwordReset', ...passwordResetEmail({ locale: user.locale, token }) });
}

/**
 * Set the new password. Every session ends, so whoever knew the old one is
 * out; the link also proves the address. Two-step sign-in still applies.
 */
export async function resetPassword(token: string, password: string): Promise<boolean> {
  const userId = await consumeEmailToken(token, 'reset');
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true, emailVerifiedAt: true } });
  if (!user || user.disabledAt) return false;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  return true;
}
