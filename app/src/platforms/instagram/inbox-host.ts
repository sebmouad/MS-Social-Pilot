import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { runtimeConfig } from '@/server/config/store';
import { decryptSecret } from '@/server/secret-crypto';
import { OperationError } from '@/lib/operation-error';
import { authorizeInbox } from '@/modules/inbox/server/access';
import type { InboxActor } from '@/modules/inbox/server/actions';
import { inboxServiceText as sharedInboxServiceText } from '@/modules/inbox/server/service-copy';
import { withInboxChannelOperation, inboxCommentSuppressed, orderInboxCommentBatch } from '@/modules/inbox/server/comment-guard';
import type { PlatformInboxHost } from '@/server/platforms/host';
import { configuredInstagramAdapter, configuredInstagramPolicy } from './runtime';
import { hasScopes } from './publishing';
import { instagramLocale } from './locale';
import { assertInstagramSource } from './source-binding';

function withInstagramInboxOperation<T>(workspaceId: string, targetId: string, operation: (signal: AbortSignal) => Promise<T>) {
  return withWorkspaceOperation(workspaceId, () => withInboxChannelOperation(workspaceId, targetId, operation));
}

async function inboxServiceText(key: Parameters<typeof sharedInboxServiceText>[0]) {
  return sharedInboxServiceText(key, {}, await instagramLocale());
}

async function channel(actor: InboxActor, targetId: string, write: boolean) {
  const access = await authorizeInbox(actor, actor.allowedChannelIds === undefined ? {} : { allowedChannelIds: actor.allowedChannelIds }, write ? 'write' : 'read');
  if (!access.channelIds.includes(targetId)) throw new OperationError('not_found', await inboxServiceText('service7'));
  const policy = await configuredInstagramPolicy();
  const locale = await instagramLocale();
  if (await runtimeConfig('platforms.instagram.enabled') !== true) throw new OperationError('unavailable', policy.copy.unavailable[locale]);
  const target = await prisma.target.findFirst({ where: { id: targetId, workspaceId: actor.workspaceId, type: 'instagram', enabled: true,
    socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'instagram', invalidatedAt: null } } },
    select: { id: true, providerId: true, accessToken: true, socialAccountId: true, socialAccount: { select: { scopes: true, tokenExpiresAt: true } } } });
  if (!target?.accessToken || !target.socialAccount || (target.socialAccount.tokenExpiresAt && target.socialAccount.tokenExpiresAt <= new Date())) throw new OperationError('reconnect_required', policy.copy.permission[locale]);
  const credential = { accessToken: decryptSecret(target.accessToken), grantedScopes: target.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean) };
  if (!hasScopes(credential, policy.commentScopes)) throw new OperationError('reconnect_required', policy.copy.permission[locale]);
  await assertInstagramSource({ workspaceId: actor.workspaceId, targetId: target.id, remoteTargetId: target.providerId, accessToken: credential.accessToken, requiredScopes: policy.commentScopes });
  return { ...target, credential, policy };
}

async function audit(actor: InboxActor, action: string, detail: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}

async function comment(actor: InboxActor, id: string) {
  const row = await prisma.postComment.findFirst({ where: { id, postTarget: { post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId, enabled: true, type: 'instagram', socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'instagram', invalidatedAt: null } } } } },
    select: { id: true, remoteId: true, parentRemoteId: true, postTargetId: true, postTarget: { select: { targetId: true } } } });
  if (!row) throw new OperationError('not_found', await inboxServiceText('service6'));
  return row;
}

async function currentComment(actor: InboxActor, id: string) {
  const row = await comment(actor, id);
  if (await prisma.$transaction(tx => inboxCommentSuppressed(tx, actor.workspaceId, row.postTarget.targetId, row.remoteId, row.parentRemoteId))) throw new OperationError('conflict', await inboxServiceText('service16'));
  return row;
}

export const instagramInboxHost: PlatformInboxHost = {
  async replyPolicy(input) {
    const policy = await configuredInstagramPolicy();
    const locale = await instagramLocale();
    return { allowed: input.kind === 'comment', headline: input.kind === 'comment' ? policy.copy.publicReply[locale] : policy.copy.commentsOnly[locale] };
  },
  async canManage(actor, targetId) { try { await channel(actor, targetId, true); return true; } catch { return false; } },
  async sync(actor, targetId) {
    const access = await authorizeInbox(actor, actor.allowedChannelIds === undefined ? {} : { allowedChannelIds: actor.allowedChannelIds });
    if (targetId && !access.channelIds.includes(targetId)) throw new OperationError('not_found', await inboxServiceText('service7'));
    const targets = await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, id: { in: targetId ? [targetId] : access.channelIds }, type: 'instagram', enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'instagram', invalidatedAt: null } } }, select: { id: true } });
    let commentCount = 0; let targetCount = 0; const failures: unknown[] = [];
    for (const target of targets) try {
      let storedCount = 0;
      const current = await channel(actor, target.id, false);
      const locale = await instagramLocale();
      const adapter = await configuredInstagramAdapter(locale);
        const posts = await prisma.postTarget.findMany({ where: { targetId: target.id, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId }, status: 'published', remotePostId: { not: null } }, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: current.policy.pageSize * current.policy.maxPages + 1, select: { id: true, remotePostId: true } });
        // Refuse a clipped result rather than reporting an apparently complete synchronization.
        if (posts.length > current.policy.pageSize * current.policy.maxPages) throw new OperationError('unavailable', current.policy.copy.unavailable[locale]);
        const batches: Array<{ post: { id: string; remotePostId: string | null }; rows: import('@/platforms/types').InboxItem[] }> = [];
        for (const post of posts) if (post.remotePostId) {
          const rows = await adapter.listComments!({ credential: current.credential, targetId: current.providerId, remotePostId: post.remotePostId });
          batches.push({ post, rows: orderInboxCommentBatch(rows) });
        }
      await withInstagramInboxOperation(actor.workspaceId, target.id, async signal => {
        signal.throwIfAborted();
        const fresh = await channel(actor, target.id, false);
        if (fresh.providerId !== current.providerId || fresh.accessToken !== current.accessToken || fresh.socialAccountId !== current.socialAccountId) throw new OperationError('conflict', current.policy.copy.permission[locale]);
        await prisma.$transaction(async tx => {
          for (const { post, rows } of batches) {
            if (!await tx.postTarget.findFirst({ where: { id: post.id, targetId: target.id, remotePostId: post.remotePostId, status: 'published', post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId, enabled: true } }, select: { id: true } })) throw new OperationError('conflict', current.policy.copy.unavailable[locale]);
            for (const row of rows) {
            if (await inboxCommentSuppressed(tx, actor.workspaceId, target.id, row.id, row.parentId)) continue;
            const data = { parentRemoteId: row.parentId, message: row.text, fromName: row.authorName, fromId: row.authorId, createdTime: row.createdAt, fetchedAt: new Date() };
            await tx.postComment.upsert({ where: { postTargetId_remoteId: { postTargetId: post.id, remoteId: row.id } }, create: { id: randomUUID(), postTargetId: post.id, remoteId: row.id, ...data }, update: data });
            storedCount++;
            }
          }
        });
      });
      targetCount++; commentCount += storedCount;
    } catch (error) { failures.push(error); }
    if (failures.length && !targetCount) throw failures[0];
    await audit(actor, 'inbox.synced', { provider: 'instagram', targetCount, failedCount: failures.length, commentCount });
    return { targetCount, failedCount: failures.length, conversationCount: 0, messageCount: 0, commentCount, syncedAt: new Date().toISOString() };
  },
  async reply(actor, input) {
    const policy = await configuredInstagramPolicy();
    const locale = await instagramLocale();
    if (input.kind !== 'comment') throw new OperationError('unavailable', policy.copy.commentsOnly[locale]);
    const text = input.text.trim();
    if (!text || text.length > policy.inboxReplyMaxCharacters) throw new OperationError('invalid_request', policy.copy.invalid[locale]);
    const initial = await comment(actor, input.id);
    return withInstagramInboxOperation(actor.workspaceId, initial.postTarget.targetId, async signal => {
      const row = await currentComment(actor, input.id);
      const current = await channel(actor, row.postTarget.targetId, true);
      const adapter = await configuredInstagramAdapter(await instagramLocale(), signal);
      signal.throwIfAborted();
      const receipt = await adapter.replyToInbox!({ credential: current.credential, targetId: current.providerId, remoteId: row.remoteId, text });
      signal.throwIfAborted();
      await prisma.postComment.create({ data: { id: randomUUID(), postTargetId: row.postTargetId, remoteId: receipt.remoteId, parentRemoteId: row.remoteId, message: text, fromId: current.providerId, createdTime: new Date(), sentById: actor.userId } });
      await prisma.postComment.update({ where: { id: row.id }, data: { replyCount: { increment: 1 } } });
      await audit(actor, 'inbox.comment_replied', { targetId: current.id, commentId: row.id, remoteId: receipt.remoteId });
      return { ok: true };
    });
  },
  async moderate(actor, input) {
    const initial = await comment(actor, input.id);
    return withInstagramInboxOperation(actor.workspaceId, initial.postTarget.targetId, async signal => {
      const row = await currentComment(actor, input.id);
      const current = await channel(actor, row.postTarget.targetId, true);
      const adapter = await configuredInstagramAdapter(await instagramLocale(), signal);
      signal.throwIfAborted();
      await adapter.hideInboxItem!({ credential: current.credential, targetId: current.providerId, remoteId: row.remoteId, hidden: input.hidden });
      signal.throwIfAborted();
      await prisma.postComment.update({ where: { id: row.id }, data: { isHidden: input.hidden } });
      await audit(actor, input.hidden ? 'inbox.comment_hidden' : 'inbox.comment_unhidden', { targetId: current.id, commentId: row.id });
      return { ok: true };
    });
  },
  async prepareDeleteComment(actor, input) {
    await channel(actor, input.targetId, true);
    return async signal => {
      const current = await channel(actor, input.targetId, true);
      const adapter = await configuredInstagramAdapter(await instagramLocale(), signal);
      signal.throwIfAborted();
      await adapter.deleteInboxItem!({ credential: current.credential, targetId: current.providerId, remoteId: input.remoteId });
    };
  },
};
