/**
 * Figures for the channels besides Facebook Pages — Instagram accounts and the
 * other networks — in one shape, so the Summary, Posts, Audience and Compare
 * views can list them next to the Pages.
 *
 * Pure: no server imports. Aggregation rules (analytics-dashboard skill):
 * reach is not additive (people overlap across posts and channels), rates are
 * recomputed from their parts, and a figure a network does not report stays
 * null — shown as a dash — rather than 0.
 */

export interface ChannelFigures {
  key: string;
  /** 'instagram', 'bluesky', … — drives the network mark. */
  network: string;
  name: string;
  followers: number | null;
  posts: number;
  /** Unique reach as the network reports it for the period, never a sum. */
  reach: number | null;
  impressions: number | null;
  interactions: number | null;
  /** Interactions per reach, in percent, one decimal. */
  engagementRate: number | null;
}

export interface ChannelPost {
  key: string;
  network: string;
  channel: string;
  message: string;
  publishedAt: Date;
  url: string | null;
  reach: number | null;
  impressions: number | null;
  interactions: number | null;
  /** Every stored provider metric for this post, including breakdown maps. */
  metrics: Record<string, number | Record<string, number>>;
}

/** Sum that stays null while every part is null. */
export function sumKnown(values: Array<number | null | undefined>): number | null {
  let total: number | null = null;
  for (const value of values) if (typeof value === 'number') total = (total ?? 0) + value;
  return total;
}

export function rate(interactions: number | null, reach: number | null): number | null {
  if (interactions === null || !reach) return null;
  return Math.round((interactions / reach) * 1000) / 10;
}

const inWindow = (date: Date, from: Date, to: Date) => date >= from && date < to;

/** One Instagram account, from its stored summary, insights and media. */
export function instagramChannel(input: {
  account: { id: string; username: string; followersCount: number | null };
  /** The account's stored insight series (readInstagramInsights). */
  series: Array<{ metric: string; period: string; breakdown: boolean; latest: unknown }>;
  media: Array<{ timestamp: Date; impressions: number | null; likeCount: number | null; commentsCount: number | null; saved: number | null }>;
  from: Date;
  to: Date;
}): ChannelFigures {
  const media = input.media.filter((item) => inWindow(item.timestamp, input.from, input.to));
  // Only a 28-day reach is a unique count; daily reach does not add up.
  const reachSeries = input.series.find((entry) => entry.metric === 'reach' && entry.period === 'days_28' && !entry.breakdown);
  const reach = typeof reachSeries?.latest === 'number' ? reachSeries.latest : null;
  const interactions = sumKnown(media.map((item) => sumKnown([item.likeCount, item.commentsCount, item.saved])));
  return {
    key: `ig:${input.account.id}`,
    network: 'instagram',
    name: `@${input.account.username}`,
    followers: input.account.followersCount,
    posts: media.length,
    reach,
    impressions: sumKnown(media.map((item) => item.impressions)),
    interactions,
    engagementRate: rate(interactions, reach),
  };
}

/** Instagram media in the window, as post rows. */
export function instagramPosts(
  account: { id: string; username: string },
  media: Array<{ id: string; caption: string; permalink: string | null; timestamp: Date; reach: number | null; impressions: number | null; likeCount: number | null; commentsCount: number | null; saved: number | null; metrics?: Record<string, number | Record<string, number>> }>,
  from: Date,
  to: Date,
): ChannelPost[] {
  return media
    .filter((item) => inWindow(item.timestamp, from, to))
    .map((item) => ({
      key: `ig:${item.id}`,
      network: 'instagram',
      channel: `@${account.username}`,
      message: item.caption,
      publishedAt: item.timestamp,
      url: item.permalink,
      reach: item.reach,
      impressions: item.impressions,
      interactions: sumKnown([item.likeCount, item.commentsCount, item.saved]),
      metrics: item.metrics ?? {},
    }));
}

/** Posts on the other networks (readNetworkPosts rows) as post rows. */
export function networkPosts(
  rows: Array<{ id: string; network: string; channel: string; message: string; publishedAt: Date; url: string | null; likes: number | null; reposts: number | null; replies: number | null; views: number | null; metrics?: Record<string, number | Record<string, number>> }>,
): ChannelPost[] {
  return rows.map((row) => ({
    key: `net:${row.id}`,
    network: row.network,
    channel: row.channel,
    message: row.message,
    publishedAt: row.publishedAt,
    url: row.url,
    // These networks report no reach.
    reach: null,
    impressions: row.views,
    interactions: sumKnown([row.likes, row.reposts, row.replies]),
    metrics: {
      ...row.metrics,
      ...(row.likes === null ? {} : { likes: row.likes }),
      ...(row.reposts === null ? {} : { reposts: row.reposts }),
      ...(row.replies === null ? {} : { replies: row.replies }),
      ...(row.views === null ? {} : { views: row.views }),
    },
  }));
}

/** Include selected connections even when they have no posts in the window. */
export function networkChannels(posts: ChannelPost[], targets: Array<{ id: string; network: string; name: string; followers: number | null }> = []): ChannelFigures[] {
  const byChannel = new Map<string, ChannelPost[]>();
  for (const post of posts) {
    const key = `${post.network}:${post.channel}`;
    byChannel.set(key, [...(byChannel.get(key) ?? []), post]);
  }
  for (const target of targets) {
    const key = `${target.network}:${target.name}`;
    if (!byChannel.has(key)) byChannel.set(key, []);
  }
  return [...byChannel.entries()].map(([key, rows]) => {
    const interactions = sumKnown(rows.map((row) => row.interactions));
    const target = targets.find((entry) => `${entry.network}:${entry.name}` === key);
    const [network, ...name] = key.split(':');
    return {
      key: target ? `net:${target.id}` : `net:${key}`,
      network: network!,
      name: name.join(':'),
      followers: target?.followers ?? null,
      posts: rows.length,
      reach: null,
      impressions: sumKnown(rows.map((row) => row.impressions)),
      interactions,
      engagementRate: null,
    };
  });
}

/**
 * The selection's total over channels: counts add up, reach does not (so it
 * is only carried when there is a single channel), and the rate is recomputed
 * from the total's own parts.
 */
export function totalChannels(channels: ChannelFigures[]): Omit<ChannelFigures, 'key' | 'network' | 'name'> {
  const reach = channels.length === 1 ? channels[0]!.reach : null;
  const interactions = sumKnown(channels.map((channel) => channel.interactions));
  return {
    followers: sumKnown(channels.map((channel) => channel.followers)),
    posts: channels.reduce((sum, channel) => sum + channel.posts, 0),
    reach,
    impressions: sumKnown(channels.map((channel) => channel.impressions)),
    interactions,
    engagementRate: rate(interactions, reach),
  };
}

/**
 * Whether an Instagram account belongs in the selection. Linked accounts
 * follow their Page; unlinked ones have no Page to pick, so they show when
 * nothing is picked and the network filter is unset, Instagram or Meta — and
 * only to members who see every Page. Always inside the member's access.
 */
export function instagramInSelection(
  account: { targetId: string | null },
  selection: {
    memberScope: { all: true } | { all: false; ids: string[] };
    picked: boolean;
    ids: string[];
    net: string | null;
    platform: string | null;
  },
): boolean {
  const { memberScope, picked, ids, net, platform } = selection;
  const networkAllows = net ? net === 'instagram' : platform === null || platform === 'meta';
  if (!networkAllows) return false;
  if (account.targetId === null) return memberScope.all && !picked;
  if (memberScope.all === false && !memberScope.ids.includes(account.targetId)) return false;
  return !picked || ids.includes(account.targetId);
}
