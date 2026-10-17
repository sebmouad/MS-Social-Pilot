import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import type { CollabBounds } from '../config';
import { nextRecycleAt } from '../schemas';
import type { RecycleExecutorPort, MixExecutorPort, QueueSchedulerPort } from '../ports';
import { bounds, transact, type Tx } from './core';

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
export function nextAvailableSlot(o: { slots: readonly Slot[]; timeZone: string; takenUtc: readonly Date[]; now: Date; horizonDays: number }): Date | null {
  if (!o.slots.length) return null;
  const taken = new Set(o.takenUtc.map(d => Math.floor(d.getTime() / 60_000)));
  const today = parts(o.timeZone, o.now);
  for (let i = 0; i <= o.horizonDays + 1; i++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const dow = day.getUTCDay();
    for (const s of o.slots.filter(x => x.dayOfWeek === dow)) {
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
 * post, after taking the workspace lock, so two writers are never handed the same time. Null means no queue times or none free.
 */
export async function allocateQueueTime(tx: Tx, workspaceId: string, timeZone: string, targetIds: readonly string[], now = new Date(), horizonDays?: number): Promise<Date | null> {
  const days = horizonDays ?? (await bounds()).queueLookaheadDays;
  const [rows, taken] = await Promise.all([
    tx.$queryRaw<SlotRow[]>`SELECT "targetId", "dayOfWeek", hour, minute FROM queue_slots WHERE "workspaceId" = ${workspaceId} AND ("targetId" IS NULL OR "targetId" = ANY(${[...targetIds]}::text[]))`,
    tx.$queryRaw<Array<{ scheduledAt: Date }>>`SELECT DISTINCT p."scheduledAt" FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text = ANY(${OCCUPYING}::text[]) AND p."scheduledAt" >= ${now} AND pt."targetId" = ANY(${[...targetIds]}::text[])`,
  ]);
  return nextAvailableSlot({ slots: slotsForPages(rows, targetIds), timeZone, takenUtc: taken.map(t => t.scheduledAt), now, horizonDays: days });
}

async function systemAudit(tx: Tx, workspaceId: string, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, NULL, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

// ---- recycling --------------------------------------------------------------
export type RecycleRunResult = { checked: number; created: number; finished: number; skipped: number; failed: number };
type DueRow = { id: string; workspaceId: string; message: string; firstComment: string | null; firstCommentDelayMinutes: number; format: string; link: string | null; linkPreview: unknown; media: unknown; mediaKeys: string[]; publishMode: string; timezone: string; authorId: string; recycleEveryDays: number | null; recycleLimit: number | null; recycleCount: number; recycleNextAt: Date | null; variants: unknown };

/**
 * Creates the next scheduled copy of every published post whose repeat is due. Each repeat is a new post (history stays intact),
 * claimed by compare-and-set on recycleNextAt before the copy exists, with the copy id derived from post and run number, so
 * neither a second worker nor a retry can create a duplicate. A post with no active destination stops repeating.
 * `eligible` lets the host apply its owner/plan/module rules per workspace; an ineligible workspace is left untouched.
 */
export async function runRecycleCycle(options: { now?: Date; eligible?: (workspaceId: string) => Promise<boolean> } = {}): Promise<RecycleRunResult> {
  if (typeof options.eligible !== 'function') throw new OperationError('unavailable', 'Automatic scheduling is unavailable until workspace access can be verified.');
  const now = options.now ?? new Date();
  const limit = await bounds();
  const result: RecycleRunResult = { checked: 0, created: 0, finished: 0, skipped: 0, failed: 0 };
  const due = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT id, "workspaceId" FROM posts WHERE "recycleEnabled" = TRUE AND "recycleNextAt" <= ${now} AND status::text IN ('published', 'partially_failed') ORDER BY "recycleNextAt" ASC, id ASC LIMIT ${limit.executorBatchSize}`;
  for (const item of due) {
    result.checked += 1;
    try {
      if (!(await options.eligible(item.workspaceId))) { result.skipped += 1; continue; }
      const outcome = await recycleOne(item.workspaceId, item.id, now, limit);
      result[outcome] += 1;
    } catch { result.failed += 1; }
  }
  return result;
}

async function recycleOne(workspaceId: string, postId: string, now: Date, limit: CollabBounds): Promise<'created' | 'finished' | 'skipped'> {
  return transact(workspaceId, limit, async tx => {
    const rows = await tx.$queryRaw<DueRow[]>`SELECT id, "workspaceId", message, "firstComment", "firstCommentDelayMinutes", format, link, "linkPreview", media, "mediaKeys", "publishMode"::text AS "publishMode", timezone, "authorId", "recycleEveryDays", "recycleLimit", "recycleCount", "recycleNextAt", variants FROM posts WHERE id = ${postId} AND "workspaceId" = ${workspaceId} AND "recycleEnabled" = TRUE AND "recycleNextAt" <= ${now} AND status::text IN ('published', 'partially_failed') FOR UPDATE SKIP LOCKED`;
    const post = rows[0];
    if (!post) return 'skipped'; // already taken, switched off or not due any more
    const live = await tx.$queryRaw<Array<{ targetId: string }>>`SELECT pt."targetId" FROM post_targets pt JOIN targets t ON t.id = pt."targetId" WHERE pt."postId" = ${postId} AND t."workspaceId" = ${workspaceId} AND t.enabled = TRUE ORDER BY pt."targetId" ASC`;
    if (!live.length) {
      await tx.$executeRaw`UPDATE posts SET "recycleEnabled" = FALSE, "recycleNextAt" = NULL, "updatedAt" = NOW() WHERE id = ${postId} AND "workspaceId" = ${workspaceId}`;
      await systemAudit(tx, workspaceId, 'publishing.recycle_stopped', { postId, reason: 'no_active_destinations' });
      return 'finished';
    }
    const count = post.recycleCount + 1;
    const next = nextRecycleAt({ everyDays: post.recycleEveryDays, limit: post.recycleLimit, count, from: post.recycleNextAt ?? now, now });
    const claimed = await tx.$executeRaw`UPDATE posts SET "recycleCount" = ${count}, "recycleNextAt" = ${next}, "recycleEnabled" = ${next !== null}, "updatedAt" = NOW() WHERE id = ${postId} AND "workspaceId" = ${workspaceId} AND "recycleNextAt" = ${post.recycleNextAt}`;
    if (claimed !== 1) return 'skipped';
    const variants = Array.isArray(post.variants) ? post.variants.filter((v): v is string => typeof v === 'string') : [];
    const copyId = `rc_${postId}_${count}`;
    const at = post.recycleNextAt && post.recycleNextAt > now ? post.recycleNextAt : now;
    const linkPreview = post.linkPreview === null || post.linkPreview === undefined ? null : JSON.stringify(post.linkPreview);
    const inserted = await tx.$executeRaw`INSERT INTO posts (id, "workspaceId", "authorId", message, "firstComment", "firstCommentDelayMinutes", format, link, "linkPreview", "mediaKeys", media, status, "publishMode", "scheduledAt", timezone, "approvalStatus", "originPostId", "createdAt", "updatedAt")
      VALUES (${copyId}, ${workspaceId}, ${post.authorId}, ${variantForRun(post.message, variants, count)}, ${post.firstComment}, ${post.firstCommentDelayMinutes}, ${post.format}, ${post.link}, ${linkPreview}::jsonb, ${post.mediaKeys}::text[], ${JSON.stringify(post.media ?? [])}::jsonb, 'scheduled'::"PostStatus", ${post.publishMode}::"PublishMode", ${at}, ${post.timezone}, 'not_required'::"ApprovalStatus", ${postId}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING`;
    if (inserted === 1) {
      for (const t of live) await tx.$executeRaw`INSERT INTO post_targets (id, "postId", "targetId") VALUES (${`rct_${randomUUID()}`}, ${copyId}, ${t.targetId})`;
    }
    await systemAudit(tx, workspaceId, 'publishing.recycled', { postId, copyId, run: count, created: inserted === 1, nextAt: next });
    return next === null ? 'finished' : 'created';
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
 * transaction; a failed notification never undoes scheduling (`notify` runs after commit).
 */
export async function runContentMix(options: { now?: Date; eligible?: (workspaceId: string) => Promise<boolean>; notify?: (notice: MixDryNotice) => Promise<void> } = {}): Promise<MixRunResult> {
  if (typeof options.eligible !== 'function') throw new OperationError('unavailable', 'Automatic scheduling is unavailable until workspace access can be verified.');
  const now = options.now ?? new Date();
  const limit = await bounds();
  const result: MixRunResult = { workspaces: 0, scheduled: 0, dry: 0, skipped: 0, failed: 0 };
  const list = await prisma.$queryRaw<Array<{ workspaceId: string }>>`SELECT DISTINCT "workspaceId" FROM content_mix_rules ORDER BY "workspaceId" ASC LIMIT ${limit.executorBatchSize}`;
  for (const { workspaceId } of list) {
    result.workspaces += 1;
    try {
      if (!(await options.eligible(workspaceId))) { result.skipped += 1; continue; }
      const out = await mixOne(workspaceId, now, limit);
      result.scheduled += out.scheduled; result.dry += out.notices.length;
      for (const notice of out.notices) { try { await options.notify?.(notice); } catch { /* the claim is recorded; delivery failures are the notifier's to report */ } }
    } catch { result.failed += 1; }
  }
  return result;
}

async function mixOne(workspaceId: string, now: Date, limit: CollabBounds): Promise<{ scheduled: number; notices: MixDryNotice[] }> {
  return transact(workspaceId, limit, async tx => {
    const ws = await tx.$queryRaw<Array<{ timezone: string; mixAutoFill: boolean; requiresApproval: boolean }>>`SELECT timezone, "mixAutoFill", "requiresApproval" FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
    if (!ws[0]) return { scheduled: 0, notices: [] };
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
    if (!mixes.size) return { scheduled: 0, notices: [] };
    const mixIds = [...mixes.keys()];
    const planned = await tx.$queryRaw<Array<{ id: string; targets: string[]; labels: string[] }>>`SELECT p.id, ARRAY_AGG(DISTINCT pt."targetId") AS targets, COALESCE(ARRAY_AGG(DISTINCT pl."labelId") FILTER (WHERE pl."labelId" IS NOT NULL), '{}') AS labels FROM posts p JOIN post_targets pt ON pt."postId" = p.id LEFT JOIN post_labels pl ON pl."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text IN ('scheduled', 'pending_approval', 'publishing', 'published') AND p."scheduledAt" >= ${now} AND p."scheduledAt" < ${until} GROUP BY p.id HAVING ARRAY_AGG(DISTINCT pt."targetId") && ${mixIds}::text[]`;
    const drafts = await tx.$queryRaw<Array<{ id: string; authorId: string; approvalStatus: string; targets: string[]; allActive: boolean; labels: string[] }>>`SELECT p.id, p."authorId", p."approvalStatus"::text AS "approvalStatus", ARRAY_AGG(DISTINCT pt."targetId") AS targets, BOOL_AND(t.enabled) AS "allActive", COALESCE(ARRAY_AGG(DISTINCT pl."labelId") FILTER (WHERE pl."labelId" IS NOT NULL), '{}') AS labels FROM posts p JOIN post_targets pt ON pt."postId" = p.id JOIN targets t ON t.id = pt."targetId" LEFT JOIN post_labels pl ON pl."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text = 'draft' GROUP BY p.id HAVING ARRAY_AGG(DISTINCT pt."targetId") && ${mixIds}::text[] AND COUNT(pl."labelId") > 0 ORDER BY MIN(p."createdAt") ASC, p.id ASC`;
    const roles = new Map((await tx.$queryRaw<Array<{ userId: string; role: string }>>`SELECT "userId", role::text AS role FROM memberships WHERE "workspaceId" = ${workspaceId}`).map(m => [m.userId, m.role]));
    const ready = (d: (typeof drafts)[number]) => d.allActive && (d.approvalStatus === 'approved' || (d.approvalStatus === 'not_required' && (!requiresApproval || MANAGERS.has(roles.get(d.authorId) ?? ''))));
    const used = new Set<string>();
    const taken = (await tx.$queryRaw<Array<{ scheduledAt: Date; targets: string[] }>>`SELECT p."scheduledAt", ARRAY_AGG(DISTINCT pt."targetId") AS targets FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p."workspaceId" = ${workspaceId} AND p.status::text = ANY(${OCCUPYING}::text[]) AND p."scheduledAt" >= ${now} GROUP BY p.id`);
    const slotRows = await tx.$queryRaw<SlotRow[]>`SELECT "targetId", "dayOfWeek", hour, minute FROM queue_slots WHERE "workspaceId" = ${workspaceId}`;
    let scheduled = 0;
    const dryRules: Array<{ targetId: string; labelId: string; rules: Rule[] }> = [];
    const recovered: string[] = [];
    for (const [targetId, mix] of mixes) for (const [labelId, entry] of mix) {
      let short = entry.perWeek - planned.filter(p => p.targets.includes(targetId) && p.labels.includes(labelId)).length;
      const candidates = drafts.filter(d => !used.has(d.id) && d.targets.includes(targetId) && d.labels.includes(labelId) && ready(d));
      while (mixAutoFill && short > 0 && candidates.length) {
        const draft = candidates.shift()!;
        const slots = slotsForPages(slotRows, draft.targets);
        const takenFor = taken.filter(t => t.targets.some(x => draft.targets.includes(x))).map(t => t.scheduledAt);
        const at = nextAvailableSlot({ slots, timeZone: timezone, takenUtc: takenFor, now, horizonDays: limit.mixWindowDays });
        if (!at) break;
        const done = await tx.$executeRaw`UPDATE posts SET status = 'scheduled'::"PostStatus", "scheduledAt" = ${at}, timezone = ${timezone}, "publishMode" = 'worker'::"PublishMode", "updatedAt" = NOW() WHERE id = ${draft.id} AND "workspaceId" = ${workspaceId} AND status::text = 'draft'`;
        if (done !== 1) continue;
        used.add(draft.id); scheduled += 1; short -= 1;
        taken.push({ scheduledAt: at, targets: draft.targets });
        planned.push({ id: draft.id, targets: draft.targets, labels: draft.labels });
        await systemAudit(tx, workspaceId, 'publishing.mix_scheduled', { postId: draft.id, labelId, targetId, at });
      }
      if (short > 0 && candidates.length === 0) dryRules.push({ targetId, labelId, rules: entry.rules });
      else recovered.push(...entry.rules.filter(r => r.dryNotifiedAt).map(r => r.id));
    }
    if (recovered.length) await tx.$executeRaw`UPDATE content_mix_rules SET "dryNotifiedAt" = NULL WHERE "workspaceId" = ${workspaceId} AND id = ANY(${recovered}::text[])`;
    const notices: MixDryNotice[] = [];
    for (const d of dryRules) {
      const fresh = d.rules.filter(r => !r.dryNotifiedAt).map(r => r.id);
      if (!fresh.length) continue;
      const won = await tx.$executeRaw`UPDATE content_mix_rules SET "dryNotifiedAt" = ${now} WHERE "workspaceId" = ${workspaceId} AND id = ANY(${fresh}::text[]) AND "dryNotifiedAt" IS NULL`;
      if (won === 0) continue;
      notices.push({ workspaceId, targetId: d.targetId, labelId: d.labelId });
      await systemAudit(tx, workspaceId, 'publishing.mix_ran_dry', { targetId: d.targetId, labelId: d.labelId });
    }
    return { scheduled, notices };
  });
}
