import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { ASSIGN_SCHEMA, assignConfirmation, ID } from '../schemas';
import { assertMayEdit, audit, bad, bounds, exact, lockActor, parse, POSTS, protect, transact, visiblePost } from './core';

export type PostLabel = { id: string; name: string; color: string };

/** Labels currently on one post (read access plus whole-post visibility). */
export async function readPostLabels(actor: PublishingActor, postId: unknown): Promise<{ postId: string; labels: PostLabel[] }> {
  const id = parse(ID, postId);
  const auth = await authorizePublishing(actor, POSTS, 'read');
  await visiblePost(prisma, auth, id);
  const labels = await protect(prisma.$queryRaw<PostLabel[]>`SELECT l.id, l.name, l.color FROM post_labels pl JOIN labels l ON l.id = pl."labelId" WHERE pl."postId" = ${id} AND l."workspaceId" = ${actor.workspaceId} ORDER BY l.name ASC, l.id ASC`);
  return { postId: id, labels };
}

/**
 * Add, remove or replace labels on one or many posts in one atomic step.
 * Every post must be visible and editable by the caller and every label must belong to the workspace;
 * otherwise nothing changes. Single-post assignment is a bulk call with one post.
 */
export async function assignLabels(actor: PublishingActor, input: unknown) {
  const data = parse(ASSIGN_SCHEMA, input);
  exact(data.confirmation, assignConfirmation(data.mode, data.postIds.length));
  const limit = await bounds();
  if (data.postIds.length > limit.bulkPostLimit || data.labelIds.length > limit.labelsPerPostLimit) throw bad(`Choose at most ${limit.bulkPostLimit} posts and ${limit.labelsPerPostLimit} labels.`);
  await authorizePublishing(actor, POSTS, 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    for (const postId of data.postIds) {
      const post = await visiblePost(tx, auth, postId, true);
      assertMayEdit(auth, post);
    }
    if (data.labelIds.length) {
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM labels WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${data.labelIds}::text[])`;
      if (found.length !== data.labelIds.length) throw new OperationError('invalid_request', 'Choose labels from this workspace.');
    }
    const before = await tx.$queryRaw<Array<{ postId: string; labelId: string }>>`SELECT "postId", "labelId" FROM post_labels WHERE "postId" = ANY(${data.postIds}::text[])`;
    if (data.mode === 'remove') {
      await tx.$executeRaw`DELETE FROM post_labels WHERE "postId" = ANY(${data.postIds}::text[]) AND "labelId" = ANY(${data.labelIds}::text[])`;
    } else {
      if (data.mode === 'set') await tx.$executeRaw`DELETE FROM post_labels WHERE "postId" = ANY(${data.postIds}::text[]) AND NOT ("labelId" = ANY(${data.labelIds}::text[]))`;
      if (data.labelIds.length) await tx.$executeRaw`INSERT INTO post_labels ("postId", "labelId") SELECT p, l FROM unnest(${data.postIds}::text[]) AS p CROSS JOIN unnest(${data.labelIds}::text[]) AS l ON CONFLICT DO NOTHING`;
    }
    const after = await tx.$queryRaw<Array<{ postId: string; labelId: string }>>`SELECT "postId", "labelId" FROM post_labels WHERE "postId" = ANY(${data.postIds}::text[]) ORDER BY "postId", "labelId"`;
    const perPost = new Map<string, string[]>(data.postIds.map(id => [id, []]));
    for (const row of after) perPost.get(row.postId)?.push(row.labelId);
    for (const [postId, labelIds] of perPost) if (labelIds.length > limit.labelsPerPostLimit) throw new OperationError('conflict', `A post can carry at most ${limit.labelsPerPostLimit} labels. Nothing was changed.`);
    const beforeSet = new Set(before.map(r => `${r.postId}\u0000${r.labelId}`));
    const afterSet = new Set(after.map(r => `${r.postId}\u0000${r.labelId}`));
    const added = [...afterSet].filter(k => !beforeSet.has(k)).length;
    const removed = [...beforeSet].filter(k => !afterSet.has(k)).length;
    await audit(tx, actor, 'publishing.post_labels_changed', { mode: data.mode, postIds: data.postIds, labelIds: data.labelIds, added, removed });
    await lockActor(tx, actor, POSTS, true);
    return { mode: data.mode, posts: data.postIds.map(postId => ({ postId, labelIds: perPost.get(postId) ?? [] })), added, removed };
  }));
}

/** Convenience for the per-post editor: replace one post's labels. */
export function setPostLabels(actor: PublishingActor, input: { postId: string; labelIds: string[]; confirmation: string }) {
  return assignLabels(actor, { postIds: [input.postId], labelIds: input.labelIds, mode: 'set', confirmation: input.confirmation });
}
