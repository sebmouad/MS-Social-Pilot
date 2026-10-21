import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { LINK_REPORT_POLICY_SCHEMA } from '../config';
import type { ReportPeriod } from '../contracts';

export type LinkReport = {
  links: Array<{ id: string; postId: string; lifetime: number; period: number }>;
  days: Array<{ day: string; clicks: number }>;
  linksTruncated: boolean; daysTruncated: boolean;
};

/** Internal reader: the report generator authorizes the current actor/channel first.
 * One statement provides a consistent cohort: links on posts published to this
 * channel during the report period. Unattributed links qualify only when their
 * post has exactly one currently published destination. No visitor metadata,
 * destination URLs, slugs or other channels' identities are projected.
 */
export async function readLinkReport(workspaceId: string, channelId: string, period: ReportPeriod): Promise<LinkReport> {
  const policy = LINK_REPORT_POLICY_SCHEMA.parse(await runtimeConfig('analytics.reports.linkDetails'));
  const from = new Date(`${period.start}T00:00:00.000Z`);
  const to = new Date(`${period.end}T00:00:00.000Z`); to.setUTCDate(to.getUTCDate() + 1);
  const rows = await prisma.$queryRaw<Array<{ links: LinkReport['links']; days: LinkReport['days'] }>>`
    WITH cohort AS (
      SELECT sl.id, sl."postId", sl."clickCount" AS lifetime
      FROM short_links sl JOIN posts p ON p.id = sl."postId" AND p."workspaceId" = sl."workspaceId"
      JOIN post_targets pt ON pt."postId" = p.id AND pt."targetId" = ${channelId}
      JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
      WHERE sl."workspaceId" = ${workspaceId} AND pt.status = 'published'
        AND pt."publishedAt" >= ${from} AND pt."publishedAt" < ${to}
        AND (sl."targetId" = ${channelId} OR (sl."targetId" IS NULL AND
          (SELECT COUNT(DISTINCT other."targetId") FROM post_targets other
           WHERE other."postId" = p.id AND other.status = 'published') = 1))
    ), period_clicks AS (
      SELECT lc."shortLinkId", lc."createdAt" FROM link_clicks lc JOIN cohort c ON c.id = lc."shortLinkId"
      WHERE lc."createdAt" >= ${from} AND lc."createdAt" < ${to}
    ), inventory AS (
      SELECT c.id, c."postId", c.lifetime, COUNT(pc."shortLinkId")::integer AS period
      FROM cohort c LEFT JOIN period_clicks pc ON pc."shortLinkId" = c.id
      GROUP BY c.id, c."postId", c.lifetime ORDER BY c.lifetime DESC, c.id ASC LIMIT ${policy.links + 1}
    ), daily AS (
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, COUNT(*)::integer AS clicks
      FROM period_clicks GROUP BY day ORDER BY day ASC LIMIT ${policy.days + 1}
    ) SELECT COALESCE((SELECT jsonb_agg(i ORDER BY i.lifetime DESC, i.id ASC) FROM inventory i), '[]'::jsonb) AS links,
      COALESCE((SELECT jsonb_agg(d ORDER BY d.day ASC) FROM daily d), '[]'::jsonb) AS days`;
  const { links = [], days = [] } = rows[0] ?? {};
  return { links: links.slice(0, policy.links), days: days.slice(0, policy.days),
    linksTruncated: links.length > policy.links, daysTruncated: days.length > policy.days };
}
