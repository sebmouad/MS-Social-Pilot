import { runtimeConfig } from '@/server/config/store';
import { parseFirstCommentDelay } from '@/modules/publishing/first-comment-delay';
import { resolveAuthorizedDestinationFormats } from '@/modules/publishing/server/formats';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { isValidTimeZone } from '@/lib/calendar-dates';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { hasPlatformCapability } from '@/server/entitlements';
import { platformFor } from '@/server/platforms/registry';
import { lockSelectedResources } from '@/server/platforms/resource-lock';
import { authorizePublishing } from '@/modules/publishing/server/access';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';
import { readPublishingCredential } from '@/modules/publishing/server/credentials';
import { assertPublicationAttemptsSettled } from '@/modules/publishing/server/publication-guard';
import { assertNoPendingPostDeletionForAliases } from '@/modules/publishing/server/post-deletion-guard';
import { lockActor } from '@/modules/publishing/collaboration/server/core';
import { loadVersionRetention, recordPostVersion } from '@/modules/publishing/collaboration/server/versions';
import { runContentMix, runRecycleCycle, type AutomationLifecycle } from '@/modules/publishing/collaboration/server/executors';
import { limits, resolvePublishMedia, validFirstComment, validatePostAttachments, validatePostContent, validateTargets } from './lifecycle';
import type { PublishMedia } from '@/platforms/types';
import { enqueueMixDryNotifications } from './notifications';
import { storeScheduleModes, summaryMode, systemScheduleModes } from './schedule-modes';
import { handOffRemoteSchedules } from './remote-handoff';
import type { ScheduleMode } from '@/modules/publishing/remote-scheduling';

type Tx = Prisma.TransactionClient;
type Feature = 'publishing/queue' | 'publishing/collaboration';
type Policy = { timezone: string; requiresApproval: boolean };
type Stored = { format: string; approvalStatus: string; firstCommentDelayMinutes: number };
const WRITERS = new Set(['owner', 'admin', 'editor', 'contributor']);
const MANAGERS = new Set(['owner', 'admin', 'editor']);
const unavailable = () => new OperationError('conflict', 'This post is not ready for automatic scheduling. Review its content, approval and destinations.');

/** A system job keeps the original author's current publishing authority. Owner
 * qualification supplements that authority; it never impersonates an owner. */
async function prepare(tx: Tx, workspaceId: string, postId: string, feature: Feature, replacementText?: string) {
  const postKey = JSON.stringify(['publishing-post', workspaceId, postId]);
  const locked = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${postKey}, 0)) AS acquired`;
  if (locked[0]?.acquired !== true) throw unavailable();
  await tx.$queryRaw`SELECT id FROM posts WHERE id=${postId} AND "workspaceId"=${workspaceId} FOR UPDATE`;
  const post = await tx.post.findFirst({ where: { id: postId, workspaceId }, select: {
    id: true, authorId: true, message: true, firstComment: true, link: true, media: true, status: true, publishedAt: true,
    targets: { select: { id: true, targetId: true, formatId: true, status: true, remotePostId: true } },
  } });
  if (!post || !post.targets.length || !Array.isArray(post.media)) throw unavailable();
  const ids = post.targets.map(target => target.targetId);
  await lockPublishingTargets(tx, workspaceId, ids);
  await lockSelectedResources(tx, workspaceId, ids.map(id => ({ kind: 'target', id })));
  await assertPublicationAttemptsSettled(tx, workspaceId, undefined, postId);
  await assertNoPendingPostDeletionForAliases(tx, workspaceId, [postId], post.targets.map(target => target.id));
  const actor = { userId: post.authorId, workspaceId };
  const auth = await lockActor(tx, actor, feature, true);
  if (!WRITERS.has(auth.role)) throw unavailable();
  await authorizePublishing(auth.actor, 'publishing/posts', 'write');
  const policies = await tx.$queryRaw<Policy[]>`SELECT timezone, "requiresApproval" FROM workspaces WHERE id=${workspaceId} FOR SHARE`;
  const policy = policies[0];
  if (!policy || !isValidTimeZone(policy.timezone) || typeof policy.requiresApproval !== 'boolean') throw unavailable();
  const stored = (await tx.$queryRaw<Stored[]>`SELECT format, "approvalStatus"::text AS "approvalStatus", "firstCommentDelayMinutes" FROM posts WHERE id=${postId} AND "workspaceId"=${workspaceId}`)[0];
  if (!stored) throw unavailable();
  parseFirstCommentDelay(stored.firstCommentDelayMinutes, await runtimeConfig('publishing.maxFirstCommentDelayMinutes'));
  const config = await limits();
  const attachments = validatePostAttachments({ link: post.link ?? undefined, media: post.media as unknown as PublishMedia[] }, config.maxMedia, config.maxAlt);
  const message = validatePostContent(replacementText ?? post.message, config.maxText, attachments);
  const firstComment = validFirstComment(post.firstComment ?? '', config.maxText);
  const media = await resolvePublishMedia(workspaceId, attachments.media);
  const destinations = await validateTargets(auth.actor, ids, config.maxTargets, media, Boolean(firstComment), attachments.link);
  const destinationFormats = await resolveAuthorizedDestinationFormats(destinations, undefined, config.maxTargets, {media,link:attachments.link,firstComment,scheduled:true},{formats:new Map(post.targets.map(t=>[t.targetId,t.formatId ?? null])),legacyFormat:stored.format});
  const targets = await tx.target.findMany({ where: { id: { in: ids }, workspaceId, enabled: true, canPublish: true },
    select: { id: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true, tokenExpiresAt: true, scopes: true } } } });
  if (targets.length !== ids.length) throw unavailable();
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    if (!provider || !hasPlatformCapability(auth.entitlements, provider)) throw unavailable();
    await assertWorkspaceJobAccess(workspaceId, { provider, anyFeatureOf: [feature] });
    const adapter = await platformFor(provider, 'publishing');
    if (!adapter || !readPublishingCredential(target, adapter, 'publishing') ||
      (firstComment && !readPublishingCredential(target, adapter, 'firstComment'))) throw unavailable();
  }
  await authorizePublishing(auth.actor, feature, 'write');
  await authorizePublishing(auth.actor, 'publishing/posts', 'write');
  return { destinationFormats, post, stored, policy, actor: auth.actor, role: auth.role, message, firstComment, attachments, retention: await loadVersionRetention() };
}

async function systemAudit(tx: Tx, workspaceId: string, action: string, detail: object) {
  const changed = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, NULL, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (changed !== 1) throw unavailable();
}

/** Transactional system entry points, shared by the installed workers. No
 * provider call or external publication occurs here. Every write uses tx. */
export const publishingAutomationLifecycle: AutomationLifecycle = {
  async stop(tx, input) {
    const post = await tx.post.findFirst({ where: { id: input.sourcePostId, workspaceId: input.workspaceId }, select: { authorId: true, targets: { select: { targetId: true } } } });
    if (!post) throw unavailable();
    const auth = await lockActor(tx, { userId: post.authorId, workspaceId: input.workspaceId }, 'publishing/collaboration', true);
    if (!WRITERS.has(auth.role)) throw unavailable();
    await authorizePublishing(auth.actor, 'publishing/posts', 'write');
    const ids = post.targets.map(target => target.targetId);
    if (auth.actor.allowedTargetIds !== undefined && ids.some(id => !auth.actor.allowedTargetIds!.includes(id))) throw unavailable();
    await lockPublishingTargets(tx, input.workspaceId, ids);
    await lockSelectedResources(tx, input.workspaceId, ids.map(id => ({ kind: 'target', id })));
    const targets = await tx.target.findMany({ where: { workspaceId: input.workspaceId, id: { in: ids } }, select: { enabled: true, socialAccount: { select: { provider: true } } } });
    if (targets.length !== ids.length) throw unavailable();
    if (input.reason === 'no_active_destinations' && targets.some(target => target.enabled)) return false;
    if (input.reason === 'repeat_limit') {
      const state = (await tx.$queryRaw<Array<{ recycleLimit: number | null; recycleCount: number }>>`SELECT "recycleLimit", "recycleCount" FROM posts WHERE id=${input.sourcePostId} AND "workspaceId"=${input.workspaceId}`)[0];
      if (!state || state.recycleLimit === null || state.recycleCount < state.recycleLimit) return false;
    }
    for (const target of targets) {
      const provider = target.socialAccount?.provider;
      if (!provider || !hasPlatformCapability(auth.entitlements, provider)) throw unavailable();
      await assertWorkspaceJobAccess(input.workspaceId, { provider, anyFeatureOf: ['publishing/collaboration'] });
    }
    return true;
  },
  async schedule(tx, input) {
    const ready = await prepare(tx, input.workspaceId, input.postId, 'publishing/queue');
    const { post, stored, policy } = ready;
    if (post.status !== 'draft' || post.publishedAt || post.targets.some(t => t.status !== 'pending' || t.remotePostId) ||
      input.timeZone !== policy.timezone || !Number.isFinite(input.scheduledAt.getTime()) || input.scheduledAt.getTime() <= Date.now()) throw unavailable();
    if (stored.approvalStatus !== 'approved' && !(stored.approvalStatus === 'not_required' && (!policy.requiresApproval || MANAGERS.has(ready.role)))) throw unavailable();
    await recordPostVersion(tx, post.id, null, ready.retention);
    const changed = await tx.post.updateMany({ where: { id: post.id, workspaceId: input.workspaceId, status: 'draft' }, data: { status: 'scheduled', scheduledAt: input.scheduledAt, updatedAt: new Date() } });
    if (changed.count !== 1) throw unavailable();
    const metadata = await tx.$executeRaw`UPDATE posts SET timezone=${policy.timezone} WHERE id=${post.id} AND "workspaceId"=${input.workspaceId}`;
    if (metadata !== 1) throw unavailable();
    // The Root default decides where each destination waits; platform-held ones are handed over after this run (handOffRemoteSchedules).
    const modes = await systemScheduleModes(post.targets.map(t => t.targetId));
    await storeScheduleModes(tx, input.workspaceId, post.id, modes);
    await recordPostVersion(tx, post.id, null, ready.retention);
    await systemAudit(tx, input.workspaceId, 'publishing.post_scheduled_by_mix', { postId: post.id, authorId: post.authorId, scheduledAt: input.scheduledAt.toISOString(), scheduleMode: summaryMode(modes) });
    return true;
  },
  async recycle(tx, input) {
    const ready = await prepare(tx, input.workspaceId, input.sourcePostId, 'publishing/collaboration', input.message);
    const { post, stored, policy } = ready;
    if (!['published', 'partially_failed'].includes(post.status) || post.targets.some(t => ['processing', 'scheduled_remote'].includes(t.status)) || !Number.isFinite(input.scheduledAt.getTime())) throw unavailable();
    // A different wording has no historical approval, even if an editor entered
    // it. Unchanged approved content retains its review; current policy still wins.
    const unchanged = ready.message === post.message;
    const reviewed = unchanged && stored.approvalStatus === 'approved';
    const hold = policy.requiresApproval && !reviewed && (!unchanged || !MANAGERS.has(ready.role));
    if (await tx.post.findUnique({ where: { id: input.copyId }, select: { id: true } })) throw unavailable();
    await tx.post.create({ data: { id: input.copyId, workspaceId: input.workspaceId, authorId: post.authorId, message: ready.message,
      firstComment: ready.firstComment, firstCommentDelayMinutes: stored.firstCommentDelayMinutes, link: ready.attachments.link, media: ready.attachments.media,
      status: hold ? 'pending_approval' : 'scheduled', scheduledAt: input.scheduledAt, createdAt: new Date(), updatedAt: new Date(),
      targets: { create: post.targets.map(target => ({ id: randomUUID(), targetId: target.targetId, formatId: ready.destinationFormats[target.targetId], status: 'pending' as const })) } } });
    const metadata = await tx.$executeRaw`UPDATE posts SET timezone=${policy.timezone}, "originPostId"=${post.id}, "approvalStatus"=${hold ? 'pending' : reviewed ? 'approved' : 'not_required'}::"ApprovalStatus", "submittedById"=${hold ? post.authorId : null}, "submittedAt"=${hold ? new Date() : null} WHERE id=${input.copyId} AND "workspaceId"=${input.workspaceId}`;
    if (metadata !== 1) throw unavailable();
    // Repeat the author's own per-destination choices from the original; destinations without one follow the Root default.
    const earlier = await tx.$queryRaw<Array<{ targetId: string; scheduleMode: string | null }>>`SELECT "targetId", "scheduleMode" FROM post_targets WHERE "postId"=${post.id} AND "scheduleMode" IS NOT NULL`;
    const modes = await systemScheduleModes(post.targets.map(t => t.targetId), Object.fromEntries(earlier.map(row => [row.targetId, row.scheduleMode as ScheduleMode])));
    await storeScheduleModes(tx, input.workspaceId, input.copyId, modes);
    const badLabels = await tx.$queryRaw<Array<{ labelId: string }>>`SELECT pl."labelId" FROM post_labels pl LEFT JOIN labels l ON l.id=pl."labelId" WHERE pl."postId"=${post.id} AND (l.id IS NULL OR l."workspaceId"<>${input.workspaceId}) LIMIT 1`;
    if (badLabels.length) throw unavailable();
    await tx.$executeRaw`INSERT INTO post_labels ("postId", "labelId") SELECT ${input.copyId}, pl."labelId" FROM post_labels pl JOIN labels l ON l.id=pl."labelId" WHERE pl."postId"=${post.id} AND l."workspaceId"=${input.workspaceId}`;
    await recordPostVersion(tx, input.copyId, null, ready.retention);
    await systemAudit(tx, input.workspaceId, 'publishing.post_created_by_recycle', { postId: input.copyId, sourcePostId: post.id, run: input.run, authorId: post.authorId, approvalRequired: hold });
    return true;
  },
};

// The lifecycle hook checks every actual destination again under its resource
// lock. The prefilter cannot combine grants or mutate an owner-ineligible tenant.
async function workspaceEligible(workspaceId: string, feature: Feature, includeDisabled = false) {
  const providers = await prisma.$queryRaw<Array<{ provider: string }>>`SELECT DISTINCT sa.provider FROM targets t JOIN social_accounts sa ON sa.id=t."socialAccountId" WHERE t."workspaceId"=${workspaceId} AND sa."workspaceId"=${workspaceId} AND (${includeDisabled} OR t.enabled=TRUE)`;
  for (const { provider } of providers) {
    try { await assertWorkspaceJobAccess(workspaceId, { provider, anyFeatureOf: [feature] }); return true; }
    catch (error) { if (!(error instanceof OperationError) || error.code !== 'forbidden') throw error; }
  }
  return false;
}
/** Scheduling runs only save the choice; the hand-off to the platform happens right after, outside their transactions. */
export async function runPublishingRecycle(now = new Date(), workspaceId?: string) {
  const result = await runRecycleCycle({ now, workspaceId, eligible: workspaceId => workspaceEligible(workspaceId, 'publishing/collaboration', true), lifecycle: publishingAutomationLifecycle });
  await handOffRemoteSchedules(workspaceId).catch(() => undefined);
  return result;
}
export async function runPublishingMix(now = new Date(), workspaceId?: string) {
  const result = await runContentMix({ now, workspaceId, eligible: workspaceId => workspaceEligible(workspaceId, 'publishing/queue'), lifecycle: publishingAutomationLifecycle, enqueueNotice: enqueueMixDryNotifications });
  await handOffRemoteSchedules(workspaceId).catch(() => undefined);
  return result;
}
