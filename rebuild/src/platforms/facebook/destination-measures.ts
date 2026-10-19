import { prisma } from '@/server/data';
import type { DestinationMeasures } from '@/server/platforms/host';

/**
 * Facebook per-destination totals from the insights snapshot stored on each published post target (the legacy
 * report's per-destination table). A measure no post has stored is unknown (null), never zero; `measuredPosts`
 * shows how many posts the sum is based on. Reads stored data only.
 */
const MEASURES: Array<[key: string, label: string]> = [
  ['impressions', 'Impressions'], ['reach', 'Reach (sum per post; people may repeat)'], ['reactions', 'Reactions'], ['comments', 'Comments'], ['shares', 'Shares'],
];
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function facebookDestinationMeasures(insightRows: unknown[]): DestinationMeasures {
  const objects = insightRows.map(row => row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {});
  return { measures: MEASURES.map(([key, label]) => {
    const values = objects.map(row => num(row[key])).filter((value): value is number => value !== null);
    return { key, label, value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, measuredPosts: values.length };
  }) };
}

export async function readFacebookDestinationMeasures(request: { workspaceId: string; targetId: string; from: Date; to: Date }): Promise<DestinationMeasures> {
  const rows = await prisma.$queryRaw<Array<{ insights: unknown }>>`
    SELECT pt.insights
    FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
    WHERE pt."targetId" = ${request.targetId} AND t."workspaceId" = ${request.workspaceId} AND p."workspaceId" = ${request.workspaceId}
      AND pt.status = 'published' AND pt."publishedAt" >= ${request.from} AND pt."publishedAt" < ${request.to}
    LIMIT 20000`;
  return facebookDestinationMeasures(rows.map(row => row.insights));
}
