import { prisma } from './prisma';
import type { InboxKind } from './inbox';

/**
 * Private notes on inbox items, for the team only. A note is reachable only
 * through an item on a Page the caller may see.
 */

interface Scope {
  workspaceId: string;
  /** The Pages the caller may see. */
  targetIds: string[];
}

async function itemVisible(scope: Scope, kind: InboxKind, id: string): Promise<boolean> {
  if (kind === 'comment') {
    return (
      (await prisma.postComment.count({
        where: { id, postTarget: { targetId: { in: scope.targetIds }, post: { workspaceId: scope.workspaceId } } },
      })) > 0
    );
  }
  return (await prisma.conversation.count({ where: { id, targetId: { in: scope.targetIds }, target: { workspaceId: scope.workspaceId } } })) > 0;
}

export async function listInboxNotes(scope: Scope & { kind: InboxKind; id: string }) {
  if (!(await itemVisible(scope, scope.kind, scope.id))) return null;
  const notes = await prisma.inboxNote.findMany({
    where: { workspaceId: scope.workspaceId, kind: scope.kind, itemId: scope.id },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return notes.map((note) => ({ id: note.id, body: note.body, author: note.author?.name ?? '', authorId: note.authorId, createdAt: note.createdAt }));
}

export async function addInboxNote(scope: Scope & { kind: InboxKind; id: string; authorId: string; body: string }): Promise<boolean> {
  if (!(await itemVisible(scope, scope.kind, scope.id))) return false;
  await prisma.inboxNote.create({
    data: { workspaceId: scope.workspaceId, kind: scope.kind, itemId: scope.id, authorId: scope.authorId, body: scope.body.trim() },
  });
  return true;
}

/** How many notes each item has, for the badge on the list. */
export async function countInboxNotes(workspaceId: string, items: Array<{ kind: InboxKind; id: string }>): Promise<Map<string, number>> {
  if (items.length === 0) return new Map();
  const rows = await prisma.inboxNote.groupBy({
    by: ['kind', 'itemId'],
    where: { workspaceId, itemId: { in: items.map((item) => item.id) } },
    _count: true,
  });
  return new Map(rows.map((row) => [`${row.kind}:${row.itemId}`, row._count]));
}

/** Delete a note: its author may, and so may anyone who can manage the team. */
export async function deleteInboxNote(options: { workspaceId: string; id: string; userId: string; manager: boolean }): Promise<boolean> {
  const { count } = await prisma.inboxNote.deleteMany({
    where: { id: options.id, workspaceId: options.workspaceId, ...(options.manager ? {} : { authorId: options.userId }) },
  });
  return count > 0;
}
