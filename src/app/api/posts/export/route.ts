import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { postStatusFilter } from '@/lib/constants';
import { toCsv } from '@/lib/csv';
import { parseInsights } from '@/lib/json';
import { loadPageFilter } from '@/lib/page-filter';
import { listLabels } from '@/lib/page-groups';
import { prisma } from '@/lib/prisma';
import { route } from '@/lib/api';
import { formatInZone } from '@/lib/time';

/**
 * The post list as a spreadsheet: the same filters as the screen — status,
 * search, Page, label, sidebar — so what downloads is what was on screen.
 */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const statuses = postStatusFilter(params.status);
  const search = (params.q ?? '').trim().slice(0, 200);
  const [filter, labels] = await Promise.all([loadPageFilter(auth, params), listLabels(auth.workspace.id)]);
  const activeLabel = labels.find((label) => label.id === params.label) ?? null;
  const labelName = new Map(labels.map((label) => [label.id, label.name]));

  const where: Prisma.PostWhereInput = {
    workspaceId: auth.workspace.id,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(search ? { message: { contains: search, mode: 'insensitive' } } : {}),
    ...(params.target ? { targets: { some: { targetId: params.target } } } : {}),
    ...(activeLabel ? { labels: { some: { labelId: activeLabel.id } } } : {}),
    ...(Object.keys(filter.postWhere).length ? { AND: [filter.postWhere] } : {}),
  };
  const posts = await prisma.post.findMany({
    where,
    include: {
      targets: { include: { target: { select: { name: true } } } },
      author: { select: { name: true } },
      labels: { select: { labelId: true } },
    },
    orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 5000,
  });

  const zone = auth.workspace.timezone;
  const when = (date: Date | null) => (date ? formatInZone(date, zone, 'yyyy-MM-dd HH:mm') : '');
  const rows: unknown[][] = [
    ['id', 'status', 'format', 'scheduled_at', 'published_at', 'pages', 'labels', 'author', 'message', 'link', 'first_comment', 'urls', 'reach', 'reactions', 'comments', 'shares'],
    ...posts.map((post) => {
      const totals = { reach: 0, reactions: 0, comments: 0, shares: 0 };
      for (const row of post.targets) {
        const insights = parseInsights(row.insights);
        totals.reach += insights?.reach ?? 0;
        totals.reactions += insights?.reactions ?? 0;
        totals.comments += insights?.comments ?? 0;
        totals.shares += insights?.shares ?? 0;
      }
      return [
        post.id,
        post.status,
        post.format,
        when(post.scheduledAt),
        when(post.publishedAt),
        post.targets.map((row) => row.target.name).join(' | '),
        post.labels.map((row) => labelName.get(row.labelId) ?? '').filter(Boolean).join(' | '),
        post.author.name,
        post.message,
        post.link ?? '',
        post.firstComment ?? '',
        post.targets.map((row) => row.remoteUrl).filter(Boolean).join(' '),
        totals.reach,
        totals.reactions,
        totals.comments,
        totals.shares,
      ];
    }),
  ];

  const day = formatInZone(new Date(), zone, 'yyyy-MM-dd');
  return new NextResponse(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="posts-${auth.workspace.slug}-${day}.csv"`,
    },
  });
});
