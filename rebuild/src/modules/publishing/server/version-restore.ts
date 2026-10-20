import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { platformFor } from '@/server/platforms/registry';
import { availablePublishingFormats } from '../formats';
import { parsePublishingMedia, assertPublishingMediaSupport } from '../media-support';
import type { VersionSnapshot } from '../collaboration/ports';
import type { PublishingActor } from './types';
import { assertLocalImageLimits, limits, resolvePublishMedia, validatePostAttachments, validateTargets } from './lifecycle';
import { planVersionRestore, type RestoreDestination } from './version-restore-plan';
import { selectedPublishingTargetIds } from './read-scope';
import { authorizePublishing } from './access';
import { readPublishingCredential } from './credentials';

/** Called under the ordinary publishing operation locks on both preview and save. */
export async function prepareVersionRestore(actor: PublishingActor, postId: string, snapshot: VersionSnapshot) {
  const auth = await authorizePublishing(actor);
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { authorId: true, status: true, publishedAt: true, format: true, targets: { select: { targetId: true, formatId: true, status: true, remotePostId: true } } } });
  if (!post || (auth.role === 'contributor' && post.authorId !== actor.userId)) throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
  if (post.publishedAt || !['draft', 'pending_approval', 'rejected', 'failed'].includes(post.status) || post.targets.some(t => t.remotePostId || !['pending', 'failed'].includes(t.status))) throw new OperationError('conflict', 'This post can no longer be edited.');
  const ids = post.targets.map(t => t.targetId);
  const visible = await selectedPublishingTargetIds(actor.workspaceId, auth.entitlements, auth.actor.allowedTargetIds);
  if (ids.some(id => !visible.includes(id))) throw new OperationError('forbidden', 'A current destination is outside your publishing access.');
  const config = await limits();
  const targets = await validateTargets(auth.actor, ids, config.maxTargets);
  const destinations: RestoreDestination[] = [];
  for (const target of targets) {
    const adapter = await platformFor(target.socialAccount!.provider, 'publishing');
    if (!adapter) throw new OperationError('unavailable', 'A current destination is unavailable.');
    // Credential-specific first-comment grants are current, not inferred from historical support.
    const credentialTarget = await prisma.target.findFirst({ where: { id: target.id, workspaceId: actor.workspaceId }, select: { name: true, accessToken: true, socialAccount: { select: { scopes: true, invalidatedAt: true, tokenExpiresAt: true } } } });
    if (!credentialTarget || !readPublishingCredential(credentialTarget, adapter, 'publishing')) throw new OperationError('unavailable', 'A current destination needs reconnection before restoring.');
    destinations.push({ id: target.id, name: credentialTarget.name, formatId: post.targets.find(t => t.targetId === target.id)!.formatId ?? post.format, formats: availablePublishingFormats(adapter.publishingFormats), defaultId: adapter.defaultPublishingFormatId, comment: Boolean(adapter.publishFirstComment && readPublishingCredential(credentialTarget, adapter, 'firstComment')), mediaValid: (media, link) => {
      try { assertPublishingMediaSupport(adapter, media, link); return true; } catch (error) { if (error instanceof OperationError && error.code === 'invalid_request') return false; throw error; }
    } });
  }
  const media = [];
  for (const item of parsePublishingMedia(snapshot.media)) {
    try {
      const attachment = validatePostAttachments({ media: [item] }, config.maxMedia, config.maxAlt).media[0]!;
      const resolved = await resolvePublishMedia(actor.workspaceId, [attachment]);
      for (const target of targets) {
        const adapter = await platformFor(target.socialAccount!.provider, 'publishing');
        assertLocalImageLimits(adapter!, resolved);
      }
      media.push(attachment);
    } catch (error) {
      const missingFile = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
      if (!missingFile && (!(error instanceof OperationError) || !['invalid_request', 'not_found'].includes(error.code))) throw error;
    }
  }
  return planVersionRestore(snapshot, destinations, media, await runtimeConfig('publishing.maxFirstCommentDelayMinutes'), config.maxMedia);
}
