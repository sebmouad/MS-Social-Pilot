import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { platformFor } from '@/server/platforms/registry';
import { runtimeConfig } from '@/server/config/store';
import { hasPlatformCapability, loadEntitlements } from '@/server/entitlements';

export type PublishingActor = { userId: string; workspaceId: string };
const WRITERS = new Set(['owner', 'admin', 'editor', 'contributor']);
const MANAGERS = new Set(['owner', 'admin', 'editor']);
type PublishingLimits = { maxText: number; maxImportRows: number; maxImportBytes: number; maxTargets: number };

async function limits(): Promise<PublishingLimits> {
  const [maxText, maxImportRows, maxImportBytes, maxTargets] = await Promise.all([
    runtimeConfig('publishing.maxMessageCharacters'), runtimeConfig('publishing.maxImportRows'),
    runtimeConfig('publishing.maxImportBytes'), runtimeConfig('publishing.maxTargetsPerPost'),
  ]);
  return { maxText: Number(maxText), maxImportRows: Number(maxImportRows), maxImportBytes: Number(maxImportBytes), maxTargets: Number(maxTargets) };
}

async function membership(actor: PublishingActor) {
  const result = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!result) throw new Error('You are no longer a member of this workspace.');
  if (!WRITERS.has(result.role)) throw new Error('You do not have permission to manage posts.');
  return result;
}

function validText(value: string, maxText: number) {
  const text = value.trim();
  if (!text || text.length > maxText) throw new Error(`Post text must be between 1 and ${maxText.toLocaleString()} characters.`);
  return text;
}

function validFirstComment(value: string, maxText: number) {
  const text = value.trim();
  if (text.length > maxText) throw new Error(`First comment must be ${maxText.toLocaleString()} characters or fewer.`);
  return text || null;
}

async function validateTargets(actor: PublishingActor, ids: string[], maxTargets: number) {
  if (ids.length > maxTargets || new Set(ids).size !== ids.length) throw new Error(`Choose up to ${maxTargets} distinct destinations.`);
  if (!ids.length) return [];
  const targets = await prisma.target.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId, enabled: true, canPublish: true },
    select: { id: true, type: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } },
  });
  if (targets.length !== ids.length) throw new Error('One or more destinations are unavailable or cannot publish.');
  const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
  if (!entitlements) throw new Error('This workspace is unavailable.');
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'publishing') : null;
    if (!provider || !hasPlatformCapability(entitlements, provider) || !adapter?.publish || !adapter.supportsTargetKind?.(target.type, 'publishing') || target.socialAccount?.invalidatedAt || !target.accessToken) {
      throw new Error('One or more destinations are unavailable or cannot publish.');
    }
  }
  return targets;
}

export async function createPost(actor: PublishingActor, input: { message: string; firstComment: string; targetIds: string[] }) {
  await membership(actor);
  const config = await limits();
  const text = validText(input.message, config.maxText);
  const firstComment = validFirstComment(input.firstComment, config.maxText);
  const targets = await validateTargets(actor, input.targetIds, config.maxTargets);
  const now = new Date();
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.post.create({ data: { id, workspaceId: actor.workspaceId, authorId: actor.userId, message: text, firstComment, status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
      targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, status: 'pending' as const })) } } });
    await audit(tx, actor, 'publishing.post_created', { postId: id, targetCount: targets.length });
  });
  return { id };
}

export async function updatePost(actor: PublishingActor, input: { postId: string; message: string; firstComment: string; targetIds: string[] }) {
  const role = await membership(actor);
  const config = await limits();
  const text = validText(input.message, config.maxText);
  const firstComment = validFirstComment(input.firstComment, config.maxText);
  const targets = await validateTargets(actor, input.targetIds, config.maxTargets);
  await prisma.$transaction(async tx => {
    const existing = await tx.post.findFirst({ where: { id: input.postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, status: true, publishedAt: true, targets: { select: { id: true, status: true, remotePostId: true } } } });
    if (!existing || (role.role === 'contributor' && existing.authorId !== actor.userId)) throw new Error('This post is unavailable in the current workspace.');
    if (existing.publishedAt || ['publishing', 'published', 'partially_failed', 'scheduled'].includes(existing.status) || existing.targets.some(target => target.remotePostId || target.status === 'processing' || target.status === 'published' || target.status === 'scheduled_remote')) throw new Error('This post can no longer be edited.');
    await tx.postTarget.deleteMany({ where: { postId: existing.id } });
    await tx.post.update({ where: { id: existing.id }, data: { message: text, firstComment, updatedAt: new Date(), targets: { create: targets.map(target => ({ id: randomUUID(), targetId: target.id, status: 'pending' as const })) } } });
    await audit(tx, actor, 'publishing.post_updated', { postId: existing.id, targetCount: targets.length });
  });
}

/** Local deletion is always explicit. Requested remote deletion runs first through each destination adapter. */
export async function deletePost(actor: PublishingActor, postId: string, deleteRemote: boolean) {
  const role = await membership(actor);
  if (deleteRemote && !MANAGERS.has(role.role)) throw new Error('Only workspace owners, admins, and editors can delete remote posts.');
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, authorId: true, targets: { select: { id: true, status: true, remotePostId: true, target: { select: { type: true, providerId: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } } } } } } });
  if (!post || (role.role === 'contributor' && post.authorId !== actor.userId)) throw new Error('This post is unavailable in the current workspace.');
  const remoteRows = post.targets.filter(row => row.remotePostId);
  const entitlements = deleteRemote ? await loadEntitlements(actor.userId, actor.workspaceId) : null;
  if (deleteRemote) for (const row of remoteRows) {
    const provider = row.target.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'remoteDelete') : null;
    if (!provider || !entitlements || !hasPlatformCapability(entitlements, provider) || !adapter?.deleteRemote) throw new Error('Remote deletion is not supported for every destination. No remote deletion was attempted.');
  }
  if (deleteRemote && remoteRows.length) {
    for (const row of remoteRows) {
      const provider = row.target.socialAccount?.provider;
      const adapter = provider ? await platformFor(provider, 'remoteDelete') : null;
      if (!adapter?.deleteRemote || !row.target.accessToken || row.target.socialAccount?.invalidatedAt) throw new Error('Reconnect this source before remote deletion. The local post is preserved.');
      try {
        await adapter.deleteRemote({ credential: { accessToken: decryptSecret(row.target.accessToken) }, remoteId: row.remotePostId! });
        await prisma.$transaction(async tx => {
          await tx.postTarget.updateMany({ where: { id: row.id, postId: post.id, remotePostId: row.remotePostId }, data: { status: 'cancelled', remotePostId: null, remoteUrl: null } });
          await audit(tx, actor, 'publishing.remote_post_deleted', { postId: post.id, postTargetId: row.id });
        });
      } catch {
        await prisma.$transaction(tx => audit(tx, actor, 'publishing.remote_delete_failed', { postId: post.id, postTargetId: row.id }));
        throw new Error('The platform could not confirm remote deletion. The local post and publishing history are preserved.');
      }
    }
  }
  await prisma.$transaction(async tx => {
    const current = await tx.post.findFirst({ where: { id: post.id, workspaceId: actor.workspaceId }, select: { id: true } });
    if (!current) throw new Error('This post was already deleted.');
    await tx.postComment.deleteMany({ where: { postTarget: { postId: post.id } } });
    await tx.postTarget.deleteMany({ where: { postId: post.id } });
    await tx.post.delete({ where: { id: post.id } });
    await audit(tx, actor, 'publishing.post_deleted', { postId: post.id, remoteDeletionRequested: deleteRemote, remoteDeletedCount: deleteRemote ? remoteRows.length : 0 });
  });
}

/** Claim each destination before the provider call. `processing` remains as a manual-reconciliation marker on ambiguous failures. */
export async function publishPost(actor: PublishingActor, postId: string) {
  await membership(actor);
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, message: true, firstComment: true, status: true, targets: { select: { id: true, status: true, remotePostId: true, target: { select: { id: true, type: true, providerId: true, canPublish: true, enabled: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } } } } } } });
  if (!post) throw new Error('This post is unavailable in the current workspace.');
  if (!post.targets.length) throw new Error('Select at least one destination before publishing.');
  const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
  if (!entitlements) throw new Error('This workspace is unavailable.');
  let published = 0;
  let failed = 0;
  let pending = 0;
  for (const item of post.targets) {
    if (item.status === 'published' || item.remotePostId) { published++; continue; }
    if (item.status === 'processing') { pending++; continue; }
    if (!['pending', 'failed'].includes(item.status)) { failed++; continue; }
    const provider = item.target.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'publishing') : null;
    const eligible = Boolean(provider && hasPlatformCapability(entitlements, provider) && adapter?.publish && adapter.supportsTargetKind?.(item.target.type, 'publishing') && item.target.enabled && item.target.canPublish && item.target.accessToken && !item.target.socialAccount?.invalidatedAt);
    if (!eligible) { failed++; await markTarget(actor, item.id, 'failed'); continue; }
    const claim = await prisma.$transaction(async tx => tx.postTarget.updateMany({ where: { id: item.id, postId: post.id, status: item.status, remotePostId: null }, data: { status: 'processing' } }));
    if (claim.count !== 1) { pending++; continue; }
    try {
      const result = await adapter!.publish!({ credential: { accessToken: decryptSecret(item.target.accessToken!) }, target: { id: item.target.providerId, name: '', kind: item.target.type }, text: post.message, firstComment: post.firstComment });
      await prisma.$transaction(async tx => {
        await tx.postTarget.update({ where: { id: item.id }, data: { status: 'published', remotePostId: result.remoteId, remoteUrl: result.url, publishedAt: new Date() } });
        await audit(tx, actor, 'publishing.target_published', { postId: post.id, postTargetId: item.id });
      });
      published++;
    } catch (error) {
      // A timeout or malformed response can happen after a provider accepted the post. Keep the claim locked for manual reconciliation.
      if (isDefiniteProviderRejection(error, Boolean(post.firstComment?.trim()))) { await markTarget(actor, item.id, 'failed'); failed++; }
      else pending++;
    }
  }
  const status = pending ? (published ? 'partially_failed' : 'publishing') : failed ? (published ? 'partially_failed' : 'failed') : 'published';
  await prisma.$transaction(async tx => {
    await tx.post.update({ where: { id: post.id }, data: { status, publishedAt: published && !pending && !failed ? new Date() : undefined, updatedAt: new Date() } });
    await audit(tx, actor, 'publishing.publish_finished', { postId: post.id, published, failed, needsReconciliation: pending });
  });
  return { published, failed, needsReconciliation: pending };
}

export async function syncPostStatus(actor: PublishingActor, postId: string) {
  await membership(actor);
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { id: true, status: true, targets: { select: { id: true, status: true, remotePostId: true, target: { select: { type: true, accessToken: true, socialAccount: { select: { provider: true, invalidatedAt: true } } } } } } } });
  if (!post) throw new Error('This post is unavailable in the current workspace.');
  const entitlements = await loadEntitlements(actor.userId, actor.workspaceId);
  if (!entitlements) throw new Error('This workspace is unavailable.');
  let synced = 0;
  for (const item of post.targets) {
    const provider = item.target.socialAccount?.provider;
    const adapter = provider ? await platformFor(provider, 'remoteStatus') : null;
    if (!item.remotePostId || !provider || !hasPlatformCapability(entitlements, provider) || !adapter?.getRemoteStatus || !item.target.accessToken || item.target.socialAccount?.invalidatedAt) continue;
    const status = await adapter.getRemoteStatus({ credential: { accessToken: decryptSecret(item.target.accessToken) }, remoteId: item.remotePostId });
    if (status.state === 'unknown') continue;
    await prisma.$transaction(async tx => {
      await tx.postTarget.update({ where: { id: item.id }, data: { status: status.state === 'published' ? 'published' : 'scheduled_remote', ...(status.publishedAt ? { publishedAt: status.publishedAt } : {}) } });
      await audit(tx, actor, 'publishing.target_status_synced', { postId: post.id, postTargetId: item.id, state: status.state });
    });
    synced++;
  }
  const counts = await prisma.postTarget.groupBy({ by: ['status'], where: { postId: post.id }, _count: true });
  const published = counts.find(row => row.status === 'published')?._count ?? 0;
  const scheduled = counts.find(row => row.status === 'scheduled_remote')?._count ?? 0;
  const failed = counts.find(row => row.status === 'failed')?._count ?? 0;
  const processing = counts.find(row => row.status === 'processing')?._count ?? 0;
  const overall = processing ? (published + scheduled ? 'partially_failed' : 'publishing') : published + scheduled === post.targets.length ? (scheduled ? 'scheduled' : 'published') : published ? 'partially_failed' : failed ? 'failed' : post.status;
  await prisma.$transaction(async tx => {
    await tx.post.update({ where: { id: post.id }, data: { status: overall, ...(published ? { publishedAt: new Date() } : {}), updatedAt: new Date() } });
    await audit(tx, actor, 'publishing.post_status_synced', { postId: post.id, targetsSynced: synced });
  });
  return { synced };
}

/** Strict CSV: header columns `message,firstComment,targetIds`; targetIds are semicolon-separated local target IDs. */
export async function importPostsCsv(actor: PublishingActor, csv: string) {
  await membership(actor);
  const config = await limits();
  if (new TextEncoder().encode(csv).length > config.maxImportBytes) throw new Error(`CSV file must be ${Math.ceil(config.maxImportBytes / 1024)} KiB or smaller.`);
  const rows = parsePublishingCsv(csv);
  if (rows.length < 2 || rows.length > config.maxImportRows + 1) throw new Error(`CSV must include a header and contain at most ${config.maxImportRows} posts.`);
  const header = rows[0]!.map(value => value.trim());
  if (header.length !== 3 || header[0] !== 'message' || header[1] !== 'firstComment' || header[2] !== 'targetIds') throw new Error('CSV header must be message,firstComment,targetIds.');
  const inputs = rows.slice(1).map((row, index) => {
    if (row.length !== 3) throw new Error(`CSV row ${index + 2} must have exactly three columns.`);
    return { message: validText(row[0]!, config.maxText), firstComment: validFirstComment(row[1]!, config.maxText), targetIds: row[2]!.split(';').map(id => id.trim()).filter(Boolean) };
  });
  for (const input of inputs) await validateTargets(actor, input.targetIds, config.maxTargets);
  const targetCount = new Set(inputs.flatMap(row => row.targetIds)).size;
  const now = new Date();
  const ids = inputs.map(() => randomUUID());
  await prisma.$transaction(async tx => {
    for (const [index, input] of inputs.entries()) await tx.post.create({ data: { id: ids[index]!, workspaceId: actor.workspaceId, authorId: actor.userId, message: input.message, firstComment: input.firstComment, status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
      targets: { create: input.targetIds.map(targetId => ({ id: randomUUID(), targetId, status: 'pending' as const })) } } });
    await audit(tx, actor, 'publishing.posts_imported', { postCount: ids.length, targetCount });
  });
  return { count: ids.length };
}

export function parsePublishingCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (closedQuote && char !== ',' && char !== '\n' && char !== '\r') throw new Error('CSV has characters after a closing quote.');
    else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; closedQuote = false; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = []; closedQuote = false;
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

async function markTarget(actor: PublishingActor, id: string, status: 'failed') {
  await prisma.$transaction(async tx => {
    await tx.postTarget.updateMany({ where: { id, post: { workspaceId: actor.workspaceId }, status: 'processing' }, data: { status } });
    await audit(tx, actor, 'publishing.target_failed', { postTargetId: id });
  });
}

function isDefiniteProviderRejection(error: unknown, firstCommentIncluded: boolean) {
  // When a first comment is requested, any Graph error could be the comment call
  // after the post itself was accepted, so keep the claim for manual review.
  return !firstCommentIncluded && typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && error.status >= 400;
}

async function audit(tx: Prisma.TransactionClient, actor: PublishingActor, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`pub_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
}
