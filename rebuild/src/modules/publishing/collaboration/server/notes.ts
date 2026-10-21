
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor, PublishingAuthorization } from '../../server/types';
import { collaborationPorts } from '../ports';
import { addNoteConfirmation, deleteNoteConfirmation, mentionedIn, NOTE_ADD, NOTE_DELETE, NOTE_LIST } from '../schemas';
import { audit, bad, bounds, exact, isManager, lockActor, pageOffset, parse, POSTS, protect, transact, visiblePost } from './core';
import type { Tx } from './core';

export type PostNoteRecord = { id: string; postId: string; body: string; authorId: string | null; authorName: string | null; mentionIds: string[]; createdAt: Date };
export type MentionCandidate = { id: string; name: string };

/** Members who can see every channel the post goes to: the only people a note may mention. */
async function candidates(db: Tx | typeof prisma, workspaceId: string, postId: string, maximum: number): Promise<MentionCandidate[]> {
  const errorText = await loadPublishingErrorText();
  const rows = await db.$queryRaw<MentionCandidate[]>`
    SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m."userId"
    WHERE m."workspaceId" = ${workspaceId} AND u."disabledAt" IS NULL AND m.role::text <> 'client'
      AND (m."allPages" OR NOT EXISTS (
        SELECT 1 FROM post_targets pt WHERE pt."postId" = ${postId}
          AND NOT EXISTS (SELECT 1 FROM member_page_access a WHERE a."membershipId" = m.id AND a."targetId" = pt."targetId")))
    ORDER BY u.name ASC, u.id ASC LIMIT ${maximum + 1}`;
  if (rows.length > maximum) throw new PublishingOperationError('unavailable', 'collaboration_34', {}, errorText);
  return rows;
}

export async function readPostNotes(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const query = parse(NOTE_LIST, input, undefined, errorText);
  const limit = await bounds();
  const auth = await authorizePublishing(actor, POSTS, 'read');
  await visiblePost(prisma, auth, query.postId);
  const page = query.page ?? 1;
  const rows = await protect(prisma.$queryRaw<PostNoteRecord[]>`SELECT n.id, n."postId", n.body, n."authorId", u.name AS "authorName", n."mentionIds", n."createdAt" FROM post_notes n LEFT JOIN users u ON u.id = n."authorId" WHERE n."postId" = ${query.postId} ORDER BY n."createdAt" DESC, n.id DESC LIMIT ${limit.notePageSize + 1} OFFSET ${pageOffset(page, limit.notePageSize)}`);
  const canWrite = auth.permissions.features[POSTS]?.write === true;
  const mentionable = canWrite && collaborationPorts().mentions ? await protect(candidates(prisma, actor.workspaceId, query.postId, limit.mentionDirectoryLimit)) : [];
  return { postId: query.postId, notes: rows.slice(0, limit.notePageSize), page, pageSize: limit.notePageSize, hasMore: rows.length > limit.notePageSize, mentionable, maxCharacters: limit.noteMax, viewerId: actor.userId, viewerCanModerate: isManager(auth.role) };
}

/** Adds an internal, never-published note. Mentions are limited to members who can see the post and are never self-mentions. */
export async function addPostNote(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(NOTE_ADD, input, undefined, errorText); exact(data.confirmation, addNoteConfirmation(data.postId), errorText);
  const limit = await bounds();
  if (data.body.length > limit.noteMax || data.mentionIds.length > limit.noteMentionLimit) throw bad(undefined, errorText);
  await authorizePublishing(actor, POSTS, 'write');
  const result = await protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    await visiblePost(tx, auth, data.postId, true);
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_notes WHERE "postId" = ${data.postId}`;
    if (Number(count[0]?.count ?? 0) >= limit.notesPerPostLimit) throw new PublishingOperationError('conflict', 'collaboration_35', {}, errorText);
    const members = data.mentionIds.length ? await candidates(tx, actor.workspaceId, data.postId, limit.mentionDirectoryLimit) : [];
    const mentionIds = mentionedIn(data.body, members, data.mentionIds).filter(id => id !== actor.userId);
    const id = `note_${randomUUID()}`;
    const inserted = await tx.$queryRaw<Array<{ createdAt: Date }>>`INSERT INTO post_notes (id, "postId", "authorId", body, "mentionIds", "createdAt") VALUES (${id}, ${data.postId}, ${actor.userId}, ${data.body}, ${mentionIds}::text[], NOW()) RETURNING "createdAt"`;
    const createdAt = inserted[0]?.createdAt;
    if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) throw new PublishingOperationError('unavailable', 'collaboration_36', {}, errorText);
    const port = collaborationPorts().mentions;
    const notification = port && mentionIds.length
      ? await port.enqueueNoteMention(tx, { workspaceId: actor.workspaceId, postId: data.postId, noteId: id, authorId: actor.userId, recipientIds: mentionIds })
      : null;
    await audit(tx, actor, 'publishing.post_note_added', { postId: data.postId, noteId: id, mentions: mentionIds.length });
    await lockActor(tx, actor, POSTS, true);
    return { id, mentionIds, createdAt, notified: notification ? notification.queued > 0 ? 'queued' as const : 'none' as const : mentionIds.length ? 'unavailable' as const : 'none' as const };
  }));
  return { id: result.id, postId: data.postId, mentionIds: result.mentionIds, createdAt: result.createdAt, notified: result.notified };
}

/** Removes a note: its author, or an editor and above. Visibility of the post is rechecked. */
export async function deletePostNote(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(NOTE_DELETE, input, undefined, errorText); exact(data.confirmation, deleteNoteConfirmation(data.noteId), errorText);
  const limit = await bounds();
  await authorizePublishing(actor, POSTS, 'write');
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    const rows = await tx.$queryRaw<Array<{ id: string; postId: string; authorId: string | null }>>`SELECT n.id, n."postId", n."authorId" FROM post_notes n JOIN posts p ON p.id = n."postId" WHERE n.id = ${data.noteId} AND p."workspaceId" = ${actor.workspaceId} FOR UPDATE OF n`;
    const note = rows[0];
    const notFound = () => new PublishingOperationError('not_found', 'collaboration_37', {}, errorText);
    if (!note) throw notFound();
    try { await visiblePost(tx, auth, note.postId); } catch { throw notFound(); }
    if (note.authorId !== actor.userId && !canModerate(auth)) throw notFound();
    await tx.$executeRaw`DELETE FROM post_notes WHERE id = ${note.id}`;
    await audit(tx, actor, 'publishing.post_note_deleted', { postId: note.postId, noteId: note.id, byAuthor: note.authorId === actor.userId });
    await lockActor(tx, actor, POSTS, true);
    return { id: note.id, deleted: true as const };
  }));
}
const canModerate = (auth: PublishingAuthorization) => isManager(auth.role);
