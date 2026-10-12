import { Locale, TargetType, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';

import { aiAvailable, writeReportRecap, type RecapFigures } from './ai';
import { prisma } from './prisma';
import { buildReport } from './reports';
import { sendEmail } from './email/send';
import { scheduledReportEmail } from './email/templates';
import { errors } from './errors';
import { formatInZone, localInputToUtc } from './time';
import { REPORT_SECTIONS } from './report-sections';
import { RANGE_PRESETS } from './date-range';
import { emitWebhook } from './webhooks';

/**
 * Reports that go out on their own: every Monday for the week before, or on
 * the 1st for the month before, to people who may never open the app.
 *
 * Each run is pinned to 08:00 in the workspace's zone, so a client in
 * Toronto reads last week's figures with Monday's coffee rather than at
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
  aiRecap: z.boolean().optional(),
});

/** `YYYY-MM-DD` of a moment, in a zone. */
function dayIn(date: Date, timeZone: string): string {
  return formatInZone(date, timeZone, 'yyyy-MM-dd');
}

function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

/** Days since the start of the week (0 on its first day), of a calendar day. */
function weekdayOf(day: string, weekStartsOn: number): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() - weekStartsOn + 7) % 7;
}

/**
 * The first run strictly after `after`: the next first day of the workspace's
 * week (Monday unless it chose otherwise) or the next 1st, at 08:00 local.
 */
export function nextReportRun(frequency: ReportFrequency, after: Date, timeZone: string, weekStartsOn = 1): Date {
  let day = dayIn(after, timeZone);
  for (let guard = 0; guard < 40; guard += 1) {
    const due =
      frequency === 'weekly' ? weekdayOf(day, weekStartsOn) === 0 : day.endsWith('-01');
    if (due) {
      const at = localInputToUtc(`${day}T${SEND_HOUR}`, timeZone);
      if (at.getTime() > after.getTime()) return at;
    }
    day = shiftDay(day, 1);
  }
  throw new Error('No report run found within forty days.');
}

/**
 * What a run sent at `runAt` reports on: the whole week (from the workspace's
 * first day of the week) or the whole month before it, midnight to midnight in
 * the workspace's zone.
 */
export function reportPeriod(
  frequency: ReportFrequency,
  runAt: Date,
  timeZone: string,
  weekStartsOn = 1,
): { from: Date; to: Date; fromDay: string; toDay: string } {
  const today = dayIn(runAt, timeZone);
  let fromDay: string;
  let endDay: string;
  if (frequency === 'weekly') {
    endDay = shiftDay(today, -weekdayOf(today, weekStartsOn));
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

export async function createReportSchedule(
  workspaceId: string,
  input: z.infer<typeof reportScheduleSchema>,
  createdById: string | null = null,
) {
  const [workspace, target] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true, weekStartsOn: true } }),
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
      aiRecap: input.aiRecap ?? false,
      createdById,
      nextRunAt: nextReportRun(input.frequency, new Date(), workspace.timezone, workspace.weekStartsOn),
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
    include: {
      workspace: { select: { id: true, name: true, timezone: true, defaultLocale: true, weekStartsOn: true, aiEnabled: true } },
    },
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
      const period = reportPeriod(frequency, schedule.nextRunAt, timeZone, schedule.workspace.weekStartsOn);
      const report = await buildReport({
        workspaceId: schedule.workspaceId,
        timezone: timeZone,
        from: period.from,
        to: period.to,
        targetIds: [target.id],
      });
      const periodLabel = `${formatInZone(period.from, timeZone, 'd MMM')} – ${formatInZone(period.to, timeZone, 'd MMM yyyy')}`;
      const recap =
        schedule.aiRecap && schedule.workspace.aiEnabled && aiAvailable()
          ? await recapFor({ schedule, pageName: target.name, periodLabel, report, period })
          : null;
      const email = scheduledReportEmail({
        locale: schedule.workspace.defaultLocale,
        workspace: schedule.workspace.name,
        page: target.name,
        frequency,
        period: periodLabel,
        followers: target.followersCount ?? target.fanCount ?? null,
        report,
        recap,
      });
      const outcomes = await Promise.all(
        schedule.recipients.map((to) =>
          sendEmail({ to, ...email, template: 'scheduledReport', workspaceId: schedule.workspaceId }),
        ),
      );
      const bad = outcomes.find((outcome) => outcome.status === 'failed');
      if (bad) lastError = bad.error ?? 'Sending failed.';
      else
        await emitWebhook(schedule.workspaceId, 'report.ready', {
          reportScheduleId: schedule.id,
          pageId: target.id,
          pageName: target.name,
          frequency,
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          recipients: schedule.recipients.length,
        }, now);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        lastError,
        nextRunAt: nextReportRun(frequency, now, timeZone, schedule.workspace.weekStartsOn),
      },
    });
    if (lastError) failed += 1;
    else sent += 1;
  }
  return { sent, failed };
}

/** After the workspace changes its first day of the week: weekly reports move to it. */
export async function rescheduleWeeklyReports(workspaceId: string, now: Date = new Date()): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { timezone: true, weekStartsOn: true },
  });
  await prisma.reportSchedule.updateMany({
    where: { workspaceId, frequency: 'weekly' },
    data: { nextRunAt: nextReportRun('weekly', now, workspace.timezone, workspace.weekStartsOn) },
  });
}

function recapFigures(report: Awaited<ReturnType<typeof buildReport>>): RecapFigures {
  return {
    posts: report.postsPublished,
    reach: report.totals.reach,
    engagement: report.totals.engagement,
    topPosts: report.topPosts.slice(0, 3).map((post) => ({
      text: post.message.replace(/\s+/g, ' ').trim().slice(0, 140),
      engagement: post.engagement,
    })),
  };
}

/**
 * The AI recap, or null: the report goes out without it rather than not at
 * all when the provider fails, the budget is spent or nobody can be billed.
 */
async function recapFor(options: {
  schedule: { id: string; workspaceId: string; targetId: string; createdById: string | null; workspace: { timezone: string; defaultLocale: Locale } };
  pageName: string;
  periodLabel: string;
  report: Awaited<ReturnType<typeof buildReport>>;
  period: { from: Date; to: Date };
}): Promise<string | null> {
  const { schedule } = options;
  try {
    const length = options.period.to.getTime() - options.period.from.getTime();
    const previous = await buildReport({
      workspaceId: schedule.workspaceId,
      timezone: schedule.workspace.timezone,
      from: new Date(options.period.from.getTime() - length),
      to: options.period.from,
      targetIds: [schedule.targetId],
    });
    // Counted against whoever set the schedule up, or the workspace owner.
    const userId =
      (schedule.createdById &&
        (await prisma.membership.findFirst({ where: { workspaceId: schedule.workspaceId, userId: schedule.createdById } }))?.userId) ||
      (await prisma.membership.findFirst({ where: { workspaceId: schedule.workspaceId, role: WorkspaceRole.owner }, orderBy: { createdAt: 'asc' } }))
        ?.userId;
    if (!userId) return null;
    return await writeReportRecap({
      workspaceId: schedule.workspaceId,
      userId,
      pageName: options.pageName,
      periodLabel: options.periodLabel,
      current: recapFigures(options.report),
      previous: recapFigures(previous),
      locale: schedule.workspace.defaultLocale,
    });
  } catch (error) {
    console.error(`[reports] recap for schedule ${schedule.id} failed`, error);
    return null;
  }
}
