import { env } from './env';
import { listInstagramAccounts, readInstagramInsights, readInstagramMedia } from './instagram';
import { readNetworkPosts } from './network-analytics';
import type { PageScope } from './page-access';
import { targetScope } from './page-access';
import { prisma } from './prisma';
import { NETWORK_KEYS } from './networks/types';
import { instagramChannel, instagramInSelection, instagramPosts, networkChannels, networkPosts, type ChannelFigures, type ChannelPost } from './channel-figures';

/**
 * Instagram accounts (linked to a selected Page) and other-network channels in
 * the selection, with their figures and posts for the window. Reuses the
 * Instagram and network loaders; server only.
 */
export async function readChannelFigures(options: {
  workspaceId: string;
  scope: PageScope;
  /** Selection details for Instagram accounts, which are not Pages. */
  instagram: Parameters<typeof instagramInSelection>[1];
  from: Date;
  to: Date;
}): Promise<{ channels: ChannelFigures[]; posts: ChannelPost[] }> {
  const { workspaceId, scope, instagram: igSelection, from, to } = options;
  const accounts = env.instagramEnabled
    ? (await listInstagramAccounts(workspaceId)).filter((account) => instagramInSelection(account, igSelection))
    : [];
  const instagram = await Promise.all(
    accounts.map(async (account) => {
      const [series, media] = await Promise.all([
        readInstagramInsights({ accountId: account.id, from, to }),
        readInstagramMedia({ accountId: account.id, limit: 200 }),
      ]);
      return { channel: instagramChannel({ account, series, media, from, to }), posts: instagramPosts(account, media, from, to) };
    }),
  );
  const [networkRows, networkTargets] = await Promise.all([
    readNetworkPosts({ workspaceId, scope, from, to }),
    prisma.target.findMany({ where: { workspaceId, type: { in: [...NETWORK_KEYS] }, ...targetScope(scope) }, select: { id: true, type: true, name: true, followersCount: true } }),
  ]);
  const others = networkPosts(networkRows);
  return {
    channels: [...instagram.map((entry) => entry.channel), ...networkChannels(others, networkTargets.map((target) => ({ id: target.id, network: target.type, name: target.name, followers: target.followersCount })))],
    posts: [...instagram.flatMap((entry) => entry.posts), ...others].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
  };
}

/** Standing audience counts, without the expensive media and post reads. */
export async function readAudienceChannels(options: {
  workspaceId: string;
  scope: PageScope;
  instagram: Parameters<typeof instagramInSelection>[1];
}): Promise<Array<{ key: string; network: string; name: string; followers: number | null }>> {
  const [accounts, targets] = await Promise.all([
    env.instagramEnabled ? listInstagramAccounts(options.workspaceId) : Promise.resolve([]),
    prisma.target.findMany({
      where: { workspaceId: options.workspaceId, type: { in: [...NETWORK_KEYS] }, ...targetScope(options.scope) },
      select: { id: true, type: true, name: true, followersCount: true },
    }),
  ]);
  return [
    ...accounts.filter((account) => instagramInSelection(account, options.instagram)).map((account) => ({ key: `ig:${account.id}`, network: 'instagram', name: `@${account.username}`, followers: account.followersCount })),
    ...targets.map((target) => ({ key: `net:${target.id}`, network: target.type, name: target.name, followers: target.followersCount })),
  ];
}
