import { pageChannelScope } from '@/modules/shell/server/scope';
import type { ScopedPageAccess } from '@/server/permissions';

/**
 * The sidebar's channel scope for the Inbox (design v2 01 §5). The `channel` address parameter is a list of channel
 * ids (`a,b`); the remembered cookie applies when it is absent. The scope narrows what the Inbox services may read, so
 * a member never sees more than their own access allows, and the Inbox has no channel filter of its own.
 */
export async function inboxScope(viewer: { workspaceId: string; permissions: { pageScope: ScopedPageAccess } }, rawChannel: string | string[] | undefined) {
  const scope = await pageChannelScope(viewer, { channel: rawChannel });
  const constraints = scope.ids.length ? { allowedChannelIds: scope.ids } : viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids };
  return {
    ids: scope.ids,
    constraints,
    /** The value to carry in links and forms; absent when the scope came from the cookie or the whole workspace is in view. */
    param: scope.source === 'url' && scope.ids.length ? scope.ids.join(',') : undefined,
  };
}
