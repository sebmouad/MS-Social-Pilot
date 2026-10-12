/**
 * How much of the Meta app's call allowance is left, as this process last saw
 * it — so background reading stands aside before publishing runs out.
 *
 * Meta meters an app, not a Page: every call this installation makes, for
 * every Page, draws on one allowance of about two hundred calls an hour per
 * person who has used the app. A small installation has one such person. Its
 * syncs — every post's metric catalogue, every Page's insights, comments,
 * inbox — can spend that allowance on their own, and once it is gone Facebook
 * refuses everything, a scheduled post included, until the hour rolls over.
 *
 * Facebook reports the share used on every response (`x-app-usage`), and the
 * refusal itself is an error code. Both are noted here; the background jobs
 * ask before they start, and publishing never does. In memory, per process:
 * the worker makes the background calls, so it is the worker's view that
 * matters, and a restart starts optimistic — the first refusal corrects it.
 */

/** Above this share used, background syncs wait and publishing keeps the rest. */
export const BACKGROUND_USAGE_CEILING = 75;
/** How long a reading, or a refusal, is taken to hold. Meta's window is an hour. */
const HOLD_MS = 60 * 60 * 1000;
/** After a refusal, how long to stay off before trying again. */
export const THROTTLE_COOLDOWN_MS = 30 * 60 * 1000;

let usage: { percent: number; at: number } | null = null;
let throttledAt: number | null = null;

/**
 * Meta also meters each Page, Instagram account and ad account on its own
 * (the "business use case" limits), and reports them per object in
 * `x-business-use-case-usage`. One busy Page can be refused while the app has
 * plenty left, so each object is tracked by its id.
 */
interface ObjectUsage {
  percent: number;
  at: number;
  /** Facebook said, or a refusal implied, that this object is off until then. */
  blockedUntil: number | null;
}
const objects = new Map<string, ObjectUsage>();

/** Calls made, per minute, over the last hour: what this process actually spent. */
const callMinutes = new Map<number, number>();
/**
 * The same calls by who they were about and which worker job made them
 * (NEXT_PHASES H16), keyed `minute|object|job`; empty object or job means
 * none could be told.
 */
const callSources = new Map<string, number>();

/**
 * Above this share used, reads that can wait are refused here, before they
 * reach Facebook. The worker lowers it to the background ceiling; the web app
 * keeps a little more for what a person is waiting on.
 */
const DEFAULT_READ_CEILING = 90;
let readCeiling = DEFAULT_READ_CEILING;

/** The share of the allowance Facebook says is used, from a response header. */
export function noteAppUsage(percent: number | null, now: number = Date.now()): void {
  if (percent === null || !Number.isFinite(percent)) return;
  usage = { percent, at: now };
}

/** Facebook refused a call for the app being over its limit. */
export function noteThrottled(now: number = Date.now()): void {
  throttledAt = now;
  usage = { percent: 100, at: now };
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: string; retryInMs: number };

/** The newest reading of the app's call allowance used (%), if one is recent. */
export function currentAppUsage(now: number = Date.now()): number | null {
  return usage && now - usage.at < HOLD_MS ? usage.percent : null;
}

/** Whether a background sync may spend calls now. */
export function backgroundBudget(now: number = Date.now()): BudgetVerdict {
  if (throttledAt !== null && now - throttledAt < THROTTLE_COOLDOWN_MS) {
    return {
      ok: false,
      reason: 'Facebook is refusing calls for this app (request limit reached)',
      retryInMs: THROTTLE_COOLDOWN_MS - (now - throttledAt),
    };
  }
  if (usage && now - usage.at < HOLD_MS && usage.percent >= BACKGROUND_USAGE_CEILING) {
    return {
      ok: false,
      reason: `this app has used ${Math.round(usage.percent)}% of its Facebook call allowance`,
      // Meta's window slides; a quarter of an hour frees a quarter of it.
      retryInMs: 15 * 60 * 1000,
    };
  }
  return { ok: true };
}

/** Set the share used above which reads that can wait are refused locally. */
export function setReadCeiling(percent: number): void {
  readCeiling = percent;
}

/**
 * Read `x-business-use-case-usage`: `{ "<object id>": [{ type, call_count,
 * total_cputime, total_time, estimated_time_to_regain_access }] }`, the
 * percentages per object and the minutes until a refused one is let back.
 */
export function noteObjectUsage(header: string | null, now: number = Date.now()): void {
  if (!header) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(header);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  for (const [id, entries] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    let percent = 0;
    let regainMinutes = 0;
    for (const entry of entries as Array<Record<string, unknown>>) {
      for (const key of ['call_count', 'total_cputime', 'total_time']) {
        const value = entry?.[key];
        if (typeof value === 'number' && Number.isFinite(value)) percent = Math.max(percent, value);
      }
      const regain = entry?.estimated_time_to_regain_access;
      if (typeof regain === 'number' && regain > 0) regainMinutes = Math.max(regainMinutes, regain);
    }
    objects.set(id, { percent, at: now, blockedUntil: regainMinutes > 0 ? now + regainMinutes * 60_000 : null });
  }
}

/** Facebook refused a call because one Page or account is over its own limit. */
export function noteObjectThrottled(id: string, now: number = Date.now()): void {
  const known = objects.get(id);
  const blockedUntil = Math.max(known?.blockedUntil ?? 0, now + THROTTLE_COOLDOWN_MS);
  objects.set(id, { percent: 100, at: now, blockedUntil });
}

/** Count one call made by this process, with the object it was about and the job making it, when known. */
export function noteCall(now: number = Date.now(), source: { object?: string | null; job?: string | null } = {}): void {
  const minute = Math.floor(now / 60_000);
  callMinutes.set(minute, (callMinutes.get(minute) ?? 0) + 1);
  for (const key of callMinutes.keys()) if (key <= minute - 60) callMinutes.delete(key);
  const key = `${minute}|${source.object ?? ''}|${source.job ?? ''}`;
  callSources.set(key, (callSources.get(key) ?? 0) + 1);
  for (const old of callSources.keys()) if (Number(old.split('|')[0]) <= minute - 60) callSources.delete(old);
}

/** Calls in the last hour per object and per job, busiest first. */
export function callsBySource(now: number = Date.now()): { objects: Array<{ id: string; calls: number }>; jobs: Array<{ name: string; calls: number }> } {
  const minute = Math.floor(now / 60_000);
  const objectCalls = new Map<string, number>();
  const jobCalls = new Map<string, number>();
  for (const [key, count] of callSources) {
    const [at, object, job] = key.split('|');
    if (Number(at) <= minute - 60) continue;
    if (object) objectCalls.set(object, (objectCalls.get(object) ?? 0) + count);
    jobCalls.set(job ?? '', (jobCalls.get(job ?? '') ?? 0) + count);
  }
  const sorted = <T extends { calls: number }>(rows: T[]) => rows.sort((a, b) => b.calls - a.calls);
  return {
    objects: sorted([...objectCalls].map(([id, calls]) => ({ id, calls }))),
    jobs: sorted([...jobCalls].map(([name, calls]) => ({ name, calls }))),
  };
}

/** Calls this process made in the last hour. */
export function callsLastHour(now: number = Date.now()): number {
  const minute = Math.floor(now / 60_000);
  let total = 0;
  for (const [key, count] of callMinutes) if (key > minute - 60) total += count;
  return total;
}

/**
 * The object a Graph path is about, as Meta keys its per-object limits:
 * `123/feed` and `123_456` are Page 123, `act_789/insights` is ad account 789.
 */
export function pathObjectId(path: string): string | null {
  const first = path.replace(/^\/+/, '').split(/[/?]/)[0] ?? '';
  const id = first.replace(/^act_/, '').split('_')[0] ?? '';
  return /^\d+$/.test(id) ? id : null;
}

/**
 * Whether a read that can wait may go to Facebook now. Writes, and the reads
 * that publishing itself needs, never ask: they are what the allowance is kept
 * for.
 */
export function readBudget(path: string, now: number = Date.now()): BudgetVerdict {
  if (throttledAt !== null && now - throttledAt < THROTTLE_COOLDOWN_MS) {
    return {
      ok: false,
      reason: 'Facebook is refusing calls for this app (request limit reached)',
      retryInMs: THROTTLE_COOLDOWN_MS - (now - throttledAt),
    };
  }
  if (usage && now - usage.at < HOLD_MS && usage.percent >= readCeiling) {
    return {
      ok: false,
      reason: `this app has used ${Math.round(usage.percent)}% of its Facebook call allowance`,
      retryInMs: 15 * 60 * 1000,
    };
  }
  const id = pathObjectId(path);
  const object = id ? objects.get(id) : undefined;
  if (object) {
    if (object.blockedUntil !== null && now < object.blockedUntil) {
      return {
        ok: false,
        reason: 'Facebook is refusing calls for this profile (its own request limit is reached)',
        retryInMs: object.blockedUntil - now,
      };
    }
    if (now - object.at < HOLD_MS && object.percent >= readCeiling) {
      return {
        ok: false,
        reason: `this profile has used ${Math.round(object.percent)}% of its Facebook call allowance`,
        retryInMs: 15 * 60 * 1000,
      };
    }
  }
  return { ok: true };
}

/** What a process knows about the allowance, to save and to show. */
export interface BudgetSnapshot {
  app: { percent: number | null; throttledUntil: number | null; callsLastHour: number; at: number };
  objects: Array<{ id: string; percent: number; at: number; blockedUntil: number | null }>;
  /** Calls in the last hour per object and per job (H16); absent in snapshots saved before. */
  calls?: ReturnType<typeof callsBySource>;
}

export function budgetSnapshot(now: number = Date.now()): BudgetSnapshot {
  return {
    app: {
      percent: currentAppUsage(now),
      throttledUntil:
        throttledAt !== null && now - throttledAt < THROTTLE_COOLDOWN_MS ? throttledAt + THROTTLE_COOLDOWN_MS : null,
      callsLastHour: callsLastHour(now),
      at: now,
    },
    objects: [...objects]
      .filter(([, entry]) => now - entry.at < HOLD_MS || (entry.blockedUntil ?? 0) > now)
      .map(([id, entry]) => ({ id, ...entry })),
    calls: callsBySource(now),
  };
}

/**
 * Take back what an earlier process saw, so a restarted worker does not start
 * optimistic and spend an allowance that is already gone. Readings past
 * Meta's hour are dropped.
 */
export function restoreBudget(snapshot: BudgetSnapshot, now: number = Date.now()): void {
  const { app } = snapshot;
  if (app.percent !== null && now - app.at < HOLD_MS && !usage) usage = { percent: app.percent, at: app.at };
  if (app.throttledUntil !== null && app.throttledUntil > now && throttledAt === null) {
    throttledAt = app.throttledUntil - THROTTLE_COOLDOWN_MS;
  }
  for (const entry of snapshot.objects) {
    if (objects.has(entry.id)) continue;
    if (now - entry.at < HOLD_MS || (entry.blockedUntil ?? 0) > now) {
      objects.set(entry.id, { percent: entry.percent, at: entry.at, blockedUntil: entry.blockedUntil });
    }
  }
}

/** For tests: forget everything seen. */
export function resetBudget(): void {
  usage = null;
  throttledAt = null;
  objects.clear();
  callMinutes.clear();
  callSources.clear();
  readCeiling = DEFAULT_READ_CEILING;
}
