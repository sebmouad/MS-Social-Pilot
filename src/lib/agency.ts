/**
 * Agency overview for root: every workspace's health in one
 * table. Read from what is stored — no Graph calls.
 */
import { PostStatus, TargetType } from '@prisma/client';

import { PAGE_TOTAL_METRICS, totalsOf } from './page-analysis-data';
import { prisma } from './prisma';

export const AGENCY_WINDOW_DAYS = 30;

export const AGENCY_COLUMNS = ['name', 'pages', 'disconnected', 'scheduled', 'failed', 'followers', 'engagements', 'aiSpend'] as const;
export type AgencyColumn = (typeof AGENCY_COLUMNS)[number];

export interface AgencyRow {
  id: string;
  name: string;
  suspended: boolean;
  pages: number;
  /** Switched-on Pages that cannot publish: token gone or Facebook refusing. */
  disconnected: number;
  scheduled: number;
  /** Posts that failed, fully or on some Pages, in the window. */
  failed: number;
  /** New followers minus unfollows over the window; null without insights. */
  followers: number | null;
  engagements: number | null;
  /** US dollars; null when no priced AI call was made. */
  aiSpend: number | null;
}

const sum = (values: Array<number | null>) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};

export async function agencyOverview(now: Date = new Date()): Promise<AgencyRow[]> {
  const from = new Date(now.getTime() - AGENCY_WINDOW_DAYS * 86_400_000);
  const [workspaces, targets, scheduled, failed, ai] = await Promise.all([
    prisma.workspace.findMany({ select: { id: true, name: true, suspendedAt: true }, orderBy: { name: 'asc' } }),
    prisma.target.findMany({ select: { id: true, workspaceId: true, type: true, enabled: true, canPublish: true, accessToken: true } }),
    prisma.post.groupBy({ by: ['workspaceId'], where: { status: PostStatus.scheduled }, _count: true }),
    prisma.post.groupBy({
      by: ['workspaceId'],
      where: { status: { in: [PostStatus.failed, PostStatus.partially_failed] }, updatedAt: { gte: from } },
      _count: true,
    }),
    prisma.aiGeneration.groupBy({ by: ['workspaceId'], where: { createdAt: { gte: from } }, _sum: { costUsd: true } }),
  ]);

  const pageIds = targets.filter((target) => target.type === TargetType.page).map((target) => target.id);
  const insights = pageIds.length
    ? await prisma.pageInsight.findMany({
        where: { targetId: { in: pageIds }, period: 'day', metric: { in: PAGE_TOTAL_METRICS }, endTime: { gt: from, lte: now } },
        select: { targetId: true, metric: true, endTime: true, numeric: true },
      })
    : [];
  const rowsByTarget = new Map<string, typeof insights>();
  for (const row of insights) {
    const list = rowsByTarget.get(row.targetId);
    if (list) list.push(row);
    else rowsByTarget.set(row.targetId, [row]);
  }

  const countOf = (rows: Array<{ workspaceId: string; _count: number }>, id: string) => rows.find((row) => row.workspaceId === id)?._count ?? 0;

  return workspaces.map((workspace) => {
    const own = targets.filter((target) => target.workspaceId === workspace.id);
    const totals = own
      .filter((target) => target.type === TargetType.page)
      .map((target) => totalsOf(rowsByTarget.get(target.id) ?? [], { from, to: now }));
    return {
      id: workspace.id,
      name: workspace.name,
      suspended: workspace.suspendedAt !== null,
      pages: own.length,
      disconnected: own.filter((target) => target.enabled && (!target.accessToken || !target.canPublish)).length,
      scheduled: countOf(scheduled, workspace.id),
      failed: countOf(failed, workspace.id),
      followers: sum(totals.map((total) => (total.follows === null && total.unfollows === null ? null : (total.follows ?? 0) - (total.unfollows ?? 0)))),
      engagements: sum(totals.map((total) => total.engagements)),
      aiSpend: ai.find((row) => row.workspaceId === workspace.id)?._sum.costUsd ?? null,
    };
  });
}

/** Sort for the table; unknown values (null) always last. */
export function sortAgency(rows: AgencyRow[], column: AgencyColumn, order: 'asc' | 'desc'): AgencyRow[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (column === 'name') return a.name.localeCompare(b.name) * direction;
    const left = a[column];
    const right = b[column];
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * direction || a.name.localeCompare(b.name);
  });
}
