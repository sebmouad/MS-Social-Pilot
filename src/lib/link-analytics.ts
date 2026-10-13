import { Prisma } from '@prisma/client';

import { parseInsights } from './json';
import { prisma } from './prisma';

/**
 * Short-link click analytics: clicks per day, Page, post
 * and article, from the clicks the shortener already records. Database only.
 *
 * Each link counts for one Page: the one it went out on, or — for links made
 * before Pages were recorded on them — its post's first Page.
 */

export interface LinkClickReport {
  total: number;
  byDay: Array<{ day: string; clicks: number }>;
  byPage: Array<{ targetId: string; name: string; clicks: number }>;
  byArticle: Array<{ url: string; clicks: number }>;
  byPost: Array<{ postId: string; postTargetId: string | null; message: string; clicks: number; views: number; perThousand: number | null }>;
}

/** The address without tracking tags, so one article is one row whatever the campaign. */
export function articleUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key === 'fbclid') parsed.searchParams.delete(key);
    }
    parsed.hash = '';
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function loadLinkClicks(options: {
  workspaceId: string;
  from: Date;
  to: Date;
  timezone: string;
  /** The Pages to count; null for every Page (and links on none). */
  targetIds: string[] | null;
}): Promise<LinkClickReport> {
  const rows = await prisma.$queryRaw<Array<{ shortLinkId: string; day: string; clicks: bigint }>>`
    SELECT c."shortLinkId", to_char((c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${options.timezone}, 'YYYY-MM-DD') AS day, count(*) AS clicks
    FROM link_clicks c
    JOIN short_links l ON l.id = c."shortLinkId"
    WHERE l."workspaceId" = ${options.workspaceId}
      AND c."createdAt" >= ${options.from} AND c."createdAt" < ${options.to}
    GROUP BY 1, 2
  `;
  const linkIds = [...new Set(rows.map((row) => row.shortLinkId))];
  const links = linkIds.length
    ? await prisma.shortLink.findMany({
        where: { id: { in: linkIds } },
        select: {
          id: true,
          targetUrl: true,
          postId: true,
          target: { select: { id: true, name: true } },
          post: {
            select: {
              message: true,
              targets: { orderBy: { id: 'asc' }, select: { targetId: true, target: { select: { name: true } } } },
            },
          },
        },
      })
    : [];

  const pageOf = new Map(
    links.map((link) => {
      const fallback = link.post?.targets[0];
      const page = link.target ?? (fallback ? { id: fallback.targetId, name: fallback.target.name } : null);
      return [link.id, { link, page }];
    }),
  );
  const wanted = options.targetIds ? new Set(options.targetIds) : null;
  const counted = rows.filter((row) => {
    const page = pageOf.get(row.shortLinkId)?.page;
    return wanted ? Boolean(page && wanted.has(page.id)) : true;
  });

  const add = <K>(map: Map<K, number>, key: K, value: number) => map.set(key, (map.get(key) ?? 0) + value);
  const byDay = new Map<string, number>();
  const byPage = new Map<string, number>();
  const pageNames = new Map<string, string>();
  const byArticle = new Map<string, number>();
  const byPost = new Map<string, number>();
  let total = 0;
  for (const row of counted) {
    const clicks = Number(row.clicks);
    const { link, page } = pageOf.get(row.shortLinkId)!;
    total += clicks;
    add(byDay, row.day, clicks);
    if (page) {
      add(byPage, page.id, clicks);
      pageNames.set(page.id, page.name);
    }
    add(byArticle, articleUrl(link.targetUrl), clicks);
    if (link.postId) add(byPost, link.postId, clicks);
  }

  // Views of the posts on the Pages counted, for clicks per 1,000 views.
  const postIds = [...byPost.keys()];
  const destinations = postIds.length
    ? await prisma.postTarget.findMany({
        where: { postId: { in: postIds }, ...(wanted ? { targetId: { in: [...wanted] } } : {}) },
        orderBy: { id: 'asc' },
        select: { id: true, postId: true, insights: true },
      })
    : [];
  const views = new Map<string, number>();
  const firstDestination = new Map<string, string>();
  for (const destination of destinations) {
    if (!firstDestination.has(destination.postId)) firstDestination.set(destination.postId, destination.id);
    const insights = destination.insights ? parseInsights(destination.insights as Prisma.JsonValue) : null;
    add(views, destination.postId, insights?.impressions ?? 0);
  }
  const messages = new Map(links.filter((link) => link.postId).map((link) => [link.postId!, link.post?.message ?? '']));

  const sorted = <K>(map: Map<K, number>) => [...map].sort((a, b) => b[1] - a[1]);
  return {
    total,
    byDay: [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, clicks]) => ({ day, clicks })),
    byPage: sorted(byPage).map(([targetId, clicks]) => ({ targetId, name: pageNames.get(targetId) ?? '', clicks })),
    byArticle: sorted(byArticle).slice(0, 20).map(([url, clicks]) => ({ url, clicks })),
    byPost: sorted(byPost)
      .slice(0, 20)
      .map(([postId, clicks]) => {
        const seen = views.get(postId) ?? 0;
        return {
          postId,
          postTargetId: firstDestination.get(postId) ?? null,
          message: messages.get(postId) ?? '', clicks, views: seen, perThousand: seen > 0 ? (clicks / seen) * 1000 : null };
      }),
  };
}
