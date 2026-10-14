import type { PageScope } from './page-access';
import { targetScope } from './page-access';
import { prisma } from './prisma';
import { parseInsights } from './json';
import { NETWORK_KEYS, type NetworkKey } from './networks/types';

export interface NetworkPostRow {
  id: string;
  network: NetworkKey;
  channel: string;
  message: string;
  publishedAt: Date;
  url: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  views: number | null;
  metrics?: Record<string, number | Record<string, number>>;
}

export interface NetworkTotal {
  network: NetworkKey;
  posts: number;
  /** Null when no post on this network has counters yet. */
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  views: number | null;
}

/** Totals per network, in the order the rows name them; a counter no post has stays null. */
export function totalsByNetwork(rows: NetworkPostRow[]): NetworkTotal[] {
  const totals = new Map<NetworkKey, NetworkTotal>();
  const add = (sum: number | null, value: number | null) => (value === null ? sum : (sum ?? 0) + value);
  for (const row of rows) {
    const total = totals.get(row.network) ?? { network: row.network, posts: 0, likes: null, reposts: null, replies: null, views: null };
    total.posts += 1;
    total.likes = add(total.likes, row.likes);
    total.reposts = add(total.reposts, row.reposts);
    total.replies = add(total.replies, row.replies);
    total.views = add(total.views, row.views);
    totals.set(row.network, total);
  }
  return [...totals.values()];
}

/** Posts published to the other networks in the window, for the selected channels. */
export async function readNetworkPosts(options: { workspaceId: string; scope: PageScope; from: Date; to: Date }): Promise<NetworkPostRow[]> {
  // Channel totals and the post explorer share this reader. A single `take`
  // silently understated both once a busy selection crossed that threshold.
  const rows: NetworkPostRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.postTarget.findMany({
      where: {
        status: 'published',
        publishedAt: { gte: options.from, lt: options.to },
        target: { workspaceId: options.workspaceId, type: { in: [...NETWORK_KEYS] }, ...targetScope(options.scope) },
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        remoteUrl: true,
        publishedAt: true,
        insights: true,
        messageOverride: true,
        post: { select: { message: true } },
        target: { select: { name: true, type: true } },
      },
    });
    rows.push(...batch.map((row) => {
      const insights = parseInsights(row.insights);
      return {
        id: row.id,
        network: row.target.type as NetworkKey,
        channel: row.target.name,
        message: row.messageOverride ?? row.post.message,
        publishedAt: row.publishedAt!,
        url: row.remoteUrl,
        likes: insights?.reactions ?? null,
        reposts: insights?.shares ?? null,
        replies: insights?.comments ?? null,
        views: insights?.impressions ?? null,
        metrics: insights?.metrics ?? {},
      };
    }));
    if (batch.length < 500) break;
    cursor = batch[batch.length - 1]!.id;
  }
  return rows;
}
