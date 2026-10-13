import { env } from './env';
import { listInstagramAccounts, readInstagramInsights, readInstagramMedia } from './instagram';
import { readNetworkPosts } from './network-analytics';
import type { PageScope } from './page-access';
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
  const others = networkPosts(await readNetworkPosts({ workspaceId, scope, from, to }));
  return {
    channels: [...instagram.map((entry) => entry.channel), ...networkChannels(others)],
    posts: [...instagram.flatMap((entry) => entry.posts), ...others].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
  };
}
