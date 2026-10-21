import { defaultAnalyticsError } from '@/modules/analytics/error-copy';
import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { REPORT_FREQUENCIES, listSchema, reportConfirmation, scheduleActionSchema, type ReportActor, type ReportFrequency, type ReportScheduleView } from '../contracts';
import { nextReportRun, validTimeZone } from '../schedule-time';
import { audit, authorizeReport, bad, lockActor, missing, pageOf, usableChannelIds, workspaceWide, type Tx } from './access';
import { reportCapabilities } from '../generation/registry';
import { reportLimits, transact } from './limits';

type Row = { id: string; targetId: string; targetName: string | null; templateId: string | null; templateName: string | null; frequency: string; recipients: string[]; nextRunAt: Date; lastRunAt: Date | null; lastError: string | null; createdAt: Date; usable: boolean | null };

export async function listReportSchedules(actor: ReportActor, input: unknown = {}) {
  try {
  const parsed = listSchema.safeParse(input ?? {}); if (!parsed.success) throw bad( errorCopyDefaults["Choose a valid result page."].en);
  const auth = await authorizeReport(actor, 'read');
  const limits = await reportLimits();
  const size = pageOf(limits.pageSize, auth.maxItems);
  const offset = (parsed.data.page - 1) * size;
  const scope = auth.scope;
  if (scope && !scope.length) return { ok: true as const, schedules: [] as ReportScheduleView[], page: parsed.data.page, hasMore: false, canManage: false };
  const wide = workspaceWide(actor);
  const rows = await prisma.$queryRaw<Row[]>`SELECT s.id, s."targetId", t.name AS "targetName", s."templateId", tp.name AS "templateName", s.frequency, s.recipients, s."nextRunAt", s."lastRunAt", s."lastError", s."createdAt", (t.enabled = true AND a."invalidatedAt" IS NULL AND a.provider = ANY(${[...auth.providers]}::text[])) AS usable FROM report_schedules s LEFT JOIN targets t ON t.id = s."targetId" AND t."workspaceId" = s."workspaceId" LEFT JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" LEFT JOIN report_templates tp ON tp.id = s."templateId" AND tp."workspaceId" = s."workspaceId" WHERE s."workspaceId" = ${actor.workspaceId} AND (${scope === null}::boolean OR s."targetId" = ANY(${[...(scope ?? [])]}::text[])) ORDER BY s."nextRunAt" ASC, s.id ASC OFFSET ${offset} LIMIT ${size + 1}`;
  const schedules: ReportScheduleView[] = rows.slice(0, size).map(r => ({
    id: r.id, channelId: r.targetId, channelName: r.targetName,
    // Templates are workspace-wide: a selected-resource key sees neither their ids nor names.
    templateId: wide ? r.templateId : null, templateName: wide ? r.templateName : null,
    frequency: (REPORT_FREQUENCIES as readonly string[]).includes(r.frequency) ? r.frequency as ReportFrequency : 'weekly', recipientCount: r.recipients.length,
    // Outside recipients' addresses are shown only to people who may manage the schedule (read-only keys never).
    recipients: auth.canManage ? r.recipients : [], nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt,
    lastOutcome: r.lastRunAt === null ? 'never' : r.lastError ? 'failed' : 'generated', createdAt: r.createdAt, channelAvailable: r.usable === true,
  }));
  return { ok: true as const, schedules, page: parsed.data.page, hasMore: rows.length > size, canManage: auth.canManage };

  } catch (error) { throw await localizeAnalyticsError(error); }
}

async function workspaceClock(tx: Tx, workspaceId: string) {
  const row = (await tx.$queryRaw<Array<{ timezone: string; weekStartsOn: number }>>`SELECT timezone, "weekStartsOn" FROM workspaces WHERE id = ${workspaceId}`)[0];
  if (!row || !validTimeZone(row.timezone)) throw await analyticsError('unavailable', "The workspace time zone is unavailable. Review workspace settings.");
  return row;
}
const inScope = (scope: readonly string[] | null, id: string) => scope === null || scope.includes(id);

export async function manageReportSchedule(actor: ReportActor, input: unknown, now = new Date()) {
  try {
  const parsed = scheduleActionSchema.safeParse(input); if (!parsed.success) throw bad();
  const value = parsed.data;
  const frequencyOf = value.action === 'delete' ? '' : value.frequency;
  const expected = value.action === 'create' ? reportConfirmation.createSchedule(value.channelId, frequencyOf) : value.action === 'update' ? reportConfirmation.updateSchedule(value.id) : reportConfirmation.deleteSchedule(value.id);
  if (value.confirmation !== expected) throw bad();
  const auth = await authorizeReport(actor, 'write', { manager: true });
  const wide = workspaceWide(actor);
  // Templates are workspace-wide; a selected-resource key can neither attach nor change one.
  if (!wide && value.action !== 'delete' && value.templateId !== null) throw bad( errorCopyDefaults["Report templates are not available to access keys limited to selected channels."].en);
  // A schedule that nothing can generate or deliver would look active while doing nothing: refuse new ones.
  if (value.action === 'create' && !(await reportCapabilities()).schedules) throw await analyticsError('unavailable', "Scheduled reports are not available right now.");
  const limits = await reportLimits();
  const recipients = value.action === 'delete' ? [] : [...new Set(value.recipients)];
  if (recipients.length > limits.maxRecipients) throw bad(defaultAnalyticsError('List at most {0} recipients.', limits.maxRecipients));
  return transact(actor.workspaceId, limits, async tx => {
    const fresh = await lockActor(tx, actor);
    if (value.action === 'create') {
      // New content must be a currently selected, connected channel of an enabled, entitled platform inside the person's scope.
      if (!inScope(fresh.scope, value.channelId) || !(await usableChannelIds(tx, actor.workspaceId, auth.providers, [value.channelId], true)).length) throw bad( errorCopyDefaults["Choose a channel you can manage in this workspace."].en);
      if (value.templateId && !(await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM report_templates WHERE id = ${value.templateId} AND "workspaceId" = ${actor.workspaceId}`).length) throw bad( errorCopyDefaults["Choose a report template from this workspace."].en);
      const count = Number((await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM report_schedules WHERE "workspaceId" = ${actor.workspaceId}`)[0]?.count ?? 0);
      if (count >= limits.maxSchedules) throw await analyticsError('conflict', "This workspace has reached its report schedule limit. Delete one first.");
      const clock = await workspaceClock(tx, actor.workspaceId);
      const next = nextReportRun(value.frequency, now, clock.timezone, clock.weekStartsOn, limits.sendTime);
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO report_schedules (id, "workspaceId", "templateId", "targetId", frequency, recipients, "nextRunAt", "aiRecap", "createdById", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${value.templateId}, ${value.channelId}, ${value.frequency}, ${recipients}::text[], ${next}, false, ${actor.userId}, NOW())`;
      await audit(tx, actor, 'analytics.report_schedule_created', { scheduleId: id, channelId: value.channelId, frequency: value.frequency, recipients: recipients.length, templateId: value.templateId });
      return { ok: true as const, action: value.action, id, nextRunAt: next };
    }
    // Existing schedules stay manageable (edit recipients, delete) even if their channel was disconnected; they never run then.
    const current = (await tx.$queryRaw<Array<{ id: string; targetId: string; templateId: string | null }>>`SELECT id, "targetId", "templateId" FROM report_schedules WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`)[0];
    if (!current || !inScope(fresh.scope, current.targetId)) throw missing();
    if (value.action === 'update') {
      const templateId = wide ? value.templateId : current.templateId;
      if (wide && templateId && !(await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM report_templates WHERE id = ${templateId} AND "workspaceId" = ${actor.workspaceId}`).length) throw bad( errorCopyDefaults["Choose a report template from this workspace."].en);
      const clock = await workspaceClock(tx, actor.workspaceId);
      const next = nextReportRun(value.frequency, now, clock.timezone, clock.weekStartsOn, limits.sendTime);
      const changed = await tx.$executeRaw`UPDATE report_schedules SET frequency = ${value.frequency}, recipients = ${recipients}::text[], "templateId" = ${templateId}, "nextRunAt" = ${next} WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (!changed) throw missing();
      await audit(tx, actor, 'analytics.report_schedule_updated', { scheduleId: value.id, channelId: current.targetId, frequency: value.frequency, recipients: recipients.length, templateId });
      return { ok: true as const, action: value.action, id: value.id, nextRunAt: next };
    }
    const removed = await tx.$executeRaw`DELETE FROM report_schedules WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (!removed) throw missing();
    await audit(tx, actor, 'analytics.report_schedule_deleted', { scheduleId: value.id, channelId: current.targetId });
    return { ok: true as const, action: value.action, id: value.id };
  });

  } catch (error) { throw await localizeAnalyticsError(error); }
}

export { runDueReportSchedules, type DueRunDeps, type DueRunSummary } from '../generation/runs';
