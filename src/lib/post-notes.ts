/**
 * Internal notes on posts (NEXT_PHASES H8): a team-only thread under each
 * post, never published. A note can @mention members who may see the post,
 * and they are emailed.
 */
import { z } from 'zod';
import type { WorkspaceRole } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { canManageOthersPosts, postIsEditable } from './constants';
import { errors } from './errors';
import { assertPostInScope, mayUsePage, scopeOf, type PageScope } from './page-access';
import { mentionedIn, NOTE_MAX } from './mentions';
import { notifyNoteMention } from './email/notify';

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(NOTE_MAX),
  mentionIds: z.array(z.string()).max(20).default([]),
});

export interface PostNoteView {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

/** Members who may see every Page the post goes to: who a note may mention. */
export async function postMembers(workspaceId: string, postId: string): Promise<Array<{ id: string; name: string }>> {
  const [targets, memberships] = await Promise.all([
    prisma.postTarget.findMany({ where: { postId }, select: { targetId: true } }),
    prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true } }, pages: { select: { targetId: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);
  return memberships
    .filter((membership) => targets.every((target) => mayUsePage(scopeOf(membership), target.targetId)))
    .map((membership) => membership.user);
}

export async function listNotes(postId: string): Promise<PostNoteView[]> {
  const rows = await prisma.postNote.findMany({
    where: { postId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { author: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Add a note and email the members it mentions (never its author). */
export async function addNote(options: {
  workspaceId: string;
  postId: string;
  author: { id: string; name: string };
  input: z.infer<typeof noteSchema>;
}): Promise<PostNoteView> {
  const members = await postMembers(options.workspaceId, options.postId);
  const mentionIds = mentionedIn(options.input.body, members, options.input.mentionIds).filter((id) => id !== options.author.id);
  const note = await prisma.postNote.create({
    data: { postId: options.postId, authorId: options.author.id, body: options.input.body, mentionIds },
  });

  const post = await prisma.post.findUnique({
    where: { id: options.postId },
    select: { status: true, targets: { select: { status: true } } },
  });
  const url = post && postIsEditable(post) ? `${env.appUrl}/compose?post=${options.postId}` : `${env.appUrl}/posts`;
  await notifyNoteMention({ workspaceId: options.workspaceId, userIds: mentionIds, authorName: options.author.name, note: note.body, url });

  return { id: note.id, body: note.body, authorId: note.authorId, authorName: options.author.name, createdAt: note.createdAt.toISOString() };
}

/** Remove a note: its author, or an editor and up. */
export async function deleteNote(options: {
  workspaceId: string;
  pageScope: PageScope;
  noteId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const note = await prisma.postNote.findFirst({
    where: { id: options.noteId, post: { workspaceId: options.workspaceId } },
    select: { authorId: true, postId: true },
  });
  if (!note) throw errors.notFound();
  await assertPostInScope(options.pageScope, options.workspaceId, note.postId);
  if (note.authorId !== options.userId && !canManageOthersPosts(options.role)) throw errors.notFound();
  await prisma.postNote.delete({ where: { id: options.noteId } });
}
