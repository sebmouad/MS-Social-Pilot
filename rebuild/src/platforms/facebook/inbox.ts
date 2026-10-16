import { randomBytes } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { configuredFacebookEngine } from '@/platforms/facebook/runtime';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { canAccessFeature, canAccessPage } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { runtimeConfig } from '@/server/config/store';
import { messengerReplyWindow } from './reply-window';

import type { InboxReplyPolicyRequest } from '@/server/inbox/policy';
import { facebookReplyRule } from './reply-policy';

export async function facebookReplyPolicy(input: InboxReplyPolicyRequest) {
  return facebookReplyRule(input, await runtimeConfig('inbox.messengerReplyWindowHours') as number);
}

const FEATURE = 'inbox/conversations';
export type InboxActor = { userId: string; workspaceId: string };

async function access(actor: InboxActor, write = false) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { id: true, role: true },
  });
  if (!membership) throw new OperationError('unauthorized', 'You are no longer a member of this workspace.');
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions || !canUseFeature(entitlements, FEATURE) || !canAccessFeature(permissions, FEATURE, write ? 'write' : 'read')) {
    throw new OperationError('forbidden', write ? 'Inbox replies and moderation are not enabled for this workspace.' : 'Inbox access is not enabled for this workspace.');
  }
  return { membership, permissions };
}

async function page(actor: InboxActor, targetId: string, write: boolean) {
  const { permissions } = await access(actor, write);
  if (await runtimeConfig('platforms.facebook.enabled') !== true) throw new OperationError('unavailable', 'This channel is unavailable in the inbox.');
  const target = await prisma.target.findFirst({
    where: { id: targetId, workspaceId: actor.workspaceId, type: 'page', enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } } },
    select: { id: true, providerId: true, accessToken: true, socialAccount: { select: { scopes: true, tokenExpiresAt: true, invalidatedAt: true } } },
  });
  if (!target || !target.accessToken || !target.socialAccount || target.socialAccount.invalidatedAt ||
      (target.socialAccount.tokenExpiresAt && target.socialAccount.tokenExpiresAt <= new Date())) throw new OperationError('reconnect_required', 'This Facebook Page or its connection is unavailable. Reconnect it before using the inbox.');
  if (!canAccessPage(permissions, target.id)) throw new OperationError('forbidden', 'You do not have access to this Facebook Page.');
  const required = await runtimeConfig(write ? 'meta.inboxWriteScopes' : 'meta.inboxReadScopes') as string[];
  const configured = [...new Set(required.map(scope => scope.trim()).filter(Boolean))];
  if (!configured.length) throw new OperationError('unavailable', 'Inbox is unavailable for this connection. Contact your workspace administrator.');
  const granted = new Set(target.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean));
  if (configured.some(scope => !granted.has(scope))) throw new OperationError('reconnect_required', 'Inbox is unavailable for this connection. Reconnect it or contact your workspace administrator.');
  return { ...target, token: decryptSecret(target.accessToken) };
}

async function audit(actor: InboxActor, action: string, detail: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`inbox_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}

export async function canManageFacebookInbox(actor: InboxActor, targetId: string): Promise<boolean> {
  try { await page(actor, targetId, true); return true; } catch { return false; }
}

/** Upsert one Page's current conversations and the messages returned by Graph. */
export async function syncFacebookInbox(actor: InboxActor, targetId?: string) {
  await access(actor);
  if (await runtimeConfig('platforms.facebook.enabled') !== true) throw new OperationError('unavailable', 'This channel is unavailable in the inbox.');
  const postSyncLimit = (await runtimeConfig('meta.pageSize') as number) * (await runtimeConfig('meta.maxPages') as number);
  const targets = await prisma.target.findMany({
    where: { workspaceId: actor.workspaceId, type: 'page', enabled: true, ...(targetId ? { id: targetId } : {}), socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } } },
    select: { id: true }, orderBy: { name: 'asc' },
  });
  if (targetId && !targets.length) throw new OperationError('not_found', 'This Facebook Page is unavailable in the current workspace.');
  const { permissions } = await access(actor);
  const visibleTargets = targets.filter(item => canAccessPage(permissions, item.id));
  if (targetId && !visibleTargets.length) throw new OperationError('forbidden', 'You do not have access to this Facebook Page.');
  const engine = await configuredFacebookEngine();
  const batches: Array<{ targetId: string; conversations: Awaited<ReturnType<typeof engine.listInbox>>; comments: Array<{ postTargetId: string; items: Awaited<ReturnType<typeof engine.listComments>> }> }> = [];
  const failures: unknown[] = [];
  for (const item of visibleTargets) {
    // One channel that needs reconnecting must not block the others. Provider
    // reads for a channel finish before anything is written for it.
    try {
      const channel = await page(actor, item.id, false);
      const [conversations, publishedPosts] = await Promise.all([
        engine.listInbox(channel.token, channel.providerId),
        prisma.postTarget.findMany({ where: { targetId: item.id, remotePostId: { not: null }, status: 'published' }, orderBy: { publishedAt: 'desc' }, take: postSyncLimit, select: { id: true, remotePostId: true } }),
      ]);
      const comments: Array<{ postTargetId: string; items: Awaited<ReturnType<typeof engine.listComments>> }> = [];
      for (const post of publishedPosts) if (post.remotePostId) comments.push({ postTargetId: post.id, items: await engine.listComments(channel.token, post.remotePostId) });
      batches.push({ targetId: item.id, conversations, comments });
    } catch (error) { failures.push(error); }
  }
  if (failures.length && !batches.length) throw failures[0];
  let conversationCount = 0; let messageCount = 0; let commentCount = 0;
  await prisma.$transaction(async tx => {
  for (const batch of batches) {
    for (const conversation of batch.conversations) {
      const stored = await tx.conversation.upsert({
        where: { targetId_remoteId: { targetId: batch.targetId, remoteId: conversation.id } },
        create: { id: `conv_${randomBytes(12).toString('hex')}`, targetId: batch.targetId, remoteId: conversation.id, snippet: conversation.snippet, unreadCount: conversation.unreadCount, messageCount: conversation.messageCount, updatedTime: conversation.updatedAt, fetchedAt: new Date() },
        update: { snippet: conversation.snippet, unreadCount: conversation.unreadCount, messageCount: conversation.messageCount, updatedTime: conversation.updatedAt, fetchedAt: new Date() },
        select: { id: true },
      });
      conversationCount++;
      for (const message of conversation.messages) {
        await tx.conversationMessage.upsert({
          where: { conversationId_remoteId: { conversationId: stored.id, remoteId: message.id } },
          create: { id: `msg_${randomBytes(12).toString('hex')}`, conversationId: stored.id, remoteId: message.id, fromName: message.fromName, fromId: message.fromId, message: message.text, createdTime: message.createdAt },
          update: { fromName: message.fromName, fromId: message.fromId, message: message.text, createdTime: message.createdAt },
        });
        messageCount++;
      }
    }
    for (const postComments of batch.comments) {
      for (const comment of postComments.items) {
        await tx.postComment.upsert({
          where: { postTargetId_remoteId: { postTargetId: postComments.postTargetId, remoteId: comment.id } },
          create: { id: `comment_${randomBytes(12).toString('hex')}`, postTargetId: postComments.postTargetId, remoteId: comment.id, parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, createdTime: comment.createdAt, fetchedAt: new Date() },
          update: { parentRemoteId: comment.parentId, message: comment.message, fromName: comment.fromName, fromId: comment.fromId, likeCount: comment.likeCount, replyCount: comment.replyCount, isHidden: comment.isHidden, fetchedAt: new Date() },
        });
        commentCount++;
      }
    }
  }
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`inbox_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'inbox.synced', ${JSON.stringify({ workspaceId: actor.workspaceId, targetIds: batches.map(batch => batch.targetId), targetCount: batches.length, failedCount: failures.length, conversationCount, messageCount, commentCount })}::jsonb, NOW())`;
  });
  return { targetCount: batches.length, failedCount: failures.length, conversationCount, messageCount, commentCount, syncedAt: new Date().toISOString() };
}

export async function replyToFacebookInbox(actor: InboxActor, input: { kind: 'message' | 'comment'; id: string; text: string }) {
  const text = input.text.trim();
  if (!text || text.length > 2000) throw new OperationError('invalid_request', 'Write a reply of 1 to 2,000 characters.');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.id)) throw new OperationError('invalid_request', 'Invalid inbox item.');
  if (input.kind === 'message') {
    const row = await prisma.conversation.findFirst({ where: { id: input.id, target: { workspaceId: actor.workspaceId } }, select: { id: true, remoteId: true, targetId: true } });
    if (!row) throw new OperationError('not_found', 'This conversation is unavailable in the current workspace.');
    const channel = await page(actor, row.targetId, true);
    const windowHours = await runtimeConfig('inbox.messengerReplyWindowHours') as number;
    const lastInbound = await prisma.conversationMessage.findFirst({
      where: { conversationId: row.id, fromId: { not: null }, NOT: { fromId: channel.providerId } },
      orderBy: { createdTime: 'desc' }, select: { fromId: true, createdTime: true },
    });
    const replyWindow = messengerReplyWindow({ messages: lastInbound ? [lastInbound] : [], pageId: channel.providerId, windowHours });
    if (replyWindow.state === 'no_recipient') throw new OperationError('conflict', 'This conversation has no stored visitor message to reply to.');
    if (replyWindow.state === 'closed') throw new OperationError('conflict', `The Messenger reply window closed ${windowHours} hours after the visitor’s last message. Facebook only accepts replies within this window.`);
    const engine = await configuredFacebookEngine();
    const remoteId = await engine.replyToConversation(channel.token, row.remoteId, text);
    await prisma.conversationMessage.create({ data: { id: `msg_${randomBytes(12).toString('hex')}`, conversationId: row.id, remoteId, fromName: null, fromId: null, message: text, createdTime: new Date(), sentById: actor.userId } });
    await prisma.conversation.update({ where: { id: row.id }, data: { snippet: text, updatedTime: new Date() } });
    await audit(actor, 'inbox.message_replied', { targetId: row.targetId, conversationId: row.id, remoteId });
    return { ok: true };
  }
  const row = await prisma.postComment.findFirst({ where: { id: input.id, postTarget: { post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId } } }, select: { id: true, remoteId: true, postTargetId: true, postTarget: { select: { targetId: true } } } });
  if (!row) throw new OperationError('not_found', 'This comment is unavailable in the current workspace.');
  const channel = await page(actor, row.postTarget.targetId, true);
  const engine = await configuredFacebookEngine();
  const remoteId = await engine.replyToComment(channel.token, row.remoteId, text);
  await prisma.postComment.create({ data: { id: `comment_${randomBytes(12).toString('hex')}`, postTargetId: row.postTargetId, remoteId, parentRemoteId: row.remoteId, message: text, fromName: null, fromId: null, createdTime: new Date(), sentById: actor.userId } });
  await prisma.postComment.update({ where: { id: row.id }, data: { replyCount: { increment: 1 } } });
  await audit(actor, 'inbox.comment_replied', { targetId: row.postTarget.targetId, commentId: row.id, remoteId });
  return { ok: true };
}

export async function setFacebookInboxResolved(actor: InboxActor, input: { kind: 'message' | 'comment'; id: string; resolved: boolean }) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.id)) throw new OperationError('invalid_request', 'Invalid inbox item.');
  if (input.kind === 'message') {
    const row = await prisma.conversation.findFirst({ where: { id: input.id, target: { workspaceId: actor.workspaceId } }, select: { id: true, targetId: true } });
    if (!row) throw new OperationError('not_found', 'This conversation is unavailable in the current workspace.');
    await page(actor, row.targetId, true);
    await prisma.conversation.update({ where: { id: row.id }, data: { resolvedAt: input.resolved ? new Date() : null } });
    await audit(actor, input.resolved ? 'inbox.conversation_resolved' : 'inbox.conversation_reopened', { targetId: row.targetId, conversationId: row.id });
  } else {
    const row = await prisma.postComment.findFirst({ where: { id: input.id, postTarget: { post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId } } }, select: { id: true, postTarget: { select: { targetId: true } } } });
    if (!row) throw new OperationError('not_found', 'This comment is unavailable in the current workspace.');
    await page(actor, row.postTarget.targetId, true);
    await prisma.postComment.update({ where: { id: row.id }, data: { resolvedAt: input.resolved ? new Date() : null } });
    await audit(actor, input.resolved ? 'inbox.comment_resolved' : 'inbox.comment_reopened', { targetId: row.postTarget.targetId, commentId: row.id });
  }
  return { ok: true };
}

export async function moderateFacebookComment(actor: InboxActor, input: { id: string; hidden: boolean }) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.id)) throw new OperationError('invalid_request', 'Invalid inbox item.');
  const row = await prisma.postComment.findFirst({ where: { id: input.id, postTarget: { post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId } } }, select: { id: true, remoteId: true, postTarget: { select: { targetId: true } } } });
  if (!row) throw new OperationError('not_found', 'This comment is unavailable in the current workspace.');
  const channel = await page(actor, row.postTarget.targetId, true);
  const engine = await configuredFacebookEngine();
  await engine.moderateComment(channel.token, row.remoteId, input.hidden);
  await prisma.postComment.update({ where: { id: row.id }, data: { isHidden: input.hidden } });
  await audit(actor, input.hidden ? 'inbox.comment_hidden' : 'inbox.comment_unhidden', { targetId: row.postTarget.targetId, commentId: row.id });
  return { ok: true };
}

/** Delete a comment on the platform, then remove it and its stored replies locally. */
export async function deleteFacebookComment(actor: InboxActor, input: { id: string }) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.id)) throw new OperationError('invalid_request', 'Invalid inbox item.');
  const row = await prisma.postComment.findFirst({ where: { id: input.id, postTarget: { post: { workspaceId: actor.workspaceId }, target: { workspaceId: actor.workspaceId } } }, select: { id: true, remoteId: true, postTargetId: true, postTarget: { select: { targetId: true } } } });
  if (!row) throw new OperationError('not_found', 'This comment is unavailable in the current workspace.');
  const channel = await page(actor, row.postTarget.targetId, true);
  const engine = await configuredFacebookEngine();
  await engine.deleteComment(channel.token, row.remoteId);
  // Local removal happens only after the platform confirmed the deletion.
  await prisma.postComment.deleteMany({ where: { postTargetId: row.postTargetId, OR: [{ id: row.id }, { parentRemoteId: row.remoteId }] } });
  await audit(actor, 'inbox.comment_deleted', { targetId: row.postTarget.targetId, commentId: row.id });
  return { ok: true };
}
