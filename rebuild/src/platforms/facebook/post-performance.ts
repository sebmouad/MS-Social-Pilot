import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import type { PostPerformance, PostPerformanceRequest } from '@/server/platforms/host';

/**
 * Facebook per-post measures from the insights snapshot the legacy sync stores on each published post target.
 * Engagement is reactions + comments + shares (the legacy report's definition); a post with none of the three
 * stored has unknown engagement, not zero. Reads stored data only.
 */
const MEASURES: Array<[key: string, label: string]> = [
  ['impressions', 'Impressions'], ['reach', 'Reach'], ['reactions', 'Reactions'], ['comments', 'Comments'], ['shares', 'Shares'], ['clicks', 'Clicks'],
];

type Row = { postId: string; message: string; publishedAt: Date | null; remoteUrl: string | null; insights: unknown; insightsSyncedAt: Date | null };

const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function facebookPostPerformance(row: Row): PostPerformance {
  const insights = row.insights && typeof row.insights === 'object' && !Array.isArray(row.insights) ? row.insights as Record<string, unknown> : {};
  const french: Record<string, string> = { impressions: 'Impressions', reach: 'Portée', reactions: 'Réactions', comments: 'Commentaires', shares: 'Partages', clicks: 'Clics' };
  const extra = Object.keys(insights).filter(key => !MEASURES.some(([known]) => known === key) && num(insights[key]) !== null).map(key => [key, key] as [string, string]);
  const measures = [...MEASURES, ...extra].map(([key, label]) => ({ key, label, labelFr: french[key], value: num(insights[key]) }));
  const parts = ['reactions', 'comments', 'shares'].map(key => num(insights[key]));
  const rankValue = parts.every(part => part === null) ? null : parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
  const url = typeof row.remoteUrl === 'string' && /^https:\/\//.test(row.remoteUrl) ? row.remoteUrl : null;
  return { postId: row.postId, text: row.message, publishedAt: row.publishedAt, url, measures, rankValue, rankLabel: 'Engagement', measuredAt: row.insightsSyncedAt };
}

export async function readFacebookPostPerformance(request: PostPerformanceRequest): Promise<PostPerformance[]> {
  if (request.sort !== undefined) {
    const key = request.sort;
    const direction = request.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const value = key === 'publishedAt' ? Prisma.sql`EXTRACT(EPOCH FROM pt."publishedAt")` : Prisma.sql`CASE WHEN jsonb_typeof(pt.insights::jsonb -> ${key}) = 'number' THEN CASE WHEN (pt.insights::jsonb ->> ${key})::numeric >= 0 THEN (pt.insights::jsonb ->> ${key})::numeric END END`;
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.id AS "postId", p.message, pt."publishedAt", pt."remoteUrl", pt.insights, pt."insightsSyncedAt"
      FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
      WHERE pt."targetId" = ${request.targetId} AND t."workspaceId" = ${request.workspaceId} AND p."workspaceId" = ${request.workspaceId}
        AND pt.status = 'published' AND pt."publishedAt" >= ${request.from} AND pt."publishedAt" < ${request.to}
      ORDER BY ${value} ${direction} NULLS LAST, p.id ASC
      LIMIT ${request.limit} OFFSET ${request.offset ?? 0}`);
    return rows.map(facebookPostPerformance);
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(request.limit)));
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id AS "postId", p.message, pt."publishedAt", pt."remoteUrl", pt.insights, pt."insightsSyncedAt"
    FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
    WHERE pt."targetId" = ${request.targetId} AND t."workspaceId" = ${request.workspaceId} AND p."workspaceId" = ${request.workspaceId}
      AND pt.status = 'published' AND pt."publishedAt" >= ${request.from} AND pt."publishedAt" < ${request.to}
    ORDER BY pt."publishedAt" DESC
    LIMIT 2000`;
  return rows.map(facebookPostPerformance)
    .sort((a, b) => (b.rankValue ?? -1) - (a.rankValue ?? -1) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, limit);
}
