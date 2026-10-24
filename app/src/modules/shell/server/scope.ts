import { requestChannelScope } from '@/server/context';
import type { ScopedPageAccess } from '@/server/permissions';
import { shellChannels, type ShellChannel } from './channels';
import { shellChrome } from './chrome';

export type PageChannelScope = { ids: string[]; dropped: number; source: 'url' | 'cookie' | 'none'; channels: ShellChannel[] };

/**
 * The channel scope of the sidebar for one page request (design v2, 01 §5): the `channel` URL parameter, then the
 * remembered cookie, reduced to the member's selected channels. Display filter only; the page's service still
 * authorizes every read, so an empty `ids` means "all channels the member may see".
 */
export async function pageChannelScope(
  viewer: { workspaceId: string; permissions: { pageScope: ScopedPageAccess } },
  searchParams: Record<string, string | string[] | undefined>,
): Promise<PageChannelScope> {
  const { policy } = await shellChrome();
  const channels = await shellChannels(viewer.workspaceId, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids, policy.channelListMax).catch(() => []);
  const scope = await requestChannelScope(viewer, searchParams, channels.map(channel => channel.id), policy.scopeCookiePrefix);
  return { ...scope, channels };
}
