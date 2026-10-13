import { parseInsights } from './json';
import { prisma } from './prisma';

/**
 * Results by label, for campaigns: a label groups posts across Pages and
 * dates, and this adds up what those posts did in a period.
 *
 * Reach is summed per destination, so the same person reached on two Pages
 * counts twice: it is what the posts reached in total, not unique people.
 */

export interface LabelTotals {
  labelId: string;
  name: string;
  color: string;
  posts: number;
  reach: number;
  interactions: number;
  clicks: number;
}

export async function readLabelTotals(options: { workspaceId: string; targetIds: string[]; from: Date; to: Date }): Promise<LabelTotals[]> {
  const rows = await prisma.postTarget.findMany({
    where: {
      targetId: { in: options.targetIds },
      status: 'published',
      publishedAt: { gte: options.from, lte: options.to },
      post: { workspaceId: options.workspaceId, labels: { some: {} } },
    },
    select: { postId: true, insights: true, post: { select: { labels: { select: { label: { select: { id: true, name: true, color: true } } } } } } },
  });

  const totals = new Map<string, LabelTotals & { postIds: Set<string> }>();
  for (const row of rows) {
    const insights = parseInsights(row.insights);
    const interactions = (insights?.reactions ?? 0) + (insights?.comments ?? 0) + (insights?.shares ?? 0);
    for (const { label } of row.post.labels) {
      const entry = totals.get(label.id) ?? { labelId: label.id, name: label.name, color: label.color, posts: 0, reach: 0, interactions: 0, clicks: 0, postIds: new Set<string>() };
      entry.postIds.add(row.postId);
      entry.reach += insights?.reach ?? 0;
      entry.interactions += interactions;
      entry.clicks += insights?.clicks ?? 0;
      totals.set(label.id, entry);
    }
  }
  return [...totals.values()]
    .map(({ postIds, ...entry }) => ({ ...entry, posts: postIds.size }))
    .sort((a, b) => b.interactions - a.interactions || a.name.localeCompare(b.name));
}
