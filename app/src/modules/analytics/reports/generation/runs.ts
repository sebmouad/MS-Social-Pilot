import { defaultAnalyticsError } from '@/modules/analytics/error-copy';
import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { REPORT_FREQUENCIES, listSchema, reportChannelRunConfirmation, reportRunConfirmation, reportRunSchema, type ReportActor, type ReportEligibility, type ReportFrequency, type ReportGenerationPort, type ReportMailPort, type ReportOutput, type ReportPeriod, type ReportRecipientOutcome, type ReportRunStatus, type ReportRunView, type ReportSectionId, type ReportStoredOutput } from '../contracts';
import { nextReportRun, reportPeriod, validTimeZone } from '../schedule-time';
import { AnalyticsComparisonError, analyticsDateRange } from '../../server/comparison';
import { audit, authorizeReport, bad, lockActor, missing, pageOf, requireWorkspaceWide, unavailable, usableChannelIds } from '../server/access';
import { reportLimits, transact, type ReportLimits } from '../server/limits';
import { cleanSections } from '../server/templates';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { ClaimLost, clearExpiredOutputs, deriveStatus, fencedUpdate, finishRun, mask, newToken, reportFailureText, requestHash, runOutcome, safeReason, scheduleOutcome, type RunRef } from './run-store';
import { mailReady, registeredReportPorts, runHistoryReady, reportCapabilities } from './registry';

export { reportFailureText } from './run-store';

/*
 * Delivery is never retried. Each recipient is persisted as `pending` when generation ends, as `attempting` BEFORE the mail
 * port is called, and as its outcome afterwards, each write fenced by the run's claim token. A mail-port throw, lost claim or
 * expired lease during an actual attempt therefore leaves that recipient uncertain; nothing resends it. The mail port is not assumed idempotent.
 */
const DEFAULT_SECTIONS: ReportSectionId[] = ['analysis', 'audience', 'published'];
const KNOWN_MAIL = new Set<ReportRecipientOutcome['status']>(['sent', 'failed', 'unavailable', 'uncertain']);
const subjectText = (text: string) => text.replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, 200);

type DueRow = { id: string; workspaceId: string; targetId: string; templateId: string | null; frequency: string; nextRunAt: Date; recipients: string[]; createdById: string | null; timezone: string; weekStartsOn: number; sections: unknown };
export type DueRunDeps = { generation?: ReportGenerationPort; mail?: ReportMailPort | null; now?: Date; clock?: () => Date; limits?: ReportLimits; /** Gate for the workspace owner's current plan/access; required for scheduled sends, false (or a throw) skips without generating. */ eligible?: ReportEligibility };
export type DueRunSummary = { disabled: boolean; examined: number; completed: number; partial: number; failed: number; uncertain: number; skipped: number; interrupted: number; maintenanceFailures: number; /** Prepared artifacts past their retention that were cleared this run. */ cleared: number };

/**
 * Close runs whose lease expired, a bounded batch per job run. A run interrupted while delivering becomes uncertain (never
 * resent); earlier phases become failed. Recipient intents that were attempting become uncertain, the rest skipped.
 */
async function sweepStale(limits: ReportLimits, now: Date): Promise<number> {
  return prisma.$transaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT r.id, r."workspaceId" FROM report_runs r WHERE r.status IN ('claimed','generating','delivering') AND r."leaseUntil" < ${now} AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = r."workspaceId" AND p.status::text <> 'completed') ORDER BY r."leaseUntil" ASC, r.id ASC LIMIT ${limits.staleBatch}`;
    if (!candidates.length) return 0;
    const workspaceIds = [...new Set(candidates.map(row => row.workspaceId))].sort();
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE id = ANY(${workspaceIds}::text[]) ORDER BY id FOR SHARE`;
    const lockedIds = new Set(locked.map(row => row.id));
    if (!lockedIds.size) return 0;
    const purging = await tx.$queryRaw<Array<{ workspaceId: string }>>`SELECT "workspaceId" FROM workspace_data_purges WHERE "workspaceId" = ANY(${[...lockedIds]}::text[]) AND status::text <> 'completed'`;
    const purgingIds = new Set(purging.map(row => row.workspaceId));
    const candidatesByWorkspace = new Map<string, string[]>();
    for (const row of candidates) {
      if (!lockedIds.has(row.workspaceId) || purgingIds.has(row.workspaceId)) continue;
      candidatesByWorkspace.set(row.workspaceId, [...(candidatesByWorkspace.get(row.workspaceId) ?? []), row.id]);
    }
    let closed = 0;
    for (const [workspaceId, ids] of candidatesByWorkspace) {
      const stale = await tx.$queryRaw<Array<{ id: string; workspaceId: string; scheduleId: string | null; kind: string; status: string; deliveries: unknown }>>`SELECT id, "workspaceId", "scheduleId", kind, status, deliveries FROM report_runs WHERE "workspaceId" = ${workspaceId} AND id = ANY(${ids}::text[]) AND status IN ('claimed','generating','delivering') AND "leaseUntil" < ${now} FOR UPDATE SKIP LOCKED`;
      for (const run of stale) {
      const original = Array.isArray(run.deliveries) ? run.deliveries as ReportRecipientOutcome[] : [];
      const delivering = run.status === 'delivering';
      const unknownSend = original.some(d => d.status === 'attempting' || d.status === 'uncertain');
      const deliveries = original.map(d => d.status === 'attempting' ? { ...d, status: 'uncertain' as const } : d.status === 'pending' ? { ...d, status: 'skipped' as const } : d);
      let status: ReportRunStatus = 'failed';
      let reason: string | null = 'lease_expired';
      if (delivering && unknownSend) { status = 'uncertain'; reason = 'lease_expired_during_delivery'; }
      else if (delivering) {
        if (original.length) {
          const outcome = deriveStatus(deliveries);
          status = outcome.status;
          reason = outcome.reason;
        } else {
          reason = 'delivery_not_started';
        }
      }
      const changed = await tx.$executeRaw`UPDATE report_runs SET status = ${status}, "failureReason" = ${reason}, deliveries = ${JSON.stringify(deliveries)}::jsonb, "finishedAt" = ${now} WHERE id = ${run.id} AND "workspaceId" = ${run.workspaceId} AND status IN ('claimed','generating','delivering') AND "leaseUntil" < ${now}`;
      if (changed !== 1) continue;
      closed += 1;
      if (run.kind === 'scheduled' && run.scheduleId) await scheduleOutcome(tx, run.scheduleId, run.workspaceId, now, reason);
      await audit(tx, { userId: null, workspaceId: run.workspaceId }, 'analytics.report_run_interrupted', { runId: run.id, scheduleId: run.scheduleId, status, reason });
      }
    }
    return closed;
  });
}

type Stop = { status: 'skipped' | 'failed'; reason: string };
/**
 * Current authority for a scheduled report, checked before generation and before every recipient: the person who set it up is
 * still an active writer with the feature, the workspace is neither suspended nor being erased, the channel is still selected,
 * connected and on an enabled+entitled platform, and the owner-eligibility gate still passes. Anything else fails closed.
 */
async function boundary(row: Pick<DueRow, 'workspaceId' | 'targetId' | 'createdById'>, eligible: ReportEligibility): Promise<Stop | null> {
  if (!row.createdById) return { status: 'failed', reason: 'no_report_owner' };
  let auth;
  try { auth = await authorizeReport({ userId: row.createdById, workspaceId: row.workspaceId }, 'write', { manager: true }); }
  catch (error) { return { status: 'skipped', reason: error instanceof OperationError && (error.code === 'conflict' || error.code === 'unavailable') ? 'workspace_unavailable' : 'access_unavailable' }; }
  if (auth.scope !== null && !auth.scope.includes(row.targetId)) return { status: 'skipped', reason: 'access_unavailable' };
  if (!(await usableChannelIds(prisma, row.workspaceId, auth.providers, [row.targetId])).length) return { status: 'skipped', reason: 'channel_unavailable' };
  let allowed = false;
  try { allowed = (await eligible(row.workspaceId, row.targetId)) === true; } catch { allowed = false; }
  return allowed ? null : { status: 'skipped', reason: 'access_unavailable' };
}

/**
 * Job body for the shared worker (which holds the job lease). Does nothing unless generation, a ready mail port, the
 * eligibility gate and run history all exist. Each due period is claimed once under FOR UPDATE SKIP LOCKED with a unique
 * idempotency key and a claim token; the schedule moves to its next period and the claim is audited in the same transaction.
 * Prepared manual artifacts past their retention are cleared first (history stays), even while delivery is unavailable.
 */
export async function runDueReportSchedules(deps: DueRunDeps = {}): Promise<DueRunSummary> {
  try {
  const summary: DueRunSummary = { disabled: false, examined: 0, completed: 0, partial: 0, failed: 0, uncertain: 0, skipped: 0, interrupted: 0, maintenanceFailures: 0, cleared: 0 };
  const registered = registeredReportPorts();
  const generation = deps.generation ?? registered?.generation;
  const mail = deps.generation ? deps.mail ?? null : registered?.mail ?? null;
  const eligible = deps.eligible ?? registered?.eligible ?? null;
  if (!(await runHistoryReady())) return { ...summary, disabled: true };
  const clock = deps.clock ?? (deps.now ? () => deps.now! : () => new Date());
  const limits = deps.limits ?? await reportLimits();
  try { summary.interrupted += await sweepStale(limits, clock()); }
  catch { summary.maintenanceFailures += 1; }
  try { summary.cleared += await clearExpiredOutputs(limits.staleBatch, clock()); }
  catch { summary.maintenanceFailures += 1; }
  if (!generation || !mail || !eligible || !(await mailReady(mail))) return { ...summary, disabled: true };

  // Claim and process one row at a time. Every claim gets a fresh lease based on
  // the current worker clock, so time spent on an earlier report cannot consume
  // a later report's lease. Attempts stay bounded even when rows are parked or
  // their idempotency key already exists.
  for (let attempt = 0; attempt < limits.dueBatch; attempt += 1) {
    const now = clock();
    const claim = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<DueRow[]>`SELECT s.id, s."workspaceId", s."targetId", s."templateId", s.frequency, s."nextRunAt", s.recipients, s."createdById", w.timezone, w."weekStartsOn", tp.sections FROM report_schedules s JOIN workspaces w ON w.id = s."workspaceId" LEFT JOIN report_templates tp ON tp.id = s."templateId" AND tp."workspaceId" = s."workspaceId" WHERE s."nextRunAt" <= ${now} AND w."suspendedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = s."workspaceId" AND p.status::text <> 'completed') ORDER BY s."nextRunAt" ASC LIMIT 1 FOR UPDATE OF s SKIP LOCKED`;
      const row = rows[0];
      if (!row) return null;
      const frequency = (REPORT_FREQUENCIES as readonly string[]).includes(row.frequency) ? row.frequency as ReportFrequency : 'weekly';
      if (!validTimeZone(row.timezone)) {
        const retryAt = new Date(now.getTime() + limits.leaseSeconds * 1000);
        const parked = await tx.$executeRaw`UPDATE report_schedules SET "nextRunAt" = ${retryAt}, "lastRunAt" = ${now}, "lastError" = 'workspace_time_zone_unavailable' WHERE id = ${row.id} AND "workspaceId" = ${row.workspaceId}`;
        if (parked === 1) {
          summary.skipped += 1;
          await audit(tx, { userId: row.createdById, workspaceId: row.workspaceId }, 'analytics.report_schedule_skipped', { scheduleId: row.id, reason: 'workspace_time_zone_unavailable', retryAt });
        }
        return { row: null };
      }
      const period = reportPeriod(frequency, row.nextRunAt, row.timezone, row.weekStartsOn);
      await tx.$executeRaw`UPDATE report_schedules SET "nextRunAt" = ${nextReportRun(frequency, now, row.timezone, row.weekStartsOn, limits.sendTime)} WHERE id = ${row.id} AND "workspaceId" = ${row.workspaceId}`;
      const runId = randomUUID(); const token = newToken();
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO report_runs (id, "workspaceId", "scheduleId", "targetId", kind, "idempotencyKey", "claimToken", "periodStart", "periodEnd", status, "leaseUntil", "startedAt", deliveries, "requestedById", "createdAt") VALUES (${runId}, ${row.workspaceId}, ${row.id}, ${row.targetId}, 'scheduled', ${`sched:${row.id}:${period.start}:${period.end}`}, ${token}, ${period.start}, ${period.end}, 'claimed', ${new Date(now.getTime() + limits.leaseSeconds * 1000)}, ${now}, '[]'::jsonb, ${row.createdById}, ${now}) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`;
      if (!inserted.length) return { row: null };
      await audit(tx, { userId: null, workspaceId: row.workspaceId }, 'analytics.report_run_claimed', { runId, scheduleId: row.id, channelId: row.targetId, kind: 'scheduled' });
      return { row: { ...row, frequency, runId, token, period } };
    }
    );
    if (!claim) break;
    if (!claim.row) continue;
    summary.examined += 1;

    const row = claim.row;
    const ref: RunRef = { id: row.runId, workspaceId: row.workspaceId, token: row.token };
    const step = (patch: Parameters<typeof fencedUpdate>[1]) => fencedUpdate(ref, patch, clock());
    let deliveries: ReportRecipientOutcome[] = [];
    let failedBeforeSend = false;
    let mailAttempted = false;
    let rowCount: number | undefined; let truncated: boolean | undefined;
    const finish = async (status: ReportRunStatus, reason: string | null) => {
      deliveries = deliveries.map(delivery => delivery.status === 'pending' ? { ...delivery, status: 'skipped' as const } : delivery);
      const detail = { runId: row.runId, scheduleId: row.id, status, reason, recipients: row.recipients.length, delivered: deliveries.filter(d => d.status === 'sent').length };
      const patch = { status, reason, rowCount, truncated, ...(deliveries.length ? { deliveries } : {}) };
      const done = await finishRun(ref, patch, clock, limits.finishRetries, { audit: { actor: { userId: row.createdById, workspaceId: row.workspaceId }, action: 'analytics.report_run_finished', detail }, after: tx => scheduleOutcome(tx, row.id, row.workspaceId, clock(), status === 'completed' ? null : reason).then(() => undefined) });
      if (!done) summary.interrupted += 1;
      else if (status === 'completed') summary.completed += 1; else if (status === 'partial') summary.partial += 1; else if (status === 'skipped') summary.skipped += 1; else if (status === 'uncertain') summary.uncertain += 1; else summary.failed += 1;
      // A delivered scheduled run also lands in the notification center. Best effort: the run outcome above is already recorded.
      if (done && (status === 'completed' || status === 'partial')) {
        try { await prisma.$transaction(tx => emitWorkspaceAlert(tx, { workspaceId: row.workspaceId, eventId: `report_${row.runId}`, kind: 'report_delivered', targetId: row.targetId }).then(() => undefined)); }
        catch { /* the run receipt stands; the center entry is advisory */ }
      }
    };
    try {
      const stop = await boundary(row, eligible);
      if (stop) { await finish(stop.status, stop.reason); continue; }
      await step({ status: 'generating', leaseSeconds: limits.leaseSeconds });
      const sections = row.sections === null || row.sections === undefined ? DEFAULT_SECTIONS : cleanSections(row.sections);
      let made;
      try { made = await generation.generate({ actor: { userId: row.createdById!, workspaceId: row.workspaceId }, channelId: row.targetId, sections, period: row.period }); }
      catch { made = { ok: false as const, reason: 'generation_failed' }; }
      if (!made.ok) { await finish('failed', safeReason(made.reason)); continue; }
      const out: ReportOutput = made.output;
      rowCount = out.rowCount; truncated = out.truncated;
      deliveries = row.recipients.map((address, index) => ({ index, mask: mask(address), status: 'pending' as const }));
      await step({ status: 'delivering', rowCount, truncated, deliveries, leaseSeconds: limits.leaseSeconds });
      for (const [index, address] of row.recipients.entries()) {
        // Authority and the recipient list are re-read at every recipient boundary.
        const halt = await boundary(row, eligible);
        const current = halt ? null : (await prisma.$queryRaw<Array<{ recipients: string[] }>>`SELECT recipients FROM report_schedules WHERE id = ${row.id} AND "workspaceId" = ${row.workspaceId}`)[0];
        if (halt || !current) {
          deliveries = deliveries.map(d => d.index >= index && d.status === 'pending' ? { ...d, status: 'skipped' as const } : d);
          await step({ status: 'delivering', deliveries, leaseSeconds: limits.leaseSeconds });
          break;
        }
        if (!current.recipients.includes(address)) {
          deliveries[index] = { index, mask: mask(address), status: 'skipped' };
          await step({ status: 'delivering', deliveries, leaseSeconds: limits.leaseSeconds });
          continue;
        }
        const previous = deliveries[index]!;
        deliveries[index] = { index, mask: mask(address), status: 'attempting' };
        try { await step({ status: 'delivering', deliveries, leaseSeconds: limits.leaseSeconds }); } // intent is durable before any send
        catch (error) { deliveries[index] = previous; failedBeforeSend = true; throw error; }
        let status: ReportRecipientOutcome['status'];
        mailAttempted = true;
        try { const sent = await mail.send({ to: address, subject: subjectText(`Analytics report: ${out.channelName} (${row.period.start} to ${row.period.end})`), text: out.text, html: out.html, idempotencyKey: `${row.runId}:${index}`, workspaceId: row.workspaceId }); status = KNOWN_MAIL.has(sent?.status) ? sent.status : 'uncertain'; }
        catch { status = 'uncertain'; }
        deliveries[index] = { index, mask: mask(address), status };
        await step({ status: 'delivering', deliveries, leaseSeconds: limits.leaseSeconds });
      }
      const result = deriveStatus(deliveries);
      await finish(result.status, result.reason);
    } catch (error) {
      if (error instanceof ClaimLost) { summary.interrupted += 1; continue; }
      // Whatever is known about delivery is kept: an unrecorded attempt stays uncertain, never failed.
      try {
        if (failedBeforeSend) {
          deliveries = deliveries.map(d => d.status === 'pending' ? { ...d, status: 'skipped' as const } : d);
          const sent = deliveries.some(d => d.status === 'sent');
          const uncertain = deliveries.some(d => d.status === 'uncertain' || d.status === 'attempting');
          if (uncertain) await finish('uncertain', 'delivery_uncertain');
          else await finish(sent ? 'partial' : 'failed', mailAttempted ? 'delivery_failed' : 'delivery_not_started');
        }
        else if (deliveries.length) { const result = deriveStatus(deliveries); await finish(result.status, result.reason); }
        else await finish('failed', 'generation_failed');
      } catch { summary.interrupted += 1; }
    }
  }
  return summary;

  } catch (error) { throw await localizeAnalyticsError(error); }
}

/** Run history within the person's channel scope and current connections. Recipient masks are shown only to people who manage schedules. */
export async function listReportRuns(actor: ReportActor, input: unknown = {}) {
  try {
  const parsed = listSchema.safeParse(input ?? {}); if (!parsed.success) throw bad( errorCopyDefaults["Choose a valid result page."].en);
  const auth = await authorizeReport(actor, 'read');
  const limits = await reportLimits();
  const size = pageOf(limits.historyPageSize, auth.maxItems);
  if ((auth.scope && !auth.scope.length) || !auth.providers.length) return { ok: true as const, runs: [] as ReportRunView[], page: parsed.data.page, hasMore: false };
  const offset = (parsed.data.page - 1) * size;
  const scope = auth.scope;
  const rows = await prisma.$queryRaw<Array<{ id: string; scheduleId: string | null; targetId: string; kind: string; status: string; periodStart: string; periodEnd: string; startedAt: Date; finishedAt: Date | null; rowCount: number | null; truncated: boolean; failureReason: string | null; deliveries: unknown }>>`SELECT r.id, r."scheduleId", r."targetId", r.kind, r.status, r."periodStart", r."periodEnd", r."startedAt", r."finishedAt", r."rowCount", r.truncated, r."failureReason", r.deliveries FROM report_runs r JOIN targets t ON t.id = r."targetId" AND t."workspaceId" = r."workspaceId" JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE r."workspaceId" = ${actor.workspaceId} AND t.enabled = true AND a."invalidatedAt" IS NULL AND a.provider = ANY(${[...auth.providers]}::text[]) AND (${scope === null}::boolean OR r."targetId" = ANY(${[...(scope ?? [])]}::text[])) ORDER BY r."startedAt" DESC, r.id ASC OFFSET ${offset} LIMIT ${size + 1}`;
  const runs: ReportRunView[] = rows.slice(0, size).map(r => {
    const kind = r.kind === 'manual' ? 'manual' as const : 'scheduled' as const;
    return {
      id: r.id, scheduleId: r.scheduleId, channelId: r.targetId, kind, status: r.status as ReportRunStatus, periodStart: r.periodStart, periodEnd: r.periodEnd,
      startedAt: r.startedAt, finishedAt: r.finishedAt, rowCount: r.rowCount, truncated: r.truncated, failureReason: r.failureReason,
      deliveries: auth.canManage && Array.isArray(r.deliveries) ? r.deliveries as ReportRecipientOutcome[] : [], outcome: runOutcome(kind, r.status),
    };
  });
  return { ok: true as const, runs, page: parsed.data.page, hasMore: rows.length > size };

  } catch (error) { throw await localizeAnalyticsError(error); }
}

/** Explicit inclusive UTC dates under the shared Analytics date policy (Root's default and maximum range), never in the future. */
async function directPeriod(start: string, end: string, now: Date): Promise<ReportPeriod> {
  let days: [number, number];
  try {
    const [defaultDays, maxDays] = (await Promise.all([runtimeConfig('analytics.defaultRangeDays'), runtimeConfig('analytics.maxRangeDays')])).map(Number);
    days = [defaultDays!, maxDays!];
  } catch { throw unavailable(); }
  try {
    const range = analyticsDateRange({ start, end }, { defaultDays: Math.min(days[0], days[1]), maxDays: days[1], now });
    if (range.end > now.toISOString().slice(0, 10)) throw bad( errorCopyDefaults["Choose a through date that is not in the future."].en);
    return { start: range.start, end: range.end };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    if (error instanceof AnalyticsComparisonError) {
      if (error.code === 'invalid_policy') throw await analyticsError('unavailable', "Report dates could not be checked. Try again shortly.");
      if (error.code === 'range_too_large') throw bad(defaultAnalyticsError('Choose a range of at most {0} days.', days[1]));
      if (error.code === 'invalid_range') throw bad( errorCopyDefaults["The From date must be on or before the Through date."].en);
      throw bad( errorCopyDefaults["Choose valid From and Through dates."].en);
    }
    throw error;
  }
}

/** Authority at the moment content would be released: the person, scope and channel must still qualify now. */
async function releaseBlocker(actor: ReportActor, channelId: string): Promise<string | null> {
  try {
    const again = await authorizeReport(actor, 'write', { manager: true });
    if (again.scope !== null && !again.scope.includes(channelId)) return 'access_unavailable';
    if (!(await usableChannelIds(prisma, actor.workspaceId, again.providers, [channelId])).length) return 'channel_unavailable';
    return null;
  } catch { return 'access_unavailable'; }
}

function readStored(value: unknown): ReportStoredOutput | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const period = v.period as Record<string, unknown> | undefined;
  if (typeof v.csv !== 'string' || typeof v.html !== 'string' || typeof v.channelName !== 'string' || typeof v.rowCount !== 'number' || typeof v.truncated !== 'boolean' || !period || typeof period.start !== 'string' || typeof period.end !== 'string') return null;
  return { channelName: v.channelName, period: { start: period.start, end: period.end }, generatedAt: typeof v.generatedAt === 'string' ? v.generatedAt : '', sections: Array.isArray(v.sections) ? v.sections as ReportSectionId[] : [], notIncluded: Array.isArray(v.notIncluded) ? v.notIncluded as ReportSectionId[] : [], csv: v.csv, html: v.html, ...(typeof v.json === 'string' ? { json: v.json } : {}), rowCount: v.rowCount, truncated: v.truncated };
}
/** `bytes` is always the exact UTF-8 size of the CSV being returned. */
const released = (runId: string, out: ReportStoredOutput, replayed: boolean) => ({
  ok: true as const, runId, period: out.period, channelName: out.channelName, filename: `report-${out.period.start}-${out.period.end}`, csv: out.csv, html: out.html, json: out.json ?? null,
  rowCount: out.rowCount, bytes: Buffer.byteLength(out.csv, 'utf8'), truncated: out.truncated, notIncluded: out.notIncluded, outcome: 'prepared' as const, replayed,
});

type Prepared =
  | { kind: 'replay'; runId: string; channelId: string; stored: ReportStoredOutput }
  | { kind: 'new'; runId: string; token: string; channelId: string; scheduleId: string | null; templateId: string | null; period: ReportPeriod; sections: ReportSectionId[] };
type Existing = { id: string; status: string; requestHash: string | null; targetId: string; output: unknown; outputExpiresAt: Date | null };

/**
 * Prepare a report for download. Nothing is emailed and the run is recorded as Prepared, never Sent. Two forms share one
 * confirmed, idempotent operation:
 *   - a schedule's most recent complete period (`scheduleId`), or
 *   - one channel over explicit inclusive UTC dates with an optional template (`channelId`, `start`, `end`), which needs no
 *     delivery, SMTP or job support.
 * Identity is workspace + person + requestId and the request hash binds the normalised input. The same id with the same input
 * recovers a prepared result (after reauthorisation) instead of regenerating; a different input, a run still in progress, a
 * failed run or an expired artifact is reported explicitly and never regenerated.
 */
export async function runReportNow(actor: ReportActor, input: unknown, at?: Date) {
  try {
  const now = at ?? new Date();
  const parsed = reportRunSchema.safeParse(input); if (!parsed.success) throw bad();
  const value = parsed.data;
  const direct = 'channelId' in value;
  if (value.confirmation !== (direct ? reportChannelRunConfirmation(value.channelId) : reportRunConfirmation(value.scheduleId))) throw bad();
  const auth = await authorizeReport(actor, 'write', { manager: true });
  if (direct && value.templateId !== null) requireWorkspaceWide(actor);
  const ports = registeredReportPorts();
  if (!ports || !(await reportCapabilities()).generate) throw unavailable();
  const limits = await reportLimits();
  const period = direct ? await directPeriod(value.start, value.end, now) : null;
  const key = `manual:${actor.workspaceId}:${actor.userId}:${value.requestId}`;
  const prepared = await transact<Prepared>(actor.workspaceId, limits, async tx => {
    const fresh = await lockActor(tx, actor);
    let channelId: string; let templateId: string | null; let sections: ReportSectionId[]; let runPeriod: ReportPeriod; let hash: string;
    if (direct) {
      channelId = value.channelId; templateId = value.templateId; runPeriod = period!;
      if (fresh.scope !== null && !fresh.scope.includes(channelId)) throw missing();
      if (templateId) {
        const template = (await tx.$queryRaw<Array<{ id: string; sections: unknown }>>`SELECT id, sections FROM report_templates WHERE id = ${templateId} AND "workspaceId" = ${actor.workspaceId}`)[0];
        if (!template) throw bad( errorCopyDefaults["Choose a report template from this workspace."].en);
        sections = cleanSections(template.sections);
      } else sections = DEFAULT_SECTIONS;
      hash = requestHash({ kind: 'channel', channelId, templateId, start: runPeriod.start, end: runPeriod.end });
    } else {
      const row = (await tx.$queryRaw<Array<{ targetId: string; frequency: string; templateId: string | null; timezone: string; weekStartsOn: number; sections: unknown }>>`SELECT s."targetId", s.frequency, s."templateId", w.timezone, w."weekStartsOn", tp.sections FROM report_schedules s JOIN workspaces w ON w.id = s."workspaceId" LEFT JOIN report_templates tp ON tp.id = s."templateId" AND tp."workspaceId" = s."workspaceId" WHERE s.id = ${value.scheduleId} AND s."workspaceId" = ${actor.workspaceId}`)[0];
      if (!row || (fresh.scope !== null && !fresh.scope.includes(row.targetId))) throw missing();
      if (!validTimeZone(row.timezone)) throw await analyticsError('unavailable', "The workspace time zone is unavailable. Review workspace settings.");
      const frequency = (REPORT_FREQUENCIES as readonly string[]).includes(row.frequency) ? row.frequency as ReportFrequency : 'weekly';
      channelId = row.targetId; templateId = row.templateId; runPeriod = reportPeriod(frequency, now, row.timezone, row.weekStartsOn);
      sections = row.sections === null || row.sections === undefined ? DEFAULT_SECTIONS : cleanSections(row.sections);
      hash = requestHash({ kind: 'schedule', scheduleId: value.scheduleId, channelId, templateId });
    }
    if (!(await usableChannelIds(tx, actor.workspaceId, auth.providers, [channelId], true)).length) throw bad(direct ? errorCopyDefaults["This channel is not available. Choose another channel."].en : errorCopyDefaults["This channel is not available. Choose another schedule."].en);

    const existing = (await tx.$queryRaw<Existing[]>`SELECT id, status, "requestHash", "targetId", output, "outputExpiresAt" FROM report_runs WHERE "idempotencyKey" = ${key} AND "workspaceId" = ${actor.workspaceId} FOR SHARE`)[0];
    if (existing) {
      if (existing.requestHash !== hash || existing.targetId !== channelId) throw await analyticsError('conflict', "This request id was already used for a different report. Start a new request.");
      if (existing.status === 'claimed' || existing.status === 'generating') throw await analyticsError('conflict', "This report is still being prepared and will not be started again. Wait a moment, then check the run history.");
      if (existing.status !== 'completed') throw await analyticsError('conflict', "This request already ended without a report. Start a new request.");
      const stored = existing.outputExpiresAt && existing.outputExpiresAt.getTime() > now.getTime() ? readStored(existing.output) : null;
      if (!stored) throw await analyticsError('unavailable', "This prepared report is no longer available and will not be regenerated. Start a new request.");
      if (!Number.isSafeInteger(stored.rowCount) || stored.rowCount < 0 || stored.rowCount > Math.min(limits.maxRows, auth.maxItems ?? limits.maxRows) || Buffer.byteLength(stored.csv, 'utf8') > limits.maxBytes || Buffer.byteLength(stored.html, 'utf8') > limits.maxBytes || (stored.json !== undefined && Buffer.byteLength(stored.json, 'utf8') > limits.maxBytes) || Buffer.byteLength(JSON.stringify(stored), 'utf8') > limits.maxStoredBytes) throw await analyticsError('unavailable', "This prepared report exceeds your current report limits. Start a new request.");
      return { kind: 'replay', runId: existing.id, channelId, stored };
    }

    const runId = randomUUID(); const token = newToken();
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO report_runs (id, "workspaceId", "scheduleId", "targetId", kind, "idempotencyKey", "requestHash", "claimToken", "periodStart", "periodEnd", status, "leaseUntil", "startedAt", deliveries, "requestedById", "createdAt") VALUES (${runId}, ${actor.workspaceId}, ${direct ? null : value.scheduleId}, ${channelId}, 'manual', ${key}, ${hash}, ${token}, ${runPeriod.start}, ${runPeriod.end}, 'generating', ${new Date(now.getTime() + limits.leaseSeconds * 1000)}, ${now}, '[]'::jsonb, ${actor.userId}, ${now}) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`;
    if (!inserted.length) throw await analyticsError('conflict', "This report request was already handled. Check the run history.");
    await audit(tx, actor, 'analytics.report_run_started', { runId, scheduleId: direct ? null : value.scheduleId, channelId, templateId, start: runPeriod.start, end: runPeriod.end, kind: 'manual' });
    return { kind: 'new', runId, token, channelId, scheduleId: direct ? null : value.scheduleId, templateId, period: runPeriod, sections };
  });

  if (prepared.kind === 'replay') {
    // A stored result is shown again only if the person, feature, key, scope and connection still qualify now.
    if (await releaseBlocker(actor, prepared.channelId)) throw await analyticsError('forbidden', "You no longer have access to this report.");
    await prisma.$transaction(tx => audit(tx, actor, 'analytics.report_run_replayed', { runId: prepared.runId, channelId: prepared.channelId }));
    return released(prepared.runId, prepared.stored, true);
  }

  const ref: RunRef = { id: prepared.runId, workspaceId: actor.workspaceId, token: prepared.token };
  const clock = at ? () => at : () => new Date();
  const detail = { runId: prepared.runId, scheduleId: prepared.scheduleId, channelId: prepared.channelId };
  const fail = async (reason: string): Promise<never> => {
    await finishRun(ref, { status: 'failed', reason }, clock, limits.finishRetries, { audit: { actor, action: 'analytics.report_run_finished', detail: { ...detail, status: 'failed', reason } } });
    throw new OperationError('unavailable', reportFailureText(reason) ?? errorCopyDefaults['The report could not be prepared.'].en);
  };
  let output: ReportOutput | null = null; let reason: string | null = null;
  try { const made = await ports.generation.generate({ actor, channelId: prepared.channelId, sections: prepared.sections, period: prepared.period }); if (made.ok) output = made.output; else reason = safeReason(made.reason); }
  catch { reason = 'generation_failed'; }
  if (!output) return fail(reason ?? 'generation_failed');
  // A foreign generator must still honour the key's result ceiling: rows, not just list pages, are bounded.
  if (auth.maxItems !== undefined && output.rowCount > auth.maxItems) return fail('result_too_large');
  // The content is released only if the person and channel still qualify now.
  const lost = await releaseBlocker(actor, prepared.channelId);
  if (lost) return fail(lost);
  const stored: ReportStoredOutput = { channelName: output.channelName, period: output.period, generatedAt: output.generatedAt, sections: output.sections, notIncluded: output.notIncluded, csv: output.csv, html: output.html, ...(output.json === undefined ? {} : { json: output.json }), rowCount: output.rowCount, truncated: output.truncated };
  if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > limits.maxStoredBytes) return fail('stored_output_too_large');
  // The artifact is stored in the same fenced completion + audit transaction, before anything is released over HTTP/MCP.
  const completedAt = clock();
  const recorded = await finishRun(ref, { status: 'completed', rowCount: output.rowCount, truncated: output.truncated, output: stored, outputExpiresAt: new Date(completedAt.getTime() + limits.retentionHours * 3600 * 1000) }, clock, limits.finishRetries, { audit: { actor, action: 'analytics.report_run_finished', detail: { ...detail, status: 'completed', rows: output.rowCount, truncated: output.truncated, kind: 'manual' } } });
  if (!recorded) throw await analyticsError('unavailable', "The report could not be recorded, so it was not released. Try again with a new request.");
  return released(prepared.runId, stored, false);

  } catch (error) { throw await localizeAnalyticsError(error); }
}
