import { TargetType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from './prisma';
import { buildReport } from './reports';
import { sendEmail } from './email/send';
import { scheduledReportEmail } from './email/templates';
import { errors } from './errors';
import { formatInZone, localInputToUtc } from './time';
import { REPORT_SECTIONS } from './report-sections';
import { RANGE_PRESETS } from './date-range';

/**
 * Reports that go out on their own: every Monday for the week before, or on
 * the 1st for the month before, to people who may never open the app.
 *
 * Each run is pinned to 08:00 in the workspace's zone, so a client in
 * Casablanca reads last week's figures with Monday's coffee rather than at
 * whatever hour UTC's Monday happens to start for them.
 */

export const REPORT_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

const SEND_HOUR = '08:00';
const MAX_RECIPIENTS = 10;

export const reportTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  sections: z.array(z.enum(REPORT_SECTIONS)).min(1),
  rangeKey: z.enum(RANGE_PRESETS).default('30d'),
});

export const reportScheduleSchema = z.object({
  targetId: z.string().min(1),
  frequency: z.enum(REPORT_FREQUENCIES),
  recipients: z
    .array(z.string().trim().toLowerCase().email())
    .min(1)
    .max(MAX_RECIPIENTS)
    .transform((list) => [...new Set(list)]),
  templateId: z.string().min(1).nullable().optional(),
});

/** `YYYY-MM-DD` of a moment, in a zone. */
function dayIn(date: Date, timeZone: string): string {
  return formatInZone(date, timeZone, 'yyyy-MM-dd');
}

function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6, of a calendar day. */
function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

/** The first run strictly after `after`: next Monday or next 1st, at 08:00 local. */
export function nextReportRun(frequency: ReportFrequency, after: Date, timeZone: string): Date {
  let day = dayIn(after, timeZone);
  for (let guard = 0; guard < 40; guard += 1) {
    const due =
      frequency === 'weekly' ? weekdayOf(day) === 0 : day.endsWith('-01');
    if (due) {
      const at = localInputToUtc(`${day}T${SEND_HOUR}`, timeZone);
      if (at.getTime() > after.getTime()) return at;
    }
    day = shiftDay(day, 1);
  }
  throw new Error('No report run found within forty days.');
}

/**
 * What a run sent at `runAt` reports on: the whole week (Monday to Sunday) or
 * the whole month before it, midnight to midnight in the workspace's zone.
 */
export function reportPeriod(
  frequency: ReportFrequency,
  runAt: Date,
  timeZone: string,
): { from: Date; to: Date; fromDay: string; toDay: string } {
  const today = dayIn(runAt, timeZone);
  let fromDay: string;
  let endDay: string;
  if (frequency === 'weekly') {
    endDay = shiftDay(today, -weekdayOf(today));
    fromDay = shiftDay(endDay, -7);
  } else {
    endDay = `${today.slice(0, 7)}-01`;
    const [year, month] = endDay.split('-').map(Number) as [number, number];
    fromDay = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  }
  return {
    from: localInputToUtc(`${fromDay}T00:00`, timeZone),
    to: new Date(localInputToUtc(`${endDay}T00:00`, timeZone).getTime() - 1),
    fromDay,
    toDay: shiftDay(endDay, -1),
  };
}

export async function createReportSchedule(workspaceId: string, input: z.infer<typeof reportScheduleSchema>) {
  const [workspace, target] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } }),
    prisma.target.findFirst({ where: { id: input.targetId, workspaceId, type: TargetType.page } }),
  ]);
  if (!target) throw errors.notFound();
  if (input.templateId) {
    const template = await prisma.reportTemplate.findFirst({ where: { id: input.templateId, workspaceId } });
    if (!template) throw errors.notFound();
  }
  return prisma.reportSchedule.create({
    data: {
      workspaceId,
      targetId: target.id,
      templateId: input.templateId ?? null,
      frequency: input.frequency,
      recipients: input.recipients,
      nextRunAt: nextReportRun(input.frequency, new Date(), workspace.timezone),
    },
  });
}

/**
 * Send every report whose time has come. One failure is recorded on its own
 * schedule and never stops the others; the next run is always moved on, so a
 * broken address does not mail the rest of the list every minute.
 */
export async function sendDueReports(now: Date): Promise<{ sent: number; failed: number }> {
  const due = await prisma.reportSchedule.findMany({
    where: { nextRunAt: { lte: now } },
    include: { workspace: { select: { id: true, name: true, timezone: true, defaultLocale: true } } },
    orderBy: { nextRunAt: 'asc' },
    take: 50,
  });

  let sent = 0;
  let failed = 0;
  for (const schedule of due) {
    const frequency = schedule.frequency as ReportFrequency;
    const timeZone = schedule.workspace.timezone;
    let lastError: string | null = null;
    try {
      const target = await prisma.target.findFirst({
        where: { id: schedule.targetId, workspaceId: schedule.workspaceId },
        select: { id: true, name: true, followersCount: true, fanCount: true },
      });
      if (!target) throw new Error('The Page is no longer connected.');
      const period = reportPeriod(frequency, schedule.nextRunAt, timeZone);
      const report = await buildReport({
        workspaceId: schedule.workspaceId,
        timezone: timeZone,
        from: period.from,
        to: period.to,
        targetIds: [target.id],
      });
      const email = scheduledReportEmail({
        locale: schedule.workspace.defaultLocale,
        workspace: schedule.workspace.name,
        page: target.name,
        frequency,
        period: `${formatInZone(period.from, timeZone, 'd MMM')} – ${formatInZone(period.to, timeZone, 'd MMM yyyy')}`,
        followers: target.followersCount ?? target.fanCount ?? null,
        report,
      });
      const outcomes = await Promise.all(
        schedule.recipients.map((to) =>
          sendEmail({ to, ...email, template: 'scheduledReport', workspaceId: schedule.workspaceId }),
        ),
      );
      const bad = outcomes.find((outcome) => outcome.status === 'failed');
      if (bad) lastError = bad.error ?? 'Sending failed.';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        lastError,
        nextRunAt: nextReportRun(frequency, now, timeZone),
      },
    });
    if (lastError) failed += 1;
    else sent += 1;
  }
  return { sent, failed };
}
