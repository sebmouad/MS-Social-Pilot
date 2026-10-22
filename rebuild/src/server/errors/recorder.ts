import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { ERRORS_CONFIG } from './config';

/**
 * Self-hosted error tracking: server, worker and browser errors grouped by fingerprint in `error_events`
 * for Root › Errors. Nothing leaves the database, and text is scrubbed before it is stored. Recording
 * never throws: error tracking must not cause errors.
 */
export type ErrorSource = 'server' | 'worker' | 'browser';

export type ErrorsPolicy = { [E in (typeof ERRORS_CONFIG)[number] as E['key']]: E['defaultValue'] extends boolean ? boolean : E['defaultValue'] extends number ? number : string };

const POLICY_KEYS = ERRORS_CONFIG.map(item => item.key);

/** Current Root policy; any unreadable value falls back to the registry default so recording keeps working. */
export async function loadErrorsPolicy(): Promise<ErrorsPolicy> {
  const defaults = Object.fromEntries(ERRORS_CONFIG.map(item => [item.key, item.defaultValue]));
  try {
    const stored = await runtimeConfigBatch(POLICY_KEYS);
    return { ...defaults, ...stored } as ErrorsPolicy;
  } catch {
    return defaults as ErrorsPolicy;
  }
}

/**
 * Takes out what must never be stored: access tokens, keys, passwords, bearer credentials, email
 * addresses and long opaque values. These rules are a security invariant, not an operating choice.
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
export function cleanLocation(location: string | null | undefined, maxCharacters: number): string | null {
  if (!location) return null;
  const path = location.split(/[?#]/)[0];
  return path ? scrub(path).slice(0, maxCharacters) : null;
}

/**
 * The same error from the same place is one row however often it happens: numbers and ids in the message
 * are folded so "Post abc123 failed" and "Post def456 failed" group together.
 */
export function fingerprintOf(source: ErrorSource, name: string, message: string, stack: string | null): string {
  const normalised = message.replace(/\b[0-9a-f]{8,}\b|\b\d+\b|\bc[a-z0-9]{20,}\b/gi, '#');
  const frame = stack?.split('\n').find(line => /^\s*at\s/.test(line))?.trim().replace(/:\d+:\d+\)?$/, '') ?? '';
  return createHash('sha256').update(`${source}\n${name}\n${normalised}\n${frame}`).digest('hex').slice(0, 32);
}

let cachedRelease: { file: string; value: string } | null = null;
/** The commit being run, from the deploy's marker file; a missing file yields the configured fallback label. */
export async function currentRelease(policy: Pick<ErrorsPolicy, 'errors.releaseFile' | 'errors.fallbackRelease' | 'errors.releaseMaxCharacters'>): Promise<string> {
  const file = policy['errors.releaseFile'];
  if (cachedRelease?.file === file) return cachedRelease.value;
  let value = policy['errors.fallbackRelease'];
  try {
    const first = (await readFile(join(process.cwd(), file), 'utf8')).split('\n')[0]?.trim().replace(/[^\x20-\x7e]/g, '');
    if (first) value = first;
  } catch { /* keep the fallback */ }
  value = value.slice(0, policy['errors.releaseMaxCharacters']);
  cachedRelease = { file, value };
  return value;
}

let lastPrune = 0;
/** Forget errors not seen for the retention period. Returns the number of groups removed. */
export async function pruneErrors(policy: Pick<ErrorsPolicy, 'errors.retentionDays'>, now = Date.now()): Promise<number> {
  const removed = await prisma.$executeRaw`DELETE FROM error_events WHERE "lastSeenAt" < ${new Date(now - policy['errors.retentionDays'] * 86_400_000)}`;
  return removed;
}

export type RecordErrorInput = { source: ErrorSource; error: unknown; location?: string | null };

/** Store one occurrence. Never throws. Returns whether a row was written. */
export async function recordError(input: RecordErrorInput): Promise<boolean> {
  try {
    const policy = await loadErrorsPolicy();
    if (!policy['errors.recordingEnabled']) return false;
    const raw = input.error;
    const error = raw instanceof Error ? raw : new Error(typeof raw === 'string' ? raw : safeJson(raw));
    const name = (error.name || 'Error').slice(0, policy['errors.nameMaxCharacters']);
    const message = scrub(error.message || name).slice(0, policy['errors.messageMaxCharacters']);
    const stack = error.stack && policy['errors.stackMaxCharacters'] > 0 ? scrub(error.stack).slice(0, policy['errors.stackMaxCharacters']) : null;
    const fingerprint = fingerprintOf(input.source, name, message, stack);
    const location = cleanLocation(input.location, policy['errors.locationMaxCharacters']);
    const release = await currentRelease(policy);
    await prisma.$executeRaw`
      INSERT INTO error_events (id, fingerprint, source, name, message, stack, location, release, count, "firstSeenAt", "lastSeenAt")
      VALUES (${randomUUID()}, ${fingerprint}, ${input.source}, ${name}, ${message}, ${stack}, ${location}, ${release}, 1, NOW(), NOW())
      ON CONFLICT (fingerprint) DO UPDATE SET message = EXCLUDED.message, stack = EXCLUDED.stack, location = EXCLUDED.location,
        release = EXCLUDED.release, count = error_events.count + 1, "lastSeenAt" = NOW(), "resolvedAt" = NULL`;
    const now = Date.now();
    if (now - lastPrune >= policy['errors.pruneIntervalMinutes'] * 60_000) {
      lastPrune = now;
      await pruneErrors(policy, now).catch(() => 0);
    }
    return true;
  } catch (failure) {
    console.error('[errors] could not record an error', failure instanceof Error ? failure.name : 'unknown');
    return false;
  }
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

/** Next.js `onRequestError` payload: the route that failed, never its query string or headers. */
export type RequestErrorContext = { routerKind?: string; routePath?: string; routeType?: string };
export function reportRequestError(error: unknown, request: { path?: string; method?: string }, context: RequestErrorContext): Promise<boolean> {
  return recordError({ source: 'server', error, location: context.routePath || request.path || null });
}

/** Test seam: forget cached release and cleanup timing. */
export function resetErrorRecorderForTests() { cachedRelease = null; lastPrune = 0; }
