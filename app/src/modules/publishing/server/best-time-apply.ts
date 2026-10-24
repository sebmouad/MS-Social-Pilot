import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { isValidTimeZone } from '@/lib/calendar-dates';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { canUseFeature, canUseModule, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { platformAnalytics } from '@/server/platforms/registry';
import { suggestBestTimes } from './best-time-ranking';
import type { PublishingActor } from './types';

export const APPLY_BEST_TIMES_CONFIRMATION = 'APPLY BEST TIMES';
const WEEK_MS = 7 * 86_400_000;

type ApplyPolicy = { lookbackDays: number; maxPosts: number; minHistory: number; minPostsPerSlot: number; minLift: number; addPerWeek: number; maxOwnSlots: number; batchWorkspaces: number };
const KEYS = ['publishing.bestTimeLookbackDays', 'publishing.bestTimeMaxPosts', 'publishing.bestTimeMinHistory', 'publishing.bestTimeMinPostsPerSlot', 'publishing.bestTimeMinLift', 'publishing.bestTimeAddPerWeek', 'publishing.bestTimeMaxOwnSlots', 'publishing.bestTimeApplyBatchWorkspaces'] as const;

async function policy(): Promise<ApplyPolicy> {
  const values = await runtimeConfigBatch(KEYS);
  const num = (key: string, min: number, max: number) => {
    const checked = z.number().int().min(min).max(max).safeParse(values[key]);
    if (!checked.success) throw new OperationError('unavailable', 'Best times are temporarily unavailable. Try again later.');
    return checked.data;
  };
  const lift = z.number().min(1.01).max(10).safeParse(values['publishing.bestTimeMinLift']);
  if (!lift.success) throw new OperationError('unavailable', 'Best times are temporarily unavailable. Try again later.');
  return { lookbackDays: num('publishing.bestTimeLookbackDays', 1, 365), maxPosts: num('publishing.bestTimeMaxPosts', 10, 10000), minHistory: num('publishing.bestTimeMinHistory', 3, 1000), minPostsPerSlot: num('publishing.bestTimeMinPostsPerSlot', 2, 100), minLift: lift.data, addPerWeek: num('publishing.bestTimeAddPerWeek', 1, 7), maxOwnSlots: num('publishing.bestTimeMaxOwnSlots', 1, 100), batchWorkspaces: num('publishing.bestTimeApplyBatchWorkspaces', 1, 1000) };
}

/** Owners and admins with current workspace-operations access; the mode switch they own is what the worker follows. */
async function authorize(actor: PublishingActor, mode: 'read' | 'write') {
  const rows = await prisma.$queryRaw<Array<{ role: string }>>`SELECT m.role::text AS role FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL AND w."suspendedAt" IS NULL`;
  if (!rows[0] || !['owner', 'admin'].includes(rows[0].role)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage best-time application.');
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId || !canUseModule(entitlements, 'settings') || !canUseFeature(entitlements, 'settings/workspace') || !canAccessFeature(permissions, 'settings/workspace', mode)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage best-time application.');
  await assertWorkspaceNotPurging(actor.workspaceId);
}

type ApplyTarget = { id: string; name: string; provider: string | null };

/**
 * Add one workspace's strongest new times to its channel queues. Same rules as the queue screen's suggestions:
 * a time needs posts behind it and a lift over the channel's typical post, and times the queue already covers
 * are left out. Each addition is audited with its evidence.
 */
export async function applyWorkspaceBestTimes(workspaceId: string, p: ApplyPolicy, now = new Date()): Promise<{ channels: number; added: number }> {
  const spaces = await prisma.$queryRaw<Array<{ timezone: string; bestTimeMode: string }>>`SELECT timezone, "bestTimeMode" FROM workspaces WHERE id = ${workspaceId}`;
  const space = spaces[0];
  if (!space || !isValidTimeZone(space.timezone) || space.bestTimeMode !== 'apply') return { channels: 0, added: 0 };
  const [targets, slots] = await Promise.all([
    prisma.$queryRaw<ApplyTarget[]>`SELECT t.id, t.name, a.provider::text AS provider FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" WHERE t."workspaceId" = ${workspaceId} AND t.enabled = true AND a."invalidatedAt" IS NULL ORDER BY t.id LIMIT 500`,
    prisma.$queryRaw<Array<{ targetId: string | null; dayOfWeek: number; hour: number; minute: number }>>`SELECT "targetId", "dayOfWeek", hour, minute FROM queue_slots WHERE "workspaceId" = ${workspaceId}`,
  ]);
  const from = new Date(now.getTime() - p.lookbackDays * 86_400_000);
  let channels = 0, added = 0;
  for (const target of targets) {
    const existing = slots.filter(slot => slot.targetId === null || slot.targetId === target.id);
    const own = existing.filter(slot => slot.targetId === target.id).length;
    const room = Math.min(p.addPerWeek, p.maxOwnSlots - own);
    if (room <= 0) continue;
    const host = target.provider ? await platformAnalytics(target.provider).catch(() => null) : null;
    if (!host?.postPerformance) continue;
    let posts;
    try { posts = await host.postPerformance({ workspaceId, targetId: target.id, from, to: now, limit: p.maxPosts, sort: 'publishedAt', direction: 'desc' }); }
    catch { continue; }
    const history = posts.filter(post => post.publishedAt && post.publishedAt >= from && post.publishedAt < now && post.measuredAt && post.measuredAt <= now);
    // Times the queue already covers stay out, like the composer suggestions.
    const covered = new Set(existing.map(slot => `${slot.dayOfWeek}:${slot.hour}`));
    const suggestions = suggestBestTimes([history], space.timezone, { minHistory: p.minHistory, minPostsPerSlot: p.minPostsPerSlot, minLift: p.minLift, maxSuggestions: room + covered.size }).filter(slot => !covered.has(`${slot.dayOfWeek}:${slot.hour}`)).slice(0, room);
    if (!suggestions.length) continue;
    for (const slot of suggestions) {
      const inserted = await prisma.$executeRaw`INSERT INTO queue_slots (id, "workspaceId", "targetId", "dayOfWeek", hour, minute) VALUES (${randomUUID()}, ${workspaceId}, ${target.id}, ${slot.dayOfWeek}, ${slot.hour}, 0) ON CONFLICT ("workspaceId", "targetId", "dayOfWeek", hour, minute) DO NOTHING`;
      if (inserted === 1) {
        added += 1;
        await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, NULL, 'queue.bestTimesAdded', ${JSON.stringify({ targetId: target.id, dayOfWeek: slot.dayOfWeek, hour: slot.hour, lift: slot.lift, posts: slot.posts })}::jsonb, NOW())`;
      }
    }
    channels += 1;
  }
  return { channels, added };
}

/**
 * Weekly application for workspaces that chose "apply". Each workspace is claimed first, so two workers do not
 * both add the same week's times, and a restart does not add times early.
 */
export async function runBestTimeApplication(now = new Date()): Promise<string> {
  const p = await policy();
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const spaces = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE "bestTimeMode" = 'apply' AND "suspendedAt" IS NULL AND ("bestTimesRunAt" IS NULL OR "bestTimesRunAt" <= ${weekAgo}) ORDER BY id LIMIT ${p.batchWorkspaces}`;
  let channels = 0, added = 0, failed = 0;
  for (const space of spaces) {
    const claimed = await prisma.$executeRaw`UPDATE workspaces SET "bestTimesRunAt" = ${now} WHERE id = ${space.id} AND "bestTimeMode" = 'apply' AND ("bestTimesRunAt" IS NULL OR "bestTimesRunAt" <= ${weekAgo})`;
    if (claimed !== 1) continue;
    try {
      const result = await applyWorkspaceBestTimes(space.id, p, now);
      channels += result.channels; added += result.added;
    } catch { failed += 1; }
  }
  return `workspaces=${spaces.length} channels=${channels} added=${added} failed=${failed}`;
}

export type BestTimeApplyStatus = { mode: 'suggest' | 'apply'; lastRunAt: string | null; nextEligibleAt: string | null };

export async function getBestTimeApplyStatus(actor: PublishingActor, now = new Date()): Promise<BestTimeApplyStatus> {
  await authorize(actor, 'read');
  const rows = await prisma.$queryRaw<Array<{ bestTimeMode: string; bestTimesRunAt: Date | null }>>`SELECT "bestTimeMode", "bestTimesRunAt" FROM workspaces WHERE id = ${actor.workspaceId}`;
  const mode = rows[0]?.bestTimeMode === 'apply' ? 'apply' : 'suggest';
  const lastRunAt = rows[0]?.bestTimesRunAt ?? null;
  return { mode, lastRunAt: lastRunAt?.toISOString() ?? null, nextEligibleAt: mode === 'apply' && lastRunAt ? new Date(lastRunAt.getTime() + WEEK_MS).toISOString() : mode === 'apply' ? now.toISOString() : null };
}

const runSchema = z.object({ confirmation: z.string() }).strict();

/** Apply this workspace's best times now. Requires automatic mode; claims the week so the worker does not repeat it. */
export async function runBestTimeApplyNow(actor: PublishingActor, input: unknown, now = new Date()): Promise<{ channels: number; added: number }> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== APPLY_BEST_TIMES_CONFIRMATION) throw new OperationError('invalid_request', 'Type the exact confirmation shown to continue.');
  await authorize(actor, 'write');
  const p = await policy();
  const claimed = await prisma.$executeRaw`UPDATE workspaces SET "bestTimesRunAt" = ${now} WHERE id = ${actor.workspaceId} AND "bestTimeMode" = 'apply'`;
  if (claimed !== 1) throw new OperationError('conflict', 'Automatic best times are switched off for this workspace.');
  try { return await applyWorkspaceBestTimes(actor.workspaceId, p, now); }
  catch { throw new OperationError('unavailable', 'Best times could not be applied. Try again later.'); }
}
