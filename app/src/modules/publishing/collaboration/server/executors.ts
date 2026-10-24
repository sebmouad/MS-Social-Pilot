
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import type { CollabBounds } from '../config';
import { ID, nextRecycleAt } from '../schemas';
import type { RecycleExecutorPort, MixExecutorPort, QueueSchedulerPort } from '../ports';
import { bounds, transact, type Tx } from './core';
import { queueSeasons, seasonAdjuster } from '@/modules/calendar-extras/server/queue-seasons';

/**
 * Module-owned executors for recycling, queue-time allocation and the content mix.
 *
 * The shared worker calls `runRecycleCycle` / `runContentMix`; lifecycle calls `nextAvailableSlot` (inside its own
 * save transaction, after taking the workspace lock) for queued posts. Nothing here runs by itself and nothing is
 * advertised until the host registers the matching ports (`RECYCLE_EXECUTOR`, `QUEUE_SCHEDULER`, `MIX_EXECUTOR`)
 * with registerCollaborationPorts, after wiring the calls.
 *
 * Safety model: every unit of work runs in one workspace transaction holding the workspace advisory lock and row
 * locks (`FOR UPDATE SKIP LOCKED`), re-checks its due condition under the lock (compare-and-set), and uses
 * deterministic ids, so a second worker or a retry creates nothing twice. Every query carries the workspace id.
 */
export const RECYCLE_EXECUTOR: RecycleExecutorPort = { available: true };
export const QUEUE_SCHEDULER: QueueSchedulerPort = { available: true };
export const MIX_EXECUTOR: MixExecutorPort = { available: true };

// ---- pure scheduling helpers ------------------------------------------------
export type Slot = { dayOfWeek: number; hour: number; minute: number };
type SlotRow = Slot & { targetId: string | null };

/** Which wording run `runIndex` uses; 0 is the original. Falls back to the original text. */
export function variantForRun(original: string, variants: readonly string[], runIndex: number): string {
  const pool = [original, ...variants].filter(text => text.trim().length > 0);
  return pool.length ? pool[runIndex % pool.length]! : original;
}

const FORMATS = new Map<string, Intl.DateTimeFormat>();
function parts(timeZone: string, at: Date) {
  let f = FORMATS.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); FORMATS.set(timeZone, f); }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}
const offsetMs = (timeZone: string, at: Date) => { const p = parts(timeZone, at); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000; };
/** Wall-clock time in a zone to UTC; null when that local time does not exist (daylight-saving gap). */
export function wallToUtc(timeZone: string, y: number, m: number, d: number, h: number, mi: number): Date | null {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(timeZone, new Date(guess));
  const second = new Date(guess - offsetMs(timeZone, new Date(first)));
  const back = parts(timeZone, second);
  return back.year === y && back.month === m && back.day === d && back.hour === h && back.minute === mi ? second : null;
}

/**
 * The queue times a post to these channels can take: a time every channel shares, or a time each of its channels has
 * of its own. A post goes out once, so it needs a time valid for all its channels.
 */
export function slotsForPages(rows: readonly SlotRow[], targetIds: readonly string[]): Slot[] {
  const key = (s: Slot) => `${s.dayOfWeek}-${s.hour}-${s.minute}`;
  const shared = new Map<string, Slot>();
  const own = new Map<string, { slot: Slot; pages: Set<string> }>();
  for (const row of rows) {
    const slot = { dayOfWeek: row.dayOfWeek, hour: row.hour, minute: row.minute };
    if (row.targetId === null) shared.set(key(slot), slot);
    else if (targetIds.includes(row.targetId)) { const e = own.get(key(slot)) ?? { slot, pages: new Set<string>() }; e.pages.add(row.targetId); own.set(key(slot), e); }
  }
  const result = new Map(shared);
  for (const [k, e] of own) if (targetIds.length > 0 && targetIds.every(id => e.pages.has(id))) result.set(k, e.slot);
  return [...result.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute);
}

/** First free queue time strictly after `now`, within `horizonDays`, in the workspace time zone. Null when none. */
export function nextAvailableSlot(o: { slots: readonly Slot[]; timeZone: string; takenUtc: readonly Date[]; now: Date; horizonDays: number; /** Shapes one local day's slots (seasonal rules); receives the day as yyyy-MM-dd. */ adjustDay?: (daySlots: readonly Slot[], day: string) => Slot[] }): Date | null {
  if (!o.slots.length) return null;
  const taken = new Set(o.takenUtc.map(d => Math.floor(d.getTime() / 60_000)));
  const today = parts(o.timeZone, o.now);
  for (let i = 0; i <= o.horizonDays + 1; i++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const dow = day.getUTCDay();
    const base = o.slots.filter(x => x.dayOfWeek === dow);
    for (const s of o.adjustDay ? o.adjustDay(base, day.toISOString().slice(0, 10)) : base) {
      const at = wallToUtc(o.timeZone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.hour, s.minute);
      if (!at || at.getTime() <= o.now.getTime() || at.getTime() > o.now.getTime() + o.horizonDays * 86_400_000) continue;
      if (!taken.has(Math.floor(at.getTime() / 60_000))) return at;
    }
  }
  return null;
}

const OCCUPYING = ['scheduled', 'pending_approval', 'publishing'];
/**
 * For lifecycle: the next free queue time for a post going to `targetIds`. Call inside the transaction that also writes the
 * post, after taking the workspace lock, so two writers are never handed the same time. Optional authorized best-time
 * slots are tried first, then the saved timetable. Null means neither has a free time in the horizon.
 */
export async function allocateQueueTime(tx: Tx, workspaceId: string, timeZone: string, targetIds: readonly string[], now = new Date(), horizonDays?: number, preferredSlots: readonly Slot[] = []): Promise<Date | null> {
  const days = horizonDays ?? (await bounds()).queueLookaheadDays;
  const [rows, taken] = await Promise.all([
    tx.$queryRaw<SlotRow[]>`SELECT "targetId", "dayOfWeek", hour, minute FROM queue_slots WHERE "workspaceId" = ${workspaceId} AND ("targetId" IS NULL OR "targetId" = ANY(${[...targetIds]}::text[]))`,
    tx.$queryRaw<Array<{ scheduledAt: Date }>>`SELECT DISTINCT p."scheduledAt" FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text = ANY(${OCCUPYING}::text[]) AND p."scheduledAt" >= ${now} AND pt."targetId" = ANY(${[...targetIds]}::text[])`,
  ]);
  // Seasonal rules shape only the times offered for this new post; posts already scheduled are never moved.
  const adjustDay = seasonAdjuster(await queueSeasons(tx, workspaceId, now, new Date(now.getTime() + (days + 2) * 86_400_000)), targetIds);
  const occupancy = { timeZone, takenUtc: taken.map(t => t.scheduledAt), now, horizonDays: days, ...(adjustDay ? { adjustDay } : {}) };
  const preferred = [...preferredSlots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute);
  return nextAvailableSlot({ ...occupancy, slots: preferred }) ?? nextAvailableSlot({ ...occupancy, slots: slotsForPages(rows, targetIds) });
}

async function systemAudit(tx: Tx, workspaceId: string, action: string, detail: object) {
  const inserted = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, NULL, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (inserted !== 1) throw new Error('Could not record automation audit');
}

// ---- recycling --------------------------------------------------------------
export type RecycleRunResult = { checked: number; created: number; finished: number; skipped: number; failed: number };
export type AutomationLifecycle = {
  recycle(tx: Tx, input: { workspaceId: string; sourcePostId: string; copyId: string; message: string; scheduledAt: Date; run: number }): Promise<boolean>;
  stop(tx: Tx, input: { workspaceId: string; sourcePostId: string; reason: 'no_active_destinations' | 'repeat_limit' }): Promise<boolean>;
  schedule(tx: Tx, input: { workspaceId: string; postId: string; scheduledAt: Date; timeZone: string }): Promise<boolean>;
};
type DueRow = { id: string; workspaceId: string; message: string; firstComment: string | null; firstCommentDelayMinutes: number; format: string; link: string | null; linkPreview: unknown; media: unknown; mediaKeys: string[]; publishMode: string; timezone: string; authorId: string; recycleEveryDays: number | null; recycleLimit: number | null; recycleCount: number; recycleNextAt: Date | null; variants: unknown };
type CursorKey = 'publishing.automation.recycleCursor' | 'publishing.automation.mixCursor';

async function readCursor(key: CursorKey): Promise<string> {
  const errorText = await loadPublishingErrorText();
  const value = await runtimeConfig(key);
  if (typeof value !== 'string' || (value !== '' && !ID.safeParse(value).success)) throw new PublishingOperationError('unavailable', 'collaboration_27', {}, errorText);
  return value;
}

/** Advance a Root-managed keyset cursor only if its observed value is still current. */
async function advanceCursor(key: CursorKey, observed: string, next: string): Promise<void> {
  const errorText = await loadPublishingErrorText();
  if (next === observed) return;
  const existing = await prisma.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true } });
  if (existing ? existing.encrypted || existing.value !== observed : observed !== '') return;
  await prisma.$transaction(async tx => {
    const changed = existing
      ? await tx.$executeRaw`UPDATE app_settings SET value = ${JSON.stringify(next)}::jsonb, "updatedAt" = NOW() WHERE key = ${key} AND encrypted = FALSE AND value = ${JSON.stringify(observed)}::jsonb`
      : await tx.$executeRaw`INSERT INTO app_settings (key, value, encrypted, "updatedAt") VALUES (${key}, ${JSON.stringify(next)}::jsonb, FALSE, NOW()) ON CONFLICT (key) DO NOTHING`;
    if (changed !== 1) return;
    const audited = await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, NULL, 'publishing.automation_cursor_advanced', ${JSON.stringify({ key })}::jsonb, NOW())`;
    if (audited !== 1) throw new PublishingOperationError('unavailable', 'collaboration_28', {}, errorText);
  });
}

/**
 * Creates the next scheduled copy of every published post whose repeat is due. Each repeat is a new post (history stays intact),
 * claimed by compare-and-set on recycleNextAt before the copy exists, with the copy id derived from post and run number, so
 * neither a second worker nor a retry can create a duplicate. A post with no active destination stops repeating.
 * `eligible` lets the host apply its owner/plan/module rules per workspace; an ineligible workspace is left untouched.
 */
export async function runRecycleCycle(options: { now?: Date; workspaceId?: string; eligible?: (workspaceId: string) => Promise<boolean>; lifecycle?: AutomationLifecycle } = {}): Promise<RecycleRunResult> {
  const errorText = await loadPublishingErrorText();
  if (typeof options.eligible !== 'function' || !options.lifecycle || typeof options.lifecycle.recycle !== 'function' || typeof options.lifecycle.stop !== 'function') throw new PublishingOperationError('unavailable', 'collaboration_29', {}, errorText);
  if (options.workspaceId !== undefined && !ID.safeParse(options.workspaceId).success) throw new PublishingOperationError('invalid_request', 'collaboration_30', {}, errorText);
  const now = options.now ?? new Date();
  const limit = await bounds();
  const result: RecycleRunResult = { checked: 0, created: 0, finished: 0, skipped: 0, failed: 0 };
  const cursor = options.workspaceId === undefined ? await readCursor('publishing.automation.recycleCursor') : undefined;
  let due: Array<{ id: string; workspaceId: string }>;
  if (options.workspaceId !== undefined) {
    due = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT id, "workspaceId" FROM posts WHERE "workspaceId" = ${options.workspaceId} AND "recycleEnabled" = TRUE AND "recycleNextAt" <= ${now} AND status::text IN ('published', 'partially_failed') ORDER BY id ASC LIMIT ${limit.executorBatchSize}`;
  } else {
    due = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT id, "workspaceId" FROM posts WHERE id > ${cursor!} AND "recycleEnabled" = TRUE AND "recycleNextAt" <= ${now} AND status::text IN ('published', 'partially_failed') ORDER BY id ASC LIMIT ${limit.executorBatchSize}`;
    if (!due.length) due = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT id, "workspaceId" FROM posts WHERE "recycleEnabled" = TRUE AND "recycleNextAt" <= ${now} AND status::text IN ('published', 'partially_failed') ORDER BY id ASC LIMIT ${limit.executorBatchSize}`;
  }
  for (const item of due) {
    result.checked += 1;
    try {
      if (!(await options.eligible(item.workspaceId))) { result.skipped += 1; continue; }
      const outcome = await recycleOne(item.workspaceId, item.id, now, limit, options.lifecycle);
      if (outcome === 'created_finished') { result.created += 1; result.finished += 1; }
      else result[outcome] += 1;
    } catch { result.failed += 1; }
  }
  if (cursor !== undefined && due.length) await advanceCursor('publishing.automation.recycleCursor', cursor, due[due.length - 1]!.id);
  return result;
}

async function recycleOne(workspaceId: string, postId: string, now: Date, limit: CollabBounds, lifecycle: AutomationLifecycle): Promise<'created' | 'finished' | 'created_finished' | 'skipped'> {
  const errorText = await loadPublishingErrorText();
  return transact(workspaceId, limit, async tx => {
    const rows = await tx.$queryRaw<DueRow[]>`SELECT id, "workspaceId", message, "firstComment", "firstCommentDelayMinutes", format, link, "linkPreview", media, "mediaKeys", "publishMode"::text AS "publishMode", timezone, "authorId", "recycleEveryDays", "recycleLimit", "recycleCount", "recycleNextAt", variants FROM posts WHERE id = ${postId} AND "workspaceId" = ${workspaceId} AND "recycleEnabled" = TRUE AND "recycleNextAt" <= ${now} AND status::text IN ('published', 'partially_failed') FOR UPDATE SKIP LOCKED`;
    const post = rows[0];
    if (!post) return 'skipped'; // already taken, switched off or not due any more
    const live = await tx.$queryRaw<Array<{ targetId: string }>>`SELECT pt."targetId" FROM post_targets pt JOIN targets t ON t.id = pt."targetId" WHERE pt."postId" = ${postId} AND t."workspaceId" = ${workspaceId} AND t.enabled = TRUE ORDER BY pt."targetId" ASC`;
    const stop = async (reason: 'no_active_destinations' | 'repeat_limit') => {
      if (!(await lifecycle.stop(tx, { workspaceId, sourcePostId: postId, reason }))) return 'skipped' as const;
      const stopped = await tx.$executeRaw`UPDATE posts SET "recycleCount" = ${post.recycleCount}, "recycleEnabled" = FALSE, "recycleNextAt" = NULL, "updatedAt" = NOW() WHERE id = ${postId} AND "workspaceId" = ${workspaceId} AND "recycleNextAt" = ${post.recycleNextAt} AND "recycleCount" = ${post.recycleCount}`;
      if (stopped !== 1) throw new Error('Recycle stop state changed while locked');
      await systemAudit(tx, workspaceId, 'publishing.recycle_stopped', { postId, reason });
      return 'finished' as const;
    };
    if (!live.length) {
      return stop('no_active_destinations');
    }
    const variantsValid = Array.isArray(post.variants) && post.variants.length <= limit.variantsLimit && post.variants.every((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit.variantMaxCharacters);
    if (!Number.isInteger(post.recycleEveryDays) || post.recycleEveryDays! < 1 || post.recycleEveryDays! > limit.recycleMaxIntervalDays ||
      (post.recycleLimit !== null && (!Number.isInteger(post.recycleLimit) || post.recycleLimit < 1 || post.recycleLimit > limit.recycleMaxRepeats)) ||
      !Number.isInteger(post.recycleCount) || post.recycleCount < 0 || !variantsValid) throw new PublishingOperationError('unavailable', 'collaboration_31', {}, errorText);
    if (post.recycleLimit !== null && post.recycleCount >= post.recycleLimit) return stop('repeat_limit');
    const count = post.recycleCount + 1;
    const next = nextRecycleAt({ everyDays: post.recycleEveryDays, limit: post.recycleLimit, count, from: post.recycleNextAt ?? now, now });
    const variants = post.variants as string[];
    const copyId = `rc_${postId}_${count}`;
    const at = post.recycleNextAt && post.recycleNextAt > now ? post.recycleNextAt : now;
    const message = variantForRun(post.message, variants, count);
    if (!(await lifecycle.recycle(tx, { workspaceId, sourcePostId: postId, copyId, message, scheduledAt: at, run: count }))) return 'skipped';
    const claimed = await tx.$executeRaw`UPDATE posts SET "recycleCount" = ${count}, "recycleNextAt" = ${next}, "recycleEnabled" = ${next !== null}, "updatedAt" = NOW() WHERE id = ${postId} AND "workspaceId" = ${workspaceId} AND "recycleNextAt" = ${post.recycleNextAt}`;
    if (claimed !== 1) throw new Error('Recycle claim changed after lifecycle mutation');
    await systemAudit(tx, workspaceId, 'publishing.recycled', { postId, copyId, run: count, created: true, nextAt: next });
    return next === null ? 'created_finished' : 'created';
  });
}

// ---- content mix ------------------------------------------------------------
export type MixRunResult = { workspaces: number; scheduled: number; dry: number; skipped: number; failed: number };
export type MixDryNotice = { workspaceId: string; targetId: string; labelId: string };
type Rule = { id: string; targetId: string | null; groupId: string | null; labelId: string; perWeek: number; dryNotifiedAt: Date | null };
const key = (a: string, b: string) => `${a}\u0000${b}`;
const MANAGERS = new Set(['owner', 'admin', 'editor']);

/**
 * Fills each channel's weekly mix from ready drafts (only when the workspace turned auto-fill on) and marks labels that ran dry,
 * exactly once until drafts return. A draft is ready when approved, or not requiring approval for an author who may publish
 * without review; it must have only active destinations. Scheduling is one compare-and-set per draft inside the workspace
 * transaction. Notification intent, when installed, commits with the dry marker;
 * SMTP delivery happens later and cannot undo scheduling.
 */
export async function runContentMix(options: { now?: Date; workspaceId?: string; eligible?: (workspaceId: string) => Promise<boolean>; lifecycle?: AutomationLifecycle; enqueueNotice?: (tx: Tx, notice: MixDryNotice & { eventId: string }) => Promise<void> } = {}): Promise<MixRunResult> {
  const errorText = await loadPublishingErrorText();
  if (typeof options.eligible !== 'function' || !options.lifecycle || typeof options.lifecycle.schedule !== 'function') throw new PublishingOperationError('unavailable', 'collaboration_29', {}, errorText);
  if (options.workspaceId !== undefined && !ID.safeParse(options.workspaceId).success) throw new PublishingOperationError('invalid_request', 'collaboration_30', {}, errorText);
  const now = options.now ?? new Date();
  const limit = await bounds();
  const result: MixRunResult = { workspaces: 0, scheduled: 0, dry: 0, skipped: 0, failed: 0 };
  const cursor = options.workspaceId === undefined ? await readCursor('publishing.automation.mixCursor') : undefined;
  let list: Array<{ workspaceId: string }>;
  if (options.workspaceId !== undefined) {
    list = await prisma.$queryRaw<Array<{ workspaceId: string }>>`SELECT DISTINCT "workspaceId" FROM content_mix_rules WHERE "workspaceId" = ${options.workspaceId} ORDER BY "workspaceId" ASC LIMIT ${limit.executorBatchSize}`;
  } else {
    list = await prisma.$queryRaw<Array<{ workspaceId: string }>>`SELECT DISTINCT "workspaceId" FROM content_mix_rules WHERE "workspaceId" > ${cursor!} ORDER BY "workspaceId" ASC LIMIT ${limit.executorBatchSize}`;
    if (!list.length) list = await prisma.$queryRaw<Array<{ workspaceId: string }>>`SELECT DISTINCT "workspaceId" FROM content_mix_rules ORDER BY "workspaceId" ASC LIMIT ${limit.executorBatchSize}`;
  }
  for (const { workspaceId } of list) {
    result.workspaces += 1;
    try {
      if (!(await options.eligible(workspaceId))) { result.skipped += 1; continue; }
      const out = await mixOne(workspaceId, now, limit, options.lifecycle, options.eligible, options.enqueueNotice);
      result.scheduled += out.scheduled; result.dry += out.notices.length; result.skipped += out.skipped;
    } catch { result.failed += 1; }
  }
  if (cursor !== undefined && list.length) await advanceCursor('publishing.automation.mixCursor', cursor, list[list.length - 1]!.workspaceId);
  return result;
}

async function mixOne(workspaceId: string, now: Date, limit: CollabBounds, lifecycle: AutomationLifecycle, eligible: (workspaceId: string) => Promise<boolean>, enqueueNotice?: (tx: Tx, notice: MixDryNotice & { eventId: string }) => Promise<void>): Promise<{ scheduled: number; skipped: number; notices: MixDryNotice[] }> {
  return transact(workspaceId, limit, async tx => {
    const ws = await tx.$queryRaw<Array<{ timezone: string; mixAutoFill: boolean; requiresApproval: boolean }>>`SELECT timezone, "mixAutoFill", "requiresApproval" FROM workspaces WHERE id = ${workspaceId} FOR SHARE`;
    if (!ws[0]) return { scheduled: 0, skipped: 0, notices: [] };
    const { timezone, mixAutoFill, requiresApproval } = ws[0];
    const until = new Date(now.getTime() + limit.mixWindowDays * 86_400_000);
    const rules = await tx.$queryRaw<Rule[]>`SELECT id, "targetId", "groupId", "labelId", "perWeek", "dryNotifiedAt" FROM content_mix_rules WHERE "workspaceId" = ${workspaceId} ORDER BY "createdAt" ASC, id ASC FOR UPDATE`;
    const channels = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE "workspaceId" = ${workspaceId} AND enabled = TRUE ORDER BY id ASC`;
    const ids = channels.map(c => c.id);
    const memberships = await tx.$queryRaw<Array<{ groupId: string; targetId: string }>>`SELECT gt."groupId", gt."targetId" FROM page_group_targets gt JOIN page_groups g ON g.id = gt."groupId" WHERE g."workspaceId" = ${workspaceId} AND gt."targetId" = ANY(${ids}::text[])`;
    const groupsOf = new Map<string, string[]>();
    for (const m of memberships) groupsOf.set(m.targetId, [...(groupsOf.get(m.targetId) ?? []), m.groupId]);
    const { effectiveMix } = await import('../schemas');
    const mixes = effectiveMix(rules, ids, groupsOf);
    if (!mixes.size) return { scheduled: 0, skipped: 0, notices: [] };
    const mixIds = [...mixes.keys()];
    const planned = await tx.$queryRaw<Array<{ id: string; targets: string[]; labels: string[] }>>`SELECT p.id, ARRAY_AGG(DISTINCT pt."targetId") AS targets, COALESCE(ARRAY_AGG(DISTINCT pl."labelId") FILTER (WHERE pl."labelId" IS NOT NULL), '{}') AS labels FROM posts p JOIN post_targets pt ON pt."postId" = p.id LEFT JOIN post_labels pl ON pl."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text IN ('scheduled', 'pending_approval', 'publishing', 'published') AND p."scheduledAt" >= ${now} AND p."scheduledAt" < ${until} GROUP BY p.id HAVING ARRAY_AGG(DISTINCT pt."targetId") && ${mixIds}::text[]`;
    const drafts = await tx.$queryRaw<Array<{ id: string; authorId: string; approvalStatus: string; targets: string[]; allActive: boolean; labels: string[] }>>`SELECT p.id, p."authorId", p."approvalStatus"::text AS "approvalStatus", ARRAY_AGG(DISTINCT pt."targetId") AS targets, BOOL_AND(t.enabled) AS "allActive", COALESCE(ARRAY_AGG(DISTINCT pl."labelId") FILTER (WHERE pl."labelId" IS NOT NULL), '{}') AS labels FROM posts p JOIN post_targets pt ON pt."postId" = p.id JOIN targets t ON t.id = pt."targetId" LEFT JOIN post_labels pl ON pl."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text = 'draft' GROUP BY p.id HAVING ARRAY_AGG(DISTINCT pt."targetId") && ${mixIds}::text[] AND COUNT(pl."labelId") > 0 ORDER BY MIN(p."createdAt") ASC, p.id ASC`;
    const roles = new Map((await tx.$queryRaw<Array<{ userId: string; role: string }>>`SELECT "userId", role::text AS role FROM memberships WHERE "workspaceId" = ${workspaceId}`).map(m => [m.userId, m.role]));
    const ready = (d: (typeof drafts)[number]) => d.allActive && (d.approvalStatus === 'approved' || (d.approvalStatus === 'not_required' && (!requiresApproval || MANAGERS.has(roles.get(d.authorId) ?? ''))));
    const used = new Set<string>();
    const taken = (await tx.$queryRaw<Array<{ scheduledAt: Date; targets: string[] }>>`SELECT p."scheduledAt", ARRAY_AGG(DISTINCT pt."targetId") AS targets FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text = ANY(${OCCUPYING}::text[]) AND p."scheduledAt" >= ${now} GROUP BY p.id`);
    const slotRows = await tx.$queryRaw<SlotRow[]>`SELECT "targetId", "dayOfWeek", hour, minute FROM queue_slots WHERE "workspaceId" = ${workspaceId}`;
    const seasons = await queueSeasons(tx, workspaceId, now, new Date(now.getTime() + (limit.mixWindowDays + 2) * 86_400_000));
    let scheduled = 0; let skipped = 0;
    const dryRules: Array<{ targetId: string; labelId: string; rules: Rule[] }> = [];
    const recovered: string[] = [];
    for (const [targetId, mix] of mixes) for (const [labelId, entry] of mix) {
      let short = entry.perWeek - planned.filter(p => p.targets.includes(targetId) && p.labels.includes(labelId)).length;
      const candidates = drafts.filter(d => !used.has(d.id) && d.targets.includes(targetId) && d.labels.includes(labelId) && ready(d));
      let declined = false;
      while (mixAutoFill && short > 0 && candidates.length) {
        const draft = candidates.shift()!;
        const slots = slotsForPages(slotRows, draft.targets);
        const takenFor = taken.filter(t => t.targets.some(x => draft.targets.includes(x))).map(t => t.scheduledAt);
        const adjustDay = seasonAdjuster(seasons, draft.targets);
        const at = nextAvailableSlot({ slots, timeZone: timezone, takenUtc: takenFor, now, horizonDays: limit.mixWindowDays, ...(adjustDay ? { adjustDay } : {}) });
        if (!at) break;
        if (!(await eligible(workspaceId))) { skipped += 1; declined = true; break; }
        if (!(await lifecycle.schedule(tx, { workspaceId, postId: draft.id, scheduledAt: at, timeZone: timezone }))) { skipped += 1; declined = true; continue; }
        used.add(draft.id); scheduled += 1; short -= 1;
        taken.push({ scheduledAt: at, targets: draft.targets });
        planned.push({ id: draft.id, targets: draft.targets, labels: draft.labels });
      }
      if (!declined && short > 0 && candidates.length === 0) dryRules.push({ targetId, labelId, rules: entry.rules });
      else recovered.push(...entry.rules.filter(r => r.dryNotifiedAt).map(r => r.id));
    }
    if (recovered.length) await tx.$executeRaw`UPDATE content_mix_rules SET "dryNotifiedAt" = NULL WHERE "workspaceId" = ${workspaceId} AND id = ANY(${recovered}::text[])`;
    const notices: MixDryNotice[] = [];
    for (const d of dryRules) {
      const fresh = d.rules.filter(r => !r.dryNotifiedAt).map(r => r.id);
      if (!fresh.length) continue;
      const won = await tx.$executeRaw`UPDATE content_mix_rules SET "dryNotifiedAt" = ${now} WHERE "workspaceId" = ${workspaceId} AND id = ANY(${fresh}::text[]) AND "dryNotifiedAt" IS NULL`;
      if (won === 0) continue;
      await enqueueNotice?.(tx, { workspaceId, targetId: d.targetId, labelId: d.labelId, eventId: randomUUID() });
      notices.push({ workspaceId, targetId: d.targetId, labelId: d.labelId });
      await systemAudit(tx, workspaceId, 'publishing.mix_ran_dry', { targetId: d.targetId, labelId: d.labelId });
    }
    return { scheduled, skipped, notices };
  });
}
