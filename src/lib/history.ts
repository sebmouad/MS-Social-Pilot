import { prisma } from './prisma';
import { settingNumber } from './settings';

/**
 * What happened in this workspace, and what was emailed about it.
 *
 * Both tables have been written faithfully since the beginning and read by
 * nothing except the sweeper that deletes them. That is a strange state for an
 * audit trail to be in — most of the time it costs only a little disk, but two
 * cases make it matter:
 *
 * - Deleting a comment on a client's Page is irreversible and invisible
 *   afterwards, so the author, the text and who removed it are recorded here
 *   *because Facebook keeps none of it*. That is the one copy there is.
 * - Email failures are quiet by design — a workspace whose Resend domain was
 *   never verified sends nothing and is told nothing. The log is the only place
 *   that says so.
 */

export interface ActivityRow {
  id: string;
  action: string;
  actorName: string | null;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

export interface EmailRow {
  id: string;
  to: string;
  subject: string;
  template: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

/** How long each table is kept, so the screen can explain an empty tail. */
export function historyRetention(): { activityDays: number; emailDays: number } {
  return {
    activityDays: settingNumber('retention.activityDays'),
    emailDays: settingNumber('retention.emailDays'),
  };
}

export async function readActivity(options: {
  workspaceId: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  const rows = await prisma.activityLog.findMany({
    where: { workspaceId: options.workspaceId },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 100,
  });

  // `actorId` is a bare column rather than a relation, because an entry has to
  // outlive the person: someone who leaves the agency still did the thing.
  // So the name is looked up separately and may legitimately not be there.
  const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(actors.map((actor) => [actor.id, actor.name]));

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorName: row.actorId ? names.get(row.actorId) ?? null : null,
    detail:
      row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : null,
    createdAt: row.createdAt,
  }));
}

export async function readEmailLog(options: {
  workspaceId: string;
  limit?: number;
  failuresOnly?: boolean;
}): Promise<EmailRow[]> {
  const rows = await prisma.emailLog.findMany({
    where: {
      workspaceId: options.workspaceId,
      ...(options.failuresOnly ? { status: { not: 'sent' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 100,
  });

  return rows.map((row) => ({
    id: row.id,
    to: row.to,
    subject: row.subject,
    template: row.template,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
  }));
}

/** How many emails failed recently, for the badge that says "look at this". */
export async function countRecentEmailFailures(options: {
  workspaceId: string;
  since: Date;
}): Promise<number> {
  return prisma.emailLog.count({
    where: {
      workspaceId: options.workspaceId,
      status: { not: 'sent' },
      createdAt: { gte: options.since },
    },
  });
}
