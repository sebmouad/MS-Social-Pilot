import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { prisma } from './prisma';

/**
 * Error tracking, self-hosted in the app's own database:
 * server, worker and browser errors grouped by kind, with the release they were
 * seen on, for root to read at /root/errors. Nothing leaves the server, and
 * the text is scrubbed before it is stored.
 */

export type ErrorSource = 'server' | 'worker' | 'browser';

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
/** Kept this long after the last occurrence. */
export const ERROR_RETENTION_DAYS = 90;

let release: string | null = null;
/** The commit being run: `RELEASE`, written by the deploy, else `dev`. */
export function currentRelease(): string {
  if (release === null) {
    try {
      release = readFileSync(join(process.cwd(), 'RELEASE'), 'utf8').trim().slice(0, 40) || 'dev';
    } catch {
      release = 'dev';
    }
  }
  return release;
}

/**
 * Takes out what must never be stored: access tokens, keys, passwords,
 * bearer credentials, email addresses and query strings.
 */
export function scrub(text: string): string {
  return text
    .replace(/\b(access_token|token|key|secret|password|passwd|signature|code|client_secret|appsecret_proof)=([^&\s"']+)/gi, '$1=[scrubbed]')
    .replace(/("?(?:access_?token|token|api_?key|secret|password|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[scrubbed]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [scrubbed]')
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, '[token]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[key]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[long value]');
}

/** A path without its query string or fragment, which can carry anything. */
export function cleanLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  return scrub(location.split(/[?#]/)[0]!).slice(0, 300);
}

/**
 * The same error from the same place is one row however often it happens:
 * numbers and ids in the message are folded so "Post abc123 failed" and
 * "Post def456 failed" group together.
 */
export function fingerprintOf(source: ErrorSource, name: string, message: string, stack: string | null): string {
  const normalised = message.replace(/\b[0-9a-f]{8,}\b|\b\d+\b|\bc[a-z0-9]{20,}\b/gi, '#');
  const frame = stack?.split('\n').find((line) => /^\s*at\s/.test(line))?.trim().replace(/:\d+:\d+\)?$/, '') ?? '';
  return createHash('sha256').update(`${source}\n${name}\n${normalised}\n${frame}`).digest('hex').slice(0, 32);
}

/** Store one occurrence. Never throws: error tracking must not cause errors. */
export async function recordError(input: {
  source: ErrorSource;
  error: unknown;
  location?: string | null;
}): Promise<void> {
  try {
    const error = input.error instanceof Error ? input.error : new Error(typeof input.error === 'string' ? input.error : JSON.stringify(input.error));
    const name = (error.name || 'Error').slice(0, 100);
    const message = scrub(error.message || name).slice(0, MAX_MESSAGE);
    const stack = error.stack ? scrub(error.stack).slice(0, MAX_STACK) : null;
    const fingerprint = fingerprintOf(input.source, name, message, stack);
    const now = new Date();
    const data = { message, stack, location: cleanLocation(input.location), release: currentRelease(), lastSeenAt: now };
    await prisma.errorEvent.upsert({
      where: { fingerprint },
      create: { fingerprint, source: input.source, name, ...data },
      update: { ...data, count: { increment: 1 }, resolvedAt: null },
    });
  } catch (failure) {
    console.error('[errors] could not record', failure);
  }
}

/** Housekeeping: forget errors not seen for the retention period. */
export async function pruneErrors(now = Date.now()): Promise<number> {
  const { count } = await prisma.errorEvent.deleteMany({
    where: { lastSeenAt: { lt: new Date(now - ERROR_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
  });
  return count;
}
