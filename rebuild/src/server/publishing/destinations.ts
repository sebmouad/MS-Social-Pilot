import { connectionState } from '@/lib/connection-status';
import { getTargets } from '@/server/data';
import { selectedPublishingTargetIds } from '@/modules/publishing/server/read-scope';
import { hasPlatformCapability } from '@/server/entitlements';
import { platformFor } from '@/server/platforms/registry';
import type { requireViewer } from '@/server/context';

/** One customer-safe publishing picker shared by creation, editing and import. */
export async function publishingDestinationChoices(viewer: Awaited<ReturnType<typeof requireViewer>>, now = new Date()) {
  const ids = await selectedPublishingTargetIds(viewer.workspaceId, viewer.entitlements, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids);
  const targets = await getTargets(viewer.workspaceId, ids);
  return Promise.all(targets.map(async target => {
    const source = target.socialAccount;
    const provider = source?.provider ?? null;
    const healthy = source && connectionState(source, now) === 'connected';
    const adapter = provider && healthy && hasPlatformCapability(viewer.entitlements, provider) ? await platformFor(provider, 'publishing') : null;
    return {
      id: target.id, name: target.name, type: target.type, provider,
      canPublish: Boolean(target.canPublish && healthy && adapter?.publish && adapter.supportsTargetKind?.(target.type, 'publishing')),
    };
  }));
}
