import { errorCopyDefaults, type AnalyticsErrorCopy } from '../../error-copy';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { audit, type Tx } from '../server/access';
import type { ReportRecipientOutcome, ReportRunOutcome, ReportRunStatus, ReportStoredOutput } from '../contracts';

/*
 * Durable run rows live in `report_runs` (columns in docs/ANALYTICS_PARITY.md plus `"claimToken" text NOT NULL`, the fence
 * below). Every write after the claim is a compare-and-swap on (id, workspace, claimToken, still open, lease not expired),
 * so a worker whose lease lapsed, a stale sweeper race or a terminal row can never be overwritten. A state change and its audit
 * row commit in one transaction; if the audit cannot be written, the change is rolled back.
 */
export const OPEN_STATUSES = ['claimed', 'generating', 'delivering'] as const;
export class ClaimLost extends Error { constructor() { super('The report run is no longer owned by this worker.'); this.name = 'ClaimLost'; } }

export const FAILURE_TEXT: Record<string, string> = {
  channel_unavailable: errorCopyDefaults["The channel is disabled, disconnected or no longer available."].en, access_unavailable: errorCopyDefaults["The report owner no longer has access to this report."].en,
  workspace_unavailable: errorCopyDefaults["The workspace is suspended or being erased."].en, no_report_owner: errorCopyDefaults["The person who set up this schedule is no longer available."].en,
  schedule_removed: errorCopyDefaults["The schedule was removed before delivery."].en, no_supported_sections: errorCopyDefaults["This report lists only sections that are not available yet. Edit its template."].en,
  generation_failed: errorCopyDefaults["The report could not be prepared."].en, delivery_failed: errorCopyDefaults["No recipient received the report."].en,
  delivery_uncertain: errorCopyDefaults["Delivery to at least one recipient could not be confirmed. Check with the recipients before sending again."].en,
  lease_expired: errorCopyDefaults["The run was interrupted before it finished."].en, lease_expired_during_delivery: errorCopyDefaults["The run was interrupted during delivery. Delivery was not retried; check with the recipients."].en,
  result_too_large: errorCopyDefaults["The report has more rows than this access allows."].en,
  stored_output_too_large: errorCopyDefaults["The report is too large to keep for download. Choose fewer sections or a shorter period."].en,
  delivery_not_started: errorCopyDefaults["Email delivery stopped before the next recipient could be contacted. Review this run before preparing another report."].en,
  workspace_time_zone_unavailable: errorCopyDefaults["The workspace time zone is unavailable. Review workspace settings."].en,
  result_not_recorded: errorCopyDefaults["The result could not be recorded. Delivery was not retried; check with the recipients."].en,
};
export const reportFailureText = (reason: string | null, copy: AnalyticsErrorCopy = errorCopyDefaults, locale: 'en' | 'fr' = 'en') => {
  if (!reason) return null;
  const source = FAILURE_TEXT[reason] ?? errorCopyDefaults['The run did not finish.'].en;
  const key = (Object.keys(errorCopyDefaults) as Array<keyof AnalyticsErrorCopy>).find(key => errorCopyDefaults[key].en === source)!;
  return copy[key][locale];
};
export const safeReason = (reason: string) => (reason in FAILURE_TEXT ? reason : 'generation_failed');
export const mask = (address: string) => { const [local = '', domain = ''] = address.split('@'); return `${[...local][0] ?? ''}***@${domain}`; };

export type RunRef = { id: string; workspaceId: string; token: string };
export type RunPatch = { status: ReportRunStatus; reason?: string | null; rowCount?: number; truncated?: boolean; deliveries?: ReportRecipientOutcome[]; finished?: boolean; leaseSeconds?: number; output?: ReportStoredOutput; outputExpiresAt?: Date };
export type RunSideEffects = {
  audit?: { actor: { userId: string | null; workspaceId: string; apiKeyId?: string }; action: string; detail: Record<string, unknown> };
  /** Runs in the same transaction after the fenced update (e.g. the schedule's last outcome). */
  after?: (tx: Tx) => Promise<void>;
};

export async function fencedUpdate(run: RunRef, patch: RunPatch, now: Date, effects: RunSideEffects = {}): Promise<void> {
  const lease = patch.leaseSeconds === undefined ? null : new Date(now.getTime() + patch.leaseSeconds * 1000);
  const deliveries = patch.deliveries ? JSON.stringify(patch.deliveries) : null;
  const output = patch.output ? JSON.stringify(patch.output) : null;
  await prisma.$transaction(async tx => {
    const changed = await tx.$executeRaw`UPDATE report_runs SET status = ${patch.status}, "failureReason" = ${patch.reason ?? null}, "rowCount" = COALESCE(${patch.rowCount ?? null}::int, "rowCount"), truncated = COALESCE(${patch.truncated ?? null}::boolean, truncated), deliveries = COALESCE(${deliveries}::jsonb, deliveries), "leaseUntil" = COALESCE(${lease}::timestamptz, "leaseUntil"), output = COALESCE(${output}::jsonb, output), "outputExpiresAt" = COALESCE(${patch.outputExpiresAt ?? null}::timestamptz, "outputExpiresAt"), "finishedAt" = CASE WHEN ${patch.finished === true}::boolean THEN ${now}::timestamptz ELSE NULL END WHERE id = ${run.id} AND "workspaceId" = ${run.workspaceId} AND "claimToken" = ${run.token} AND status IN ('claimed','generating','delivering') AND "leaseUntil" > ${now}::timestamptz`;
    if (changed !== 1) throw new ClaimLost();
    if (effects.audit) await audit(tx, effects.audit.actor, effects.audit.action, effects.audit.detail);
    if (effects.after) await effects.after(tx);
  });
}

/** Terminal write with bounded retries for transient failures. A lost claim is never retried. Returns false when it could not be recorded. */
export async function finishRun(run: RunRef, patch: RunPatch, now: () => Date, retries: number, effects: RunSideEffects = {}): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { await fencedUpdate(run, { ...patch, finished: true }, now(), effects); return true; }
    catch (error) { if (error instanceof ClaimLost) return false; }
  }
  return false;
}

export function scheduleOutcome(tx: Tx, scheduleId: string, workspaceId: string, at: Date, error: string | null) {
  return tx.$executeRaw`UPDATE report_schedules SET "lastRunAt" = ${at}, "lastError" = ${error} WHERE id = ${scheduleId} AND "workspaceId" = ${workspaceId}`;
}

/** Final state implied by recipient outcomes. Nothing in flight or unknown is ever reported as failed or sent. */
export function deriveStatus(deliveries: readonly ReportRecipientOutcome[]): { status: ReportRunStatus; reason: string | null } {
  const count = (s: ReportRecipientOutcome['status']) => deliveries.filter(d => d.status === s).length;
  const sent = count('sent');
  if (count('attempting') || count('uncertain')) return { status: 'uncertain', reason: 'delivery_uncertain' };
  if (deliveries.length && sent === deliveries.length) return { status: 'completed', reason: null };
  const skipped = count('skipped') + count('pending');
  if (sent > 0) return { status: 'partial', reason: skipped ? 'access_unavailable' : 'delivery_failed' };
  if (deliveries.length && skipped === deliveries.length) return { status: 'skipped', reason: 'access_unavailable' };
  return { status: 'failed', reason: 'delivery_failed' };
}

export function runOutcome(kind: 'scheduled' | 'manual', status: string): ReportRunOutcome {
  if (status === 'claimed' || status === 'generating' || status === 'delivering') return 'in_progress';
  if (kind === 'manual') return status === 'completed' ? 'prepared' : status === 'skipped' ? 'skipped' : 'failed';
  if (status === 'completed') return 'sent';
  if (status === 'partial') return 'partially_sent';
  if (status === 'uncertain') return 'uncertain';
  if (status === 'skipped') return 'skipped';
  return 'not_sent';
}

export const newToken = () => randomUUID();
/** Stable digest of a normalised request, so one request id can only ever mean one report. */
export const requestHash = (payload: Record<string, string | null>) => createHash('sha256').update(JSON.stringify(Object.keys(payload).sort().map(k => [k, payload[k]]))).digest('hex');

/**
 * Drops prepared artifacts past their retention, a bounded batch per job run. The run row (history, status, counts) stays;
 * only the downloadable content goes, and it is never regenerated. One audit row per workspace records how many were cleared.
 */
export async function clearExpiredOutputs(limit: number, now: Date): Promise<number> {
  return prisma.$transaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT r.id, r."workspaceId" FROM report_runs r WHERE NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = r."workspaceId" AND p.status::text <> 'completed') AND r.output IS NOT NULL AND (r."outputExpiresAt" IS NULL OR r."outputExpiresAt" < ${now}) ORDER BY r."outputExpiresAt" ASC NULLS FIRST, r.id ASC LIMIT ${limit}`;
    if (!candidates.length) return 0;
    const workspaceIds = [...new Set(candidates.map(row => row.workspaceId))].sort();
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE id = ANY(${workspaceIds}::text[]) ORDER BY id FOR SHARE`;
    const lockedIds = new Set(locked.map(row => row.id));
    if (!lockedIds.size) return 0;
    const purging = await tx.$queryRaw<Array<{ workspaceId: string }>>`SELECT "workspaceId" FROM workspace_data_purges WHERE "workspaceId" = ANY(${[...lockedIds]}::text[]) AND status::text <> 'completed'`;
    const purgingIds = new Set(purging.map(row => row.workspaceId));
    const byWorkspace = new Map<string, string[]>();
    for (const row of candidates) {
      if (!lockedIds.has(row.workspaceId) || purgingIds.has(row.workspaceId)) continue;
      byWorkspace.set(row.workspaceId, [...(byWorkspace.get(row.workspaceId) ?? []), row.id]);
    }
    const cleared: Array<{ id: string; workspaceId: string }> = [];
    for (const [workspaceId, ids] of byWorkspace) {
      const rows = await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>`UPDATE report_runs SET output = NULL, "outputExpiresAt" = NULL WHERE "workspaceId" = ${workspaceId} AND id = ANY(${ids}::text[]) AND output IS NOT NULL AND ("outputExpiresAt" IS NULL OR "outputExpiresAt" < ${now}) RETURNING id, "workspaceId"`;
      cleared.push(...rows);
    }
    const perWorkspace = new Map<string, number>();
    for (const row of cleared) perWorkspace.set(row.workspaceId, (perWorkspace.get(row.workspaceId) ?? 0) + 1);
    for (const [workspaceId, runs] of perWorkspace) await audit(tx, { userId: null, workspaceId }, 'analytics.report_output_expired', { runs });
    return cleared.length;
  });
}
