import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { platformFor } from '@/server/platforms/registry';
import { hasPlatformCapability } from '@/server/entitlements';
import { assertPlatformPublicationOutcome } from '@/server/platforms/publication-recovery';
import { authorizePublishing } from './access';
import { withPublishingOperation, withPublishingTransaction } from './guard';
import { selectedPublishingTargetIds, publishingPostVisibilityWhere } from './read-scope';
import { readPublishingCredential } from './credentials';
import { assertNoPostDeletionForRemoteIdentity } from './post-deletion-guard';
import { aggregatePublicationPostInTransaction, reconcileSubmittedPublicationInTransaction, type PublicationRow } from './publication';
import type { PublishingActor } from './types';
import type { PlatformAdapter, RemoteStatus } from '@/platforms/types';

const targetSelection = { id: true, name: true, workspaceId: true, providerId: true, type: true, enabled: true, accessToken: true,
  socialAccount: { select: { id: true, workspaceId: true, provider: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } } as const;
const unavailable = () => new OperationError('conflict', 'This publication connection or access changed. Refresh its status before continuing.');
const managers = new Set(['owner', 'admin', 'editor']);

async function authorizedPost(actor: PublishingActor, postId: string) {
  const access = await authorizePublishing(actor, 'publishing/posts', 'write');
  const ids = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.actor.allowedTargetIds);
  const post = await prisma.post.findFirst({ where: { AND: [{ id: postId }, publishingPostVisibilityWhere(actor.workspaceId, ids,
    access.actor.allowedTargetIds === undefined ? undefined : actor.userId)] },
    select: { id: true, authorId: true, format: true, media: true, targets: { select: { id: true, targetId: true, formatId: true,
      status: true, remotePostId: true, publishedAt: true, target: { select: targetSelection } } } } });
  if (!post || !managers.has(access.role) && post.authorId !== actor.userId) {
    throw new OperationError('not_found', 'This post is unavailable in the current workspace.');
  }
  return { access, post };
}
type StatusTarget = Awaited<ReturnType<typeof authorizedPost>>['post']['targets'][number]['target'];
function credential(target: StatusTarget, adapter: PlatformAdapter, workspaceId: string) {
  if (!target.enabled || target.workspaceId !== workspaceId || target.socialAccount?.workspaceId !== workspaceId) return null;
  return readPublishingCredential(target, adapter, 'remoteStatus');
}
function stamp(target: StatusTarget) {
  // Ephemeral equality only: never persisted, returned, or logged.
  return createHash('sha256').update(JSON.stringify(target)).digest('hex');
}
function contentKind(media: unknown): 'video' | 'image' | 'text' {
  const kinds = Array.isArray(media) ? media.map(item => item && typeof item === 'object' && 'kind' in item ? item.kind : undefined) : [];
  return kinds.includes('video') ? 'video' : kinds.includes('image') ? 'image' : 'text';
}
function matched(status: RemoteStatus, remoteId: string, remoteTargetId: string) {
  return status && ['published', 'scheduled'].includes(status.state) && 'remoteId' in status && 'targetId' in status &&
    status.remoteId === remoteId && status.targetId === remoteTargetId;
}

/** UI and MCP use this same current-authorized, read-only provider reconciliation. */
export async function syncPublicationStatus(actor: PublishingActor, postId: string): Promise<{ synced: number }> {
  return withPublishingOperation(actor, { postId, allowPublicationRecovery: true }, async ({ actor: currentActor, signal }) => {
    const initial = await authorizedPost(currentActor, postId);
    const parents = await prisma.$queryRaw<PublicationRow[]>`SELECT * FROM rebuild_publication_attempts
      WHERE "workspaceId"=${actor.workspaceId} AND "postId"=${postId} AND state NOT IN ('rejected','attested_absent')`;
    let synced = 0;
    for (const item of initial.post.targets) {
      const parent = parents.find(row => row.postTargetId === item.id && row.targetId === item.targetId);
      const pending = item.status === 'processing' && parent?.state === 'submitted';
      const remoteId = pending ? parent.remotePostId : item.remotePostId;
      if (!remoteId || !pending && !['published', 'scheduled_remote'].includes(item.status)) continue;
      const provider = item.target.socialAccount?.provider;
      if (!provider) continue;
      const prepared = await withPublishingTransaction(signal, async tx => {
        await tx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
        const fresh = await authorizedPost(currentActor, postId);
        const destination = fresh.post.targets.find(row => row.id === item.id && row.targetId === item.targetId);
        const adapter = await platformFor(provider, 'remoteStatus');
        if (!destination || !adapter?.getRemoteStatus || typeof adapter.statusPolicyFingerprint !== 'string' || !adapter.statusPolicyFingerprint ||
          destination.target.socialAccount?.provider !== provider || !hasPlatformCapability(fresh.access.entitlements, provider)) return null;
        const granted = credential(destination.target, adapter, actor.workspaceId);
        if (!granted) return null;
        return { target: destination.target, credential: granted, adapter, fingerprint: adapter.statusPolicyFingerprint,
          binding: stamp(destination.target), formatId: destination.formatId ?? fresh.post.format, kind: contentKind(fresh.post.media) };
      });
      if (!prepared) continue;
      signal.throwIfAborted();
      const status = await prepared.adapter.getRemoteStatus!({ credential: prepared.credential, remoteId,
        target: { id: prepared.target.providerId, name: prepared.target.name, kind: prepared.target.type },
        formatId: prepared.formatId, contentKind: prepared.kind, signal });
      if (!matched(status, remoteId, prepared.target.providerId) || pending && status.state !== 'published') continue;
      const changed = await withPublishingTransaction(signal, async tx => {
        // Stable final authority and transport policy. No provider request occurs
        // while these short row/table locks are held.
        await tx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
        const membership = await tx.$queryRaw<Array<{ id: string }>>`SELECT m.id FROM memberships m JOIN users u ON u.id=m."userId"
          WHERE m."workspaceId"=${actor.workspaceId} AND m."userId"=${actor.userId} AND u."disabledAt" IS NULL FOR SHARE OF m,u`;
        if (membership.length !== 1) throw unavailable();
        await tx.$queryRaw`SELECT t.id FROM targets t JOIN social_accounts s ON s.id=t."socialAccountId"
          WHERE t.id=${item.targetId} AND t."workspaceId"=${actor.workspaceId} AND s."workspaceId"=${actor.workspaceId} FOR SHARE OF t,s`;
        const fresh = await authorizedPost(currentActor, postId);
        const destination = fresh.post.targets.find(row => row.id === item.id && row.targetId === item.targetId);
        const adapter = await platformFor(provider, 'remoteStatus');
        if (!destination || (destination.formatId ?? fresh.post.format) !== prepared.formatId || contentKind(fresh.post.media) !== prepared.kind || !adapter || adapter.statusPolicyFingerprint !== prepared.fingerprint ||
          stamp(destination.target) !== prepared.binding || !credential(destination.target, adapter, actor.workspaceId) ||
          !hasPlatformCapability(fresh.access.entitlements, provider)) throw unavailable();
        if (pending) {
          return reconcileSubmittedPublicationInTransaction(tx, currentActor, { operationId: parent!.id, postId,
            postTargetId: item.id, targetId: item.targetId, provider, remoteId, remoteTargetId: prepared.target.providerId }, status);
        }
        if (parent && parent.state !== 'projected') return false;
        if (parent) await assertPlatformPublicationOutcome(tx, provider, actor.workspaceId, parent.id, 'PUBLISHED', remoteId);
        await assertNoPostDeletionForRemoteIdentity(tx, actor.workspaceId, item.targetId, remoteId);
        const now = new Date();
        const publishedAt = status.publishedAt instanceof Date && Number.isFinite(status.publishedAt.getTime()) && status.publishedAt.getTime() > 0 && status.publishedAt <= now
          ? status.publishedAt : destination.publishedAt ?? now;
        const count = await tx.postTarget.updateMany({ where: { id: item.id, postId, targetId: item.targetId,
          remotePostId: remoteId, status: { in: ['published', 'scheduled_remote'] }, post: { workspaceId: actor.workspaceId } },
          data: { status: status.state === 'published' ? 'published' : 'scheduled_remote', publishedAt: status.state === 'published' ? publishedAt : null } });
        if (count.count !== 1) return false;
        await aggregatePublicationPostInTransaction(tx, actor.workspaceId, postId);
        await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt") VALUES
          (${randomUUID()},${actor.userId},'publishing.target_status_synced',${JSON.stringify({ workspaceId: actor.workspaceId, postId,
            postTargetId: item.id, state: status.state, verification: 'provider_read' })}::jsonb,CURRENT_TIMESTAMP)`;
        return true;
      });
      if (changed) synced++;
    }
    return { synced };
  });
}
