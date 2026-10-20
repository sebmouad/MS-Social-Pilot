import { availablePublishingFormats } from '@/modules/publishing/formats';
import { connectionState } from '@/lib/connection-status';
import { readPublishingCredential } from '@/modules/publishing/server/credentials';
import { prisma, getTargets } from '@/server/data';
import { selectedPublishingTargetIds } from '@/modules/publishing/server/read-scope';
import { canUseFeature, hasPlatformCapability, type Entitlements } from '@/server/entitlements';
import { platformFor } from '@/server/platforms/registry';
import { platformModule } from '@/platforms';
import type { requireViewer } from '@/server/context';

/** One customer-safe publishing picker shared by creation, editing and import. */
export async function publishingDestinationChoices(viewer: Awaited<ReturnType<typeof requireViewer>>, now = new Date()) {
  const ids = await selectedPublishingTargetIds(viewer.workspaceId, viewer.entitlements, viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids);
  return publishingTargetChoices(viewer.workspaceId, viewer.entitlements, ids, now);
}

/** Internal projection for already-authorized target IDs; never returns credentials. */
export async function publishingTargetChoices(workspaceId: string, entitlements: Entitlements, ids: string[], now = new Date()) {
  const [targets, credentialRows] = await Promise.all([
    getTargets(workspaceId, ids),
    prisma.target.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, accessToken: true, socialAccount: { select: { scopes: true, invalidatedAt: true, tokenExpiresAt: true } } } }),
  ]);
  const credentials = new Map(credentialRows.map(row => [row.id, row]));
  return Promise.all(targets.map(async target => {
    const source = target.socialAccount;
    const provider = source?.provider ?? null;
    const healthy = source && connectionState(source, now) === 'connected';
    const adapter = provider && healthy && canUseFeature(entitlements, 'publishing/posts') && hasPlatformCapability(entitlements, provider) ? await platformFor(provider, 'publishing') : null;
    const credentialRow = credentials.get(target.id);
    const credentialReady = adapter && credentialRow ? readPublishingCredential(credentialRow, adapter, 'publishing', now) !== null : false;
    let canPublish = Boolean(target.canPublish && healthy && credentialReady && adapter?.publish && adapter.supportsTargetKind?.(target.type, 'publishing'));
    let publishingFormats: ReturnType<typeof availablePublishingFormats> = [];
    if (canPublish && adapter?.publishingFormats) {
      try {
        publishingFormats = availablePublishingFormats(adapter.publishingFormats);
        if (!adapter.defaultPublishingFormatId || !publishingFormats.some(format => format.id === adapter.defaultPublishingFormatId)) throw new Error('Invalid format catalog');
        const firstComment = Boolean(credentialRow && readPublishingCredential(credentialRow, adapter, 'firstComment', now));
        const remoteStatus = Boolean(credentialRow && readPublishingCredential(credentialRow, adapter, 'remoteStatus', now));
        const remoteDelete = Boolean(credentialRow && readPublishingCredential(credentialRow, adapter, 'remoteDelete', now));
        publishingFormats = publishingFormats.map(format => ({ ...format, firstComment: format.firstComment && firstComment, remoteStatus: format.remoteStatus && remoteStatus, remoteDelete: format.remoteDelete && remoteDelete }));
      } catch { canPublish = false; publishingFormats = []; }
    } else if (canPublish && adapter?.defaultPublishingFormatId) {
      canPublish = false;
    }
    return {
      id: target.id, name: target.name, type: target.type, provider,
      // Customer-facing platform name from the installed module registry; null when the module is gone.
      platformName: provider ? platformModule(provider)?.name ?? null : null,
      canPublish,
      ...(canPublish && publishingFormats.length ? { publishingFormats, defaultPublishingFormatId: adapter?.defaultPublishingFormatId } : {}),
      ...(canPublish && adapter?.publishingMedia ? { publishingMedia: adapter.publishingMedia } : {}),
      ...(canPublish && adapter?.localImageUpload ? { localImageUpload: adapter.localImageUpload } : {}),
    };
  }));
}
