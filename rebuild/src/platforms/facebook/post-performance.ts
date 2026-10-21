import { runtimeConfig } from '@/server/config/store';
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
  const key = request.sort ?? 'engagement';
  const direction = request.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const value = key === 'publishedAt' ? Prisma.sql`EXTRACT(EPOCH FROM r."publishedAt")` : key === 'engagement' ? Prisma.sql`(SELECT SUM((v #>> '{}')::numeric) FROM jsonb_each(COALESCE(r.insights::jsonb, '{}'::jsonb)) e(k,v) WHERE k IN ('reactions','comments','shares') AND jsonb_typeof(v) = 'number')` : Prisma.sql`CASE WHEN jsonb_typeof(r.insights::jsonb -> ${key}) = 'number' THEN (r.insights::jsonb ->> ${key})::numeric END`;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT * FROM (
      SELECT p.id AS "postId", p.message, pt."publishedAt", COALESCE(pt."remoteUrl", ep.permalink) AS "remoteUrl",
        CASE WHEN pt."insightsSyncedAt" IS NULL AND ep."insightsSyncedAt" IS NOT NULL THEN ep.insights ELSE pt.insights END AS insights,
        COALESCE(pt."insightsSyncedAt", ep."insightsSyncedAt") AS "insightsSyncedAt"
      FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
      -- Post history stores current insights on the synced remote copy of an app-published post.
      LEFT JOIN external_posts ep ON ep."targetId" = pt."targetId" AND ep."remoteId" = pt."remotePostId"
      WHERE t.id = ${request.targetId} AND t."workspaceId" = ${request.workspaceId} AND p."workspaceId" = ${request.workspaceId}
        AND pt.status = 'published' AND pt."publishedAt" >= ${request.from} AND pt."publishedAt" < ${request.to}
      UNION ALL
      SELECT ep.id AS "postId", COALESCE(ep.message, '') AS message, ep."createdTime" AS "publishedAt", ep.permalink AS "remoteUrl", ep.insights, ep."insightsSyncedAt"
      FROM external_posts ep JOIN targets t ON t.id = ep."targetId"
      WHERE t.id = ${request.targetId} AND t."workspaceId" = ${request.workspaceId}
        AND ep."createdTime" >= ${request.from} AND ep."createdTime" < ${request.to}
        AND NOT EXISTS (SELECT 1 FROM post_targets pt JOIN posts p ON p.id = pt."postId" WHERE pt."targetId" = t.id AND p."workspaceId" = t."workspaceId" AND pt."remotePostId" = ep."remoteId" AND pt.status = 'published')
    ) r ORDER BY ${value} ${direction} NULLS LAST, r."postId" ASC LIMIT ${request.limit} OFFSET ${request.offset ?? 0}`);
  const labels = await runtimeConfig('meta.metricLabels') as Record<string, { en: string; fr: string }>;
  return rows.map(row => { const result = facebookPostPerformance(row); result.measures = result.measures.map(measure => ({ ...measure, ...(labels[measure.key] ? { label: labels[measure.key].en, labelFr: labels[measure.key].fr } : {}) })); return result; });
}
