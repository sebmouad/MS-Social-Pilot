import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { configValueOrDefault } from '@/server/config/config-or-default';
import { runtimeConfigBatch } from '@/server/config/store';
import { canUseFeature, canUseModule, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { RETENTION_COPY, retentionCopySchema, type RetentionCopy } from '../retention-copy';
import type { ScopedPermissions } from '@/server/permissions';

export type RetentionActor = { userId: string; workspaceId: string; permissionCeiling?: ScopedPermissions };
export const RUN_RETENTION_CONFIRMATION = 'PRUNE OLD RECORDS';

const KEYS = ['retention.auditDays', 'retention.syncLogDays', 'retention.emailDays', 'retention.clickDays', 'retention.aiDays', 'retention.errorDays', 'retention.analyticsDays', 'retention.schedule', 'retention.batchWorkspaces', 'settings.retentionCopy'] as const;
const days = z.number().int().min(7).max(3650);

export type RetentionPolicy = { auditDays: number; syncLogDays: number; emailDays: number; clickDays: number; aiDays: number; errorDays: number; analyticsDays: number; batchWorkspaces: number };
export type RetentionCounts = { activity: number; emails: number; clicks: number; ai: number; errors: number; syncRuns: number; reports: number };

const ZERO: RetentionCounts = { activity: 0, emails: 0, clicks: 0, ai: 0, errors: 0, syncRuns: 0, reports: 0 };
const add = (a: RetentionCounts, b: RetentionCounts): RetentionCounts => ({ activity: a.activity + b.activity, emails: a.emails + b.emails, clicks: a.clicks + b.clicks, ai: a.ai + b.ai, errors: a.errors + b.errors, syncRuns: a.syncRuns + b.syncRuns, reports: a.reports + b.reports });
export const retentionTotal = (counts: RetentionCounts) => counts.activity + counts.emails + counts.clicks + counts.ai + counts.errors + counts.syncRuns + counts.reports;

async function copy(locale: 'en' | 'fr'): Promise<RetentionCopy> {
  try {
    const raw = await configValueOrDefault('settings.retentionCopy');
    const checked = retentionCopySchema.safeParse(raw);
    return (checked.success ? checked.data : RETENTION_COPY)[locale];
  } catch { return RETENTION_COPY[locale]; }
}

async function policy(): Promise<RetentionPolicy> {
  const values = await runtimeConfigBatch(KEYS);
  const get = (key: string) => {
    const checked = days.safeParse(values[key]);
    if (!checked.success) throw new OperationError('unavailable', 'The cleanup is temporarily unavailable. Try again later.');
    return checked.data;
  };
  const batch = z.number().int().min(1).max(10000).safeParse(values['retention.batchWorkspaces']);
  if (!batch.success) throw new OperationError('unavailable', 'The cleanup is temporarily unavailable. Try again later.');
  return { auditDays: get('retention.auditDays'), syncLogDays: get('retention.syncLogDays'), emailDays: get('retention.emailDays'), clickDays: get('retention.clickDays'), aiDays: get('retention.aiDays'), errorDays: get('retention.errorDays'), analyticsDays: get('retention.analyticsDays'), batchWorkspaces: batch.data };
}

const cutoff = (now: Date, dayCount: number) => new Date(now.getTime() - dayCount * 86_400_000);

/** Owners and admins only, with current Settings/Data access; the workspace comes from membership, never from input. */
async function authorize(actor: RetentionActor, mode: 'read' | 'write'): Promise<RetentionCopy> {
  const text = await copy('en');
  const rows = await prisma.$queryRaw<Array<{ role: string }>>`SELECT m.role::text AS role FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL AND w."suspendedAt" IS NULL`;
  if (!rows[0] || !['owner', 'admin'].includes(rows[0].role)) throw new OperationError('forbidden', text.forbidden);
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId || !canUseModule(entitlements, 'settings') || !canUseFeature(entitlements, 'settings/data') || !canAccessFeature(permissions, 'settings/data', mode) || (actor.permissionCeiling && !canAccessFeature(actor.permissionCeiling, 'settings/data', mode))) throw new OperationError('forbidden', text.forbidden);
  await assertWorkspaceNotPurging(actor.workspaceId);
  return text;
}

/**
 * Prune one workspace's append-only history. Deliberately untouched: feed items (the RSS de-duplication ledger;
 * pruning would re-post archives), insight snapshots (the analytics product), link totals (kept on the link row),
 * running report runs (idempotency), and workspace identity/members/content.
 */
export async function pruneWorkspaceHistory(workspaceId: string, p: RetentionPolicy, now = new Date()): Promise<RetentionCounts> {
  const counts: RetentionCounts = { ...ZERO };
  counts.activity = await prisma.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND "createdAt" < ${cutoff(now, p.auditDays)}`;
  counts.emails = await prisma.$executeRaw`DELETE FROM email_logs WHERE "workspaceId" = ${workspaceId} AND "createdAt" < ${cutoff(now, p.emailDays)}`;
  counts.clicks = await prisma.$executeRaw`DELETE FROM link_clicks WHERE "shortLinkId" IN (SELECT id FROM short_links WHERE "workspaceId" = ${workspaceId}) AND "createdAt" < ${cutoff(now, p.clickDays)}`;
  counts.ai = await prisma.$executeRaw`DELETE FROM ai_generations WHERE "workspaceId" = ${workspaceId} AND "createdAt" < ${cutoff(now, p.aiDays)}`;
  counts.reports = await prisma.$executeRaw`DELETE FROM report_runs WHERE "workspaceId" = ${workspaceId} AND "finishedAt" IS NOT NULL AND "startedAt" < ${cutoff(now, p.analyticsDays)}`;
  return counts;
}

/** Installation-wide history with no workspace: quiet errors, old worker run rows and installation emails. The one-row-per-job status is never removed. */
export async function pruneInstallationHistory(p: RetentionPolicy, now = new Date()): Promise<RetentionCounts> {
  const counts: RetentionCounts = { ...ZERO };
  counts.errors = await prisma.$executeRaw`DELETE FROM error_events WHERE "lastSeenAt" < ${cutoff(now, p.errorDays)}`;
  counts.syncRuns = await prisma.$executeRaw`DELETE FROM rebuild_sync_runs WHERE "startedAt" < ${cutoff(now, p.syncLogDays)}`;
  counts.emails = await prisma.$executeRaw`DELETE FROM email_logs WHERE "workspaceId" IS NULL AND "createdAt" < ${cutoff(now, p.emailDays)}`;
  return counts;
}

export function retentionSummary(counts: RetentionCounts, workspaces: number): string {
  return `workspaces=${workspaces} activity=${counts.activity} emails=${counts.emails} clicks=${counts.clicks} ai=${counts.ai} errors=${counts.errors} syncRuns=${counts.syncRuns} reports=${counts.reports}`;
}

/**
 * Nightly sweep for the shared job runner: bounded workspaces per run, then installation history, then one
 * installation audit receipt with the counts. A workspace failure is recorded and the sweep continues.
 */
export async function runRetentionSweep(now = new Date()): Promise<string> {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid retention time.');
  const p = await policy();
  const spaces = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces ORDER BY id LIMIT ${p.batchWorkspaces}`;
  let total: RetentionCounts = { ...ZERO };
  const failures: string[] = [];
  for (const space of spaces) {
    try { total = add(total, await pruneWorkspaceHistory(space.id, p, now)); }
    catch { failures.push(space.id); }
  }
  total = add(total, await pruneInstallationHistory(p, now));
  const summary = retentionSummary(total, spaces.length);
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, NULL, 'root.retention.pruned', ${JSON.stringify({ summary, total: retentionTotal(total), workspaces: spaces.length, failures: failures.slice(0, 20), failureCount: failures.length })}::jsonb, NOW())`;
  return failures.length ? `${summary} failed=${failures.length}` : summary;
}

export type RetentionStatus = { policy: RetentionPolicy; pending: RetentionCounts; lastRun: { startedAt: string; summary: string | null; outcome: string } | null };

/** Workspace-scoped status: the policy, rows of this workspace already past it, and the last nightly run. */
export async function getRetentionStatus(actor: RetentionActor, now = new Date(), locale: 'en' | 'fr' = 'en'): Promise<RetentionStatus> {
  const text = await authorize(actor, 'read');
  void text;
  const p = await policy();
  const [activity, emails, clicks, ai, reports, last] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND "createdAt" < ${cutoff(now, p.auditDays)}`.then(rows => Number(rows[0]?.count ?? 0)),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM email_logs WHERE "workspaceId" = ${actor.workspaceId} AND "createdAt" < ${cutoff(now, p.emailDays)}`.then(rows => Number(rows[0]?.count ?? 0)),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM link_clicks WHERE "shortLinkId" IN (SELECT id FROM short_links WHERE "workspaceId" = ${actor.workspaceId}) AND "createdAt" < ${cutoff(now, p.clickDays)}`.then(rows => Number(rows[0]?.count ?? 0)),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM ai_generations WHERE "workspaceId" = ${actor.workspaceId} AND "createdAt" < ${cutoff(now, p.aiDays)}`.then(rows => Number(rows[0]?.count ?? 0)),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM report_runs WHERE "workspaceId" = ${actor.workspaceId} AND "finishedAt" IS NOT NULL AND "startedAt" < ${cutoff(now, p.analyticsDays)}`.then(rows => Number(rows[0]?.count ?? 0)),
    prisma.$queryRaw<Array<{ startedAt: Date; summary: string | null; outcome: string }>>`SELECT "startedAt", summary, outcome FROM rebuild_sync_runs WHERE job = 'retention' ORDER BY "startedAt" DESC LIMIT 1`.then(rows => rows[0] ?? null),
  ]);
  return { policy: p, pending: { activity, emails, clicks, ai, errors: 0, syncRuns: 0, reports }, lastRun: last ? { startedAt: last.startedAt.toISOString(), summary: last.summary, outcome: last.outcome } : null };
}

const runSchema = z.object({ confirmation: z.string() }).strict();

/** Remove this workspace's old records now. Installation history stays for the nightly run; the counts are audited. */
export async function runRetentionNow(actor: RetentionActor, input: unknown, now = new Date(), locale: 'en' | 'fr' = 'en'): Promise<{ pruned: RetentionCounts; total: number }> {
  const text = await copy(locale);
  const parsed = runSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== RUN_RETENTION_CONFIRMATION) throw new OperationError('invalid_request', text.invalid);
  await authorize(actor, 'write');
  const p = await policy();
  let pruned: RetentionCounts;
  try { pruned = await pruneWorkspaceHistory(actor.workspaceId, p, now); }
  catch { throw new OperationError('unavailable', text.unavailable); }
  const total = retentionTotal(pruned);
  await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'settings.retention.pruned', ${JSON.stringify({ ...pruned, total })}::jsonb, NOW())`;
  return { pruned, total };
}
