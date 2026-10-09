import type { Locale } from '@prisma/client';

import { prisma } from './prisma';
import { errors } from './errors';
import { hashPassword, verifyPassword } from './crypto';
import { hit } from './rate-limit';

/**
 * A person's own account: what they are called, what language they read, their
 * password, and where they are signed in.
 *
 * None of this existed. The password chosen at sign-up could never be changed,
 * so a leaked one could only be dealt with by an administrator deleting the
 * account; and the language was fixed at whatever the browser said on the day,
 * which the locale order puts ahead of everything else, so a French speaker who
 * registered on an English laptop read English for ever.
 *
 * Everything here acts on the caller's own user id — there is no "change
 * somebody else's password", which is what keeps it free of role checks.
 */

export interface AccountSummary {
  name: string;
  email: string;
  locale: Locale;
  /** Other signed-in browsers, not counting this one. */
  otherSessions: number;
}

export async function readAccount(userId: string, currentTokenHash: string | null): Promise<AccountSummary> {
  const [user, otherSessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, locale: true },
    }),
    prisma.session.count({
      where: {
        userId,
        expiresAt: { gt: new Date() },
        ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
      },
    }),
  ]);

  return { ...user, otherSessions };
}

export async function updateProfile(
  userId: string,
  input: { name?: string; locale?: Locale },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
    },
  });
}

/**
 * Sign out every browser but this one. Returns how many were signed out.
 *
 * `currentTokenHash` null signs out everything, which is right for a caller
 * with no session of its own to keep.
 */
export async function signOutOtherSessions(
  userId: string,
  currentTokenHash: string | null,
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}) },
  });
  return count;
}

/**
 * Change the password, and sign out everywhere else.
 *
 * The current password is required even though the caller is signed in: the
 * session could be a laptop left open, and that is exactly the situation where
 * a password change must not be one click away. Guesses at it are rate
 * limited per user on the same budget as signing in, so a stolen session is
 * not a way around the sign-in limit.
 *
 * Every other session goes, because the commonest reason to change a password
 * is believing somebody else has it — and then they are probably signed in.
 */
export async function changePassword(options: {
  userId: string;
  currentTokenHash: string | null;
  currentPassword: string;
  newPassword: string;
  limit: { limit: number; windowMs: number };
}): Promise<{ signedOut: number }> {
  const attempt = hit(`password:user:${options.userId}`, options.limit);
  if (!attempt.allowed) {
    throw errors.tooManyAttempts(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 60_000)));
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: options.userId },
    select: { passwordHash: true },
  });

  if (!verifyPassword(options.currentPassword, user.passwordHash)) {
    throw errors.currentPasswordWrong();
  }
  if (options.currentPassword === options.newPassword) {
    throw errors.passwordUnchanged();
  }

  const [, signedOut] = await prisma.$transaction([
    prisma.user.update({
      where: { id: options.userId },
      data: { passwordHash: hashPassword(options.newPassword) },
    }),
    prisma.session.deleteMany({
      where: {
        userId: options.userId,
        ...(options.currentTokenHash ? { tokenHash: { not: options.currentTokenHash } } : {}),
      },
    }),
  ]);

  return { signedOut: signedOut.count };
}
