import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { Locale, WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { ensureSettings } from './settings';
import { env } from './env';
import { hashPassword, hashToken, randomToken, verifyPassword } from './crypto';
import { uniqueSlug } from './slug';
import { DEFAULT_QUEUE_SLOTS } from './time';

/**
 * Sessions, and resolving which workspace the request is acting on.
 *
 * Sessions are database-backed rather than stateless JWTs so logging out, or
 * revoking a compromised session, takes effect immediately. The cookie holds a
 * random token; only its SHA-256 hash is stored.
 *
 * Workspace resolution is the security-critical part. A user can belong to
 * several workspaces (one per client), so every request must establish *which*
 * one it is acting on and confirm membership. `getAuthContext` never trusts a
 * requested workspace id without checking the membership row.
 */

const SESSION_COOKIE = 'msp_session';
const WORKSPACE_COOKIE = 'msp_workspace';
const SESSION_TTL_DAYS = 30;

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: WorkspaceRole;
  requiresApproval: boolean;
}

export interface AuthContext {
  user: { id: string; email: string; name: string; locale: Locale };
  workspace: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    requiresApproval: boolean;
    defaultLocale: Locale;
  };
  role: WorkspaceRole;
  /** Every workspace this user belongs to, for the switcher. */
  workspaces: WorkspaceSummary[];
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Create a workspace with its default posting queue.
 *
 * Seeding the queue matters: without it, "add to the next queue slot" fails on
 * a brand-new workspace, which is a confusing first experience.
 */
export async function createWorkspace(options: {
  name: string;
  ownerId: string;
  timezone?: string;
  locale?: Locale;
}): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlug(options.name, async (candidate) => {
    const existing = await prisma.workspace.findUnique({ where: { slug: candidate } });
    return existing !== null;
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: options.name,
      slug,
      timezone: options.timezone ?? 'UTC',
      defaultLocale: options.locale ?? Locale.en,
      memberships: { create: { userId: options.ownerId, role: WorkspaceRole.owner } },
      queueSlots: { create: DEFAULT_QUEUE_SLOTS },
      notificationSettings: { create: { userId: options.ownerId } },
    },
  });

  return { id: workspace.id, slug: workspace.slug };
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  workspaceName?: string;
  locale?: Locale;
  /** Skip workspace creation when the user is registering to accept an invite. */
  skipWorkspace?: boolean;
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
      locale: input.locale ?? Locale.en,
    },
  });

  if (!input.skipWorkspace) {
    const workspace = await createWorkspace({
      name: input.workspaceName?.trim() || `${input.name.trim()}'s workspace`,
      ownerId: user.id,
      locale: input.locale,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveWorkspaceId: workspace.id },
    });
  }

  return { userId: user.id, token: await createSession(user.id) };
}

export async function authenticate(email: string, password: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

  // Hash regardless of whether the user exists, so response timing does not
  // reveal which email addresses are registered.
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
  // Opportunistic cleanup; cheap, and keeps the table from growing unbounded
  // without a dedicated job.
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // "lax" so the OAuth redirect back from Facebook keeps the session.
    sameSite: 'lax',
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
  store.delete(WORKSPACE_COOKIE);
}

/** Remember the active workspace across requests. */
export async function setActiveWorkspaceCookie(workspaceId: string): Promise<void> {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

/**
 * Resolve the current user and the workspace they are acting on.
 *
 * Order of preference for the workspace: explicit argument (from a URL),
 * then the cookie, then the user's last active, then their first membership.
 * **Every one of those is validated against a membership row** — an id from a
 * cookie or a URL is a request, not a permission.
 *
 * Wrapped in React's `cache` so a page rendering several server components
 * hits the database once per request rather than once per component.
 */
export const getAuthContext = cache(async (requestedWorkspaceId?: string): Promise<AuthContext | null> => {
  // Every authenticated screen goes through here, so this is where runtime
  // configuration is loaded for server rendering — the mirror of the API
  // route wrapper doing it for requests.
  await ensureSettings();

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

  const { user } = session;
  if (user.memberships.length === 0) return null;

  const cookieWorkspaceId = store.get(WORKSPACE_COOKIE)?.value;
  const candidates = [requestedWorkspaceId, cookieWorkspaceId, user.lastActiveWorkspaceId];

  // Membership lookup is the authorisation check: an id nobody has a
  // membership for simply does not match, and we fall through to the default.
  const membership =
    candidates
      .filter((id): id is string => Boolean(id))
      .map((id) => user.memberships.find((entry) => entry.workspaceId === id))
      .find((entry) => entry !== undefined) ?? user.memberships[0]!;

  return {
    user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      timezone: membership.workspace.timezone,
      requiresApproval: membership.workspace.requiresApproval,
      defaultLocale: membership.workspace.defaultLocale,
    },
    role: membership.role,
    workspaces: user.memberships.map((entry) => ({
      id: entry.workspace.id,
      name: entry.workspace.name,
      slug: entry.workspace.slug,
      timezone: entry.workspace.timezone,
      role: entry.role,
      requiresApproval: entry.workspace.requiresApproval,
    })),
  };
});

/**
 * Page-context guard: redirect to sign-in rather than throwing.
 *
 * `requireAuth` throws, which is right for an API route — the wrapper turns it
 * into a 401. In a server component it produces a 500 error page instead, and
 * Next renders pages alongside their layout, so the layout's own redirect does
 * not prevent the throw. Screens use this; API routes use `requireAuth`.
 */
export async function requirePage(requestedWorkspaceId?: string): Promise<AuthContext> {
  const context = await getAuthContext(requestedWorkspaceId);
  if (!context) redirect('/login');
  return context;
}

/** Same as {@link getAuthContext} but throws — for routes that require a login. */
export async function requireAuth(requestedWorkspaceId?: string): Promise<AuthContext> {
  const context = await getAuthContext(requestedWorkspaceId);
  if (!context) throw new AuthError('You must be signed in.');
  return context;
}

/**
 * Require a login and a capability. `check` is one of the predicates in
 * src/lib/constants.ts, so permission questions have a single answer shared by
 * the UI and the API.
 */
export async function requireCapability(
  check: (role: WorkspaceRole) => boolean,
  message = 'You do not have permission to do that.',
): Promise<AuthContext> {
  const context = await requireAuth();
  if (!check(context.role)) throw new ForbiddenError(message);
  return context;
}

/** Switch the active workspace, verifying membership before doing so. */
export async function switchWorkspace(userId: string, workspaceId: string): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) throw new ForbiddenError('You are not a member of that workspace.');

  await prisma.user.update({ where: { id: userId }, data: { lastActiveWorkspaceId: workspaceId } });
  await setActiveWorkspaceCookie(workspaceId);
}
