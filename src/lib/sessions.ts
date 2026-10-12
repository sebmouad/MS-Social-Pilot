import { headers } from 'next/headers';
import { createHash } from 'node:crypto';

import { prisma } from './prisma';
import { clientCountry, clientIpFromHeaders } from './client-ip';
import { sendEmail } from './email/send';
import { newSignInEmail } from './email/templates';

/**
 * Signed-in devices (NEXT_PHASES G4): what each session was opened from, the
 * list a person sees in Settings → Account and root sees for everybody, and
 * the email when someone signs in from a browser this account has not used.
 */

/** How stale `lastSeenAt` may get before a request bumps it. */
const SEEN_EVERY_MS = 5 * 60 * 1000;
/** Browsers remembered per person; the oldest drop off. */
const KNOWN_DEVICES_CAP = 20;

export interface DeviceInfo {
  userAgent: string | null;
  ip: string | null;
  country: string | null;
}

/** Where the current request comes from. Empty outside a request (scripts, tests). */
export async function requestDevice(): Promise<DeviceInfo> {
  try {
    const list = await headers();
    return {
      userAgent: list.get('user-agent')?.slice(0, 300) || null,
      ip: clientIpFromHeaders(list),
      country: clientCountry(list),
    };
  } catch {
    return { userAgent: null, ip: null, country: null };
  }
}

/**
 * "Chrome on macOS" from a user-agent string. Deliberately rough: it names the
 * device well enough to recognise it, nothing more.
 */
export function describeDevice(userAgent: string | null): { browser: string | null; os: string | null } {
  if (!userAgent) return { browser: null, os: null };
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return { browser, os };
}

/** A browser's fingerprint for "seen before": its user agent, hashed. */
function fingerprint(userAgent: string): string {
  return createHash('sha256').update(userAgent).digest('hex').slice(0, 16);
}

/**
 * A full sign-in has happened on this session: remember the browser, and email
 * the person when it is one their account has not signed in from before. The
 * very first sign-in only remembers it — there is nothing to compare against.
 */
export async function noteSignIn(sessionId: string, now = new Date()): Promise<{ emailed: boolean }> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      userAgent: true,
      ip: true,
      country: true,
      user: { select: { id: true, email: true, locale: true, knownDevices: true } },
    },
  });
  if (!session?.userAgent) return { emailed: false };

  const print = fingerprint(session.userAgent);
  const known = session.user.knownDevices;
  if (known.includes(print)) return { emailed: false };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { knownDevices: [...known, print].slice(-KNOWN_DEVICES_CAP) },
  });
  if (known.length === 0) return { emailed: false };

  const { browser, os } = describeDevice(session.userAgent);
  const rendered = newSignInEmail({
    locale: session.user.locale,
    device: [browser, os].filter(Boolean).join(' · ') || session.userAgent.slice(0, 80),
    place: [session.ip, session.country].filter(Boolean).join(' · ') || null,
    when: now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  });
  await sendEmail({ to: session.user.email, template: 'account.newDevice', ...rendered });
  return { emailed: true };
}

/** Keep `lastSeenAt` roughly current without a write on every request. */
export async function touchSession(sessionId: string, lastSeenAt: Date, now = new Date()): Promise<void> {
  if (now.getTime() - lastSeenAt.getTime() < SEEN_EVERY_MS) return;
  await prisma.session.updateMany({ where: { id: sessionId }, data: { lastSeenAt: now } });
}

export interface SessionView {
  id: string;
  browser: string | null;
  os: string | null;
  ip: string | null;
  country: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

function view(
  row: { id: string; tokenHash: string; userAgent: string | null; ip: string | null; country: string | null; createdAt: Date; lastSeenAt: Date },
  currentTokenHash: string | null,
): SessionView {
  return {
    id: row.id,
    ...describeDevice(row.userAgent),
    ip: row.ip,
    country: row.country,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    current: row.tokenHash === currentTokenHash,
  };
}

const SESSION_FIELDS = { id: true, tokenHash: true, userAgent: true, ip: true, country: true, createdAt: true, lastSeenAt: true } as const;

/** The person's signed-in browsers, this one first, then the most recently used. */
export async function listSessions(userId: string, currentTokenHash: string | null, now = new Date()): Promise<SessionView[]> {
  const rows = await prisma.session.findMany({
    where: { userId, pending: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: 'desc' },
    select: SESSION_FIELDS,
  });
  return rows.map((row) => view(row, currentTokenHash)).sort((a, b) => Number(b.current) - Number(a.current));
}

/** Sign one of the person's own browsers out. False when it is not theirs (or gone). */
export async function signOutSession(userId: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
  return count > 0;
}

/** Root: every signed-in browser on the installation, with whose it is. */
export async function listAllSessions(currentTokenHash: string | null, now = new Date()) {
  const rows = await prisma.session.findMany({
    where: { pending: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: 'desc' },
    take: 500,
    select: { ...SESSION_FIELDS, user: { select: { id: true, name: true, email: true } } },
  });
  return rows.map((row) => ({ ...view(row, currentTokenHash), user: row.user }));
}

/** Root: sign any one browser out. */
export async function rootSignOutSession(sessionId: string): Promise<{ userId: string; email: string } | null> {
  const row = await prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, user: { select: { email: true } } } });
  if (!row) return null;
  await prisma.session.deleteMany({ where: { id: sessionId } });
  return { userId: row.userId, email: row.user.email };
}
