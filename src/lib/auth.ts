import { cookies } from 'next/headers';
import { cache } from 'react';

import { prisma } from './prisma';
import { env } from './env';
import { hashPassword, hashToken, randomToken, verifyPassword } from './crypto';
import type { WorkspaceRole } from './constants';

/**
 * Session handling.
 *
 * Sessions are database-backed rather than stateless JWTs so that logging out,
 * or revoking a compromised session, takes effect immediately. The cookie
 * holds a random token; only its SHA-256 hash is stored, so a leaked database
 * dump cannot be replayed as a login.
 */

const SESSION_COOKIE = 'msp_session';
const SESSION_TTL_DAYS = 30;

export interface AuthContext {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; timezone: string };
  role: WorkspaceRole;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  workspaceName?: string;
}): Promise<{ userId: string; token: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError('An account with that email already exists.');
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: hashPassword(input.password),
      memberships: {
        create: {
          role: 'owner',
          workspace: {
            create: {
              name: input.workspaceName?.trim() || `${input.name.trim()}'s workspace`,
              timezone: 'UTC',
            },
          },
        },
      },
    },
  });

  return { userId: user.id, token: await createSession(user.id) };
}

export async function authenticate(email: string, password: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

  // Hash regardless of whether the user exists so that response timing does not
  // reveal which emails are registered.
  const valid = user
    ? verifyPassword(password, user.passwordHash)
    : verifyPassword(password, hashPassword('placeholder'));

  if (!user || !valid) {
    throw new AuthError('Incorrect email or password.');
  }
  return createSession(user.id);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });

  // Opportunistic cleanup; cheap enough to run on login and keeps the table
  // from growing without a separate cron job.
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax', // "lax" so the OAuth redirect back from Facebook keeps the session.
    secure: env.isProduction,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Resolve the current user and their active workspace.
 *
 * Wrapped in React's `cache` so that a page rendering several server
 * components hits the database once per request rather than once per component.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            include: { workspace: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) return null;

  // Multi-workspace switching is not exposed yet; the first membership wins.
  const membership = session.user.memberships[0];
  if (!membership) return null;

  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      timezone: membership.workspace.timezone,
    },
    role: membership.role as WorkspaceRole,
  };
});

/** Same as {@link getAuthContext} but throws — for routes that require a login. */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw new AuthError('You must be signed in.');
  return context;
}

export function canManageAccounts(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}
