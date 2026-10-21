import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { PUBLICATION_REPORT_POLICY_SCHEMA } from '../config';
import type { ReportPeriod } from '../contracts';

export type PublicationRecord = { postId: string; text: string; at: Date; attempts: number };
export type PublicationDistribution = { dimension: 'weekday' | 'hour' | 'attempts'; bucket: number; published: number; ceiling: boolean };
export type PublicationReport = {
  distributions?: PublicationDistribution[];
  published: PublicationRecord[]; failed: PublicationRecord[];
  days: Array<{ day: string; published: number }>;
  publishedTruncated: boolean; failedTruncated: boolean;
};

/** Called only after the generator's current report/channel authorization. Reads
 * neutral local publication state, never provider errors or other destinations.
 * Failures describe currently failed destinations updated in the period, not an
 * immutable history of failed attempts. Daily counts are independent of log limits. Prisma publication timestamps are
 * UTC TIMESTAMP(3) without time zone; format them directly to avoid the database
 * session timezone shifting a publication into a different day.
 */
export async function readPublicationReport(workspaceId: string, channelId: string, period: ReportPeriod): Promise<PublicationReport> {
  const policy = PUBLICATION_REPORT_POLICY_SCHEMA.parse(await runtimeConfig('analytics.reports.publicationDetails'));
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(`${period.end}T00:00:00.000Z`); to.setUTCDate(to.getUTCDate() + 1);
  const [published, failed, days, distributionRows] = await Promise.all([
    prisma.$queryRaw<PublicationRecord[]>`
      SELECT p.id AS "postId", left(COALESCE(pt."messageOverride", p.message), ${policy.excerptCharacters}) AS text,
        pt."publishedAt" AS at, pt.attempts
      FROM post_targets pt JOIN posts p ON p.id = pt."postId"
      JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
      WHERE p."workspaceId" = ${workspaceId} AND pt."targetId" = ${channelId}
        AND pt.status = 'published' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}
      ORDER BY pt."publishedAt" DESC, p.id ASC LIMIT ${policy.publishedRows + 1}`,
    prisma.$queryRaw<PublicationRecord[]>`
      SELECT p.id AS "postId", left(COALESCE(pt."messageOverride", p.message), ${policy.excerptCharacters}) AS text,
        pt."updatedAt" AS at, pt.attempts
      FROM post_targets pt JOIN posts p ON p.id = pt."postId"
      JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
      WHERE p."workspaceId" = ${workspaceId} AND pt."targetId" = ${channelId}
        AND pt.status = 'failed' AND pt."updatedAt" >= ${from} AND pt."updatedAt" < ${to}
      ORDER BY pt."updatedAt" DESC, p.id ASC LIMIT ${policy.failedRows + 1}`,
    prisma.$queryRaw<Array<{ day: string; published: bigint | number }>>`
      SELECT to_char(pt."publishedAt", 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS published
      FROM post_targets pt JOIN posts p ON p.id = pt."postId"
      JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
      WHERE p."workspaceId" = ${workspaceId} AND pt."targetId" = ${channelId}
        AND pt.status = 'published' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}
      GROUP BY day ORDER BY day ASC`,
    policy.weekdayBreakdown || policy.hourlyBreakdown || policy.attemptBreakdown
      ? prisma.$queryRaw<Array<{ dimension: PublicationDistribution['dimension']; bucket: number; published: bigint | number }>>`
      WITH publications AS (
        SELECT pt."publishedAt", pt.attempts
        FROM post_targets pt JOIN posts p ON p.id = pt."postId"
        JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
        WHERE p."workspaceId" = ${workspaceId} AND pt."targetId" = ${channelId}
          AND pt.status = 'published' AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}
      ), buckets AS (
        SELECT 'weekday' AS dimension, EXTRACT(ISODOW FROM "publishedAt")::integer AS bucket
          FROM publications WHERE ${policy.weekdayBreakdown}
        UNION ALL
        SELECT 'hour', EXTRACT(HOUR FROM "publishedAt")::integer FROM publications WHERE ${policy.hourlyBreakdown}
        UNION ALL
        SELECT 'attempts', LEAST(attempts, ${policy.attemptBucketCeiling}) FROM publications
          WHERE ${policy.attemptBreakdown} AND attempts >= 0
      ) SELECT dimension, bucket, COUNT(*)::bigint AS published FROM buckets
        GROUP BY dimension, bucket ORDER BY dimension ASC, bucket ASC`
      : Promise.resolve([]),
  ]);
  const distributions = (distributionRows ?? []).map(row => ({ ...row, published: Number(row.published),
    ceiling: row.dimension === 'attempts' && row.bucket === policy.attemptBucketCeiling }));
  return { ...(distributions.length ? { distributions } : {}), published: published.slice(0, policy.publishedRows), failed: failed.slice(0, policy.failedRows),
    days: days.map(row => ({ day: row.day, published: Number(row.published) })),
    publishedTruncated: published.length > policy.publishedRows, failedTruncated: failed.length > policy.failedRows };
}
