import { inboxServiceText } from './service-copy';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizeInbox } from './access';
import { assertInboxDeletionsSettled, lockInboxChannel } from './comment-guard';
import type { InboxReadActor } from './types';
import { confirmation, inboxItemSchema, productivityActionSchema } from '../productivity';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const invalid = async () => new OperationError('invalid_request', await inboxServiceText('service35'));
async function item(actor: InboxReadActor, channels: string[], value: z.infer<typeof inboxItemSchema>) {
  if (!channels.length) return null;
  if (value.kind === 'message') {
    const row = await prisma.conversation.findFirst({ where: { id: value.id, targetId: { in: channels }, target: { workspaceId: actor.workspaceId } }, select: { id: true, targetId: true, assigneeId: true } });
    return row && { ...row, kind: value.kind };
  }
  const row = await prisma.postComment.findFirst({ where: { id: value.id, parentRemoteId: null, postTarget: { targetId: { in: channels }, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } }, select: { id: true, assigneeId: true, postTarget: { select: { targetId: true } } } });
  return row && { id: row.id, assigneeId: row.assigneeId, targetId: row.postTarget.targetId, kind: value.kind };
}
async function limits() {
  const values = await Promise.all([
    runtimeConfig('inbox.noteMaxCharacters'), runtimeConfig('inbox.noteHistoryLimit'), runtimeConfig('inbox.savedReplyPageLimit'), runtimeConfig('inbox.savedReplyNameMaxCharacters'), runtimeConfig('inbox.savedReplyBodyMaxCharacters'), runtimeConfig('inbox.productivityAssigneeLimit'), runtimeConfig('inbox.savedReplyMaxCount'),
  ]);
  const checked = z.tuple([
    z.number().int().min(1).max(10000), z.number().int().min(1).max(1000), z.number().int().min(1).max(1000),
    z.number().int().min(1).max(500), z.number().int().min(1).max(10000), z.number().int().min(1).max(5000), z.number().int().min(1).max(5000),
  ]).safeParse(values);
  if (!checked.success) throw new OperationError('unavailable', await inboxServiceText('service36'));
  const [noteMaxCharacters, noteHistoryLimit, savedReplyPageLimit, savedReplyNameMaxCharacters, savedReplyBodyMaxCharacters, productivityAssigneeLimit, savedReplyMaxCount] = checked.data;
  return { noteMaxCharacters, noteHistoryLimit, savedReplyPageLimit, savedReplyNameMaxCharacters, savedReplyBodyMaxCharacters, productivityAssigneeLimit, savedReplyMaxCount };
}
async function timeout() {
  const values = await Promise.all([runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs')]);
  const checked = z.tuple([z.number().int().min(1000).max(60000), z.number().int().min(500).max(30000)]).safeParse(values);
  if (!checked.success) throw new OperationError('unavailable', await inboxServiceText('service36'));
  return { timeout: checked.data[0], maxWait: checked.data[1] };
}
async function lockActiveActor(tx: Prisma.TransactionClient, actor: InboxReadActor) {
  const rows = await tx.$queryRaw<Array<{ id: string; role: string }>>`SELECT m.id, m.role::text AS role FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL FOR SHARE OF m, u`;
  if (!rows[0]) throw new OperationError('forbidden', await inboxServiceText('service2'));
  return rows[0];
}
async function lockActorAndAssignee(tx: Prisma.TransactionClient, actor: InboxReadActor, assigneeId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; role: string }>>`SELECT m."userId" AS id, m.role::text AS role FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ANY(${[actor.userId, assigneeId]}::text[]) AND u."disabledAt" IS NULL ORDER BY u.id FOR SHARE OF m, u`;
  const actorMember = rows.find(row => row.id === actor.userId);
  if (!actorMember) throw new OperationError('forbidden', await inboxServiceText('service2'));
  const assignee = rows.find(row => row.id === assigneeId);
  if (!assignee || assignee.role === 'client') throw new OperationError('invalid_request', await inboxServiceText('service37'));
  return actorMember;
}
async function audit(tx: Prisma.TransactionClient, actor: InboxReadActor, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}
/** Credential ceiling for item-level authorization; undefined means every channel the member may use. */
const ceiling = (actor: InboxReadActor) => actor.allowedChannelIds === undefined ? {} : { allowedChannelIds: actor.allowedChannelIds };
/** Saved replies are workspace-wide text with no channel meaning, so a resource-limited credential cannot touch them. */
async function requireAllChannels(actor: InboxReadActor) {
  if (actor.allowedChannelIds !== undefined) throw new OperationError('forbidden', await inboxServiceText('service38'));
}
const safeDate =(value: unknown) => value instanceof Date ? value : new Date(String(value));

export async function readInboxProductivity(actor: InboxReadActor, input: unknown) {
  const parsed = inboxItemSchema.safeParse(input); if (!parsed.success) throw await invalid();
  const access = await authorizeInbox(actor, ceiling(actor), 'read');
  const row = await item(actor, access.channelIds, parsed.data);
  if (!row) throw new OperationError('not_found', await inboxServiceText('service7'));
  const cap = await limits();
  const [noteRows, teamRows, membership] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; authorId: string | null; authorName: string | null; body: string; createdAt: Date }>>(Prisma.sql`SELECT n.id, n."authorId", u.name AS "authorName", n.body, n."createdAt" FROM inbox_notes n LEFT JOIN users u ON u.id = n."authorId" WHERE n."workspaceId" = ${actor.workspaceId} AND n.kind = ${parsed.data.kind} AND n."itemId" = ${parsed.data.id} ORDER BY n."createdAt" DESC, n.id DESC LIMIT ${cap.noteHistoryLimit + 1}`),
    prisma.$queryRaw<Array<{ id: string; name: string | null }>>(Prisma.sql`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${actor.workspaceId} AND m.role::text <> 'client' AND u."disabledAt" IS NULL ORDER BY u.name, u.id LIMIT ${cap.productivityAssigneeLimit + 1}`),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
  ]);
  if (noteRows.length > cap.noteHistoryLimit || teamRows.length > cap.productivityAssigneeLimit) throw new OperationError('unavailable', await inboxServiceText('service39'));
  if (!membership) throw new OperationError('forbidden', await inboxServiceText('service2'));
  return { ok: true as const, kind: parsed.data.kind, id: parsed.data.id, assignment: { assigneeId: row.assigneeId, members: teamRows }, notes: noteRows.map(note => ({ id: note.id, authorId: note.authorId, authorName: note.authorName || 'Former teammate', body: note.body, createdAt: safeDate(note.createdAt), canDelete: note.authorId === actor.userId || membership.role === 'owner' || membership.role === 'admin' })), limits: cap };
}

export async function listSavedReplies(actor: InboxReadActor, input: unknown = {}) {
  const parsed = z.object({ offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().positive().max(1000).optional(), q: z.string().trim().max(200).default('') }).strict().safeParse(input);
  if (!parsed.success) throw await invalid();
  await requireAllChannels(actor);
  await authorizeInbox(actor, {}, 'read');
  const { savedReplyPageLimit, savedReplyMaxCount, savedReplyNameMaxCharacters, savedReplyBodyMaxCharacters } = await limits();
  const limit = Math.min(parsed.data.limit ?? savedReplyPageLimit, savedReplyPageLimit);
  const q = `%${parsed.data.q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; body: string; createdAt: Date; updatedAt: Date }>>(Prisma.sql`SELECT id, name, body, "createdAt", "updatedAt" FROM saved_replies WHERE "workspaceId" = ${actor.workspaceId} AND (${parsed.data.q} = '' OR name ILIKE ${q} ESCAPE '\\' OR body ILIKE ${q} ESCAPE '\\') ORDER BY name, id OFFSET ${parsed.data.offset} LIMIT ${limit + 1}`),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) AS count FROM saved_replies WHERE "workspaceId" = ${actor.workspaceId}`),
  ]);
  const hasMore = rows.length > limit;
  // total counts every saved reply of the workspace (not only this search) so screens can show usage against maxCount.
  return { ok: true as const, replies: rows.slice(0, limit), offset: parsed.data.offset, limit, nextOffset: hasMore ? parsed.data.offset + limit : null, total: Number(counted[0]?.count ?? 0), maxCount: savedReplyMaxCount, limits: { nameMaxCharacters: savedReplyNameMaxCharacters, bodyMaxCharacters: savedReplyBodyMaxCharacters } };
}

export async function performInboxProductivityAction(actor: InboxReadActor, input: unknown) {
  const parsed = productivityActionSchema.safeParse(input); if (!parsed.success) throw await invalid();
  const value = parsed.data; const cap = await limits();
  if (value.action === 'assign' && value.confirmation !== confirmation.assign(value.kind, value.id, value.assigneeId)) throw await invalid();
  if (value.action === 'note.add' && (value.body.length > cap.noteMaxCharacters || value.confirmation !== confirmation.addNote(value.kind, value.id))) throw await invalid();
  if (value.action === 'note.delete' && value.confirmation !== confirmation.deleteNote(value.id)) throw await invalid();
  if (value.action === 'reply.create' && (value.name.length > cap.savedReplyNameMaxCharacters || value.body.length > cap.savedReplyBodyMaxCharacters || value.confirmation !== confirmation.createReply(value.name))) throw await invalid();
  if (value.action === 'reply.update' && (value.name.length > cap.savedReplyNameMaxCharacters || value.body.length > cap.savedReplyBodyMaxCharacters || value.confirmation !== confirmation.updateReply(value.id))) throw await invalid();
  if (value.action === 'reply.delete' && value.confirmation !== confirmation.deleteReply(value.id)) throw await invalid();
  if (value.action.startsWith('reply.')) await requireAllChannels(actor);
  const access = await authorizeInbox(actor, ceiling(actor), 'write');
  if ('kind' in value && 'id' in value) {
    const target = await item(actor, access.channelIds, value);
    if (!target) throw new OperationError('not_found', await inboxServiceText('service7'));
    return withWorkspaceOperation(actor.workspaceId, async () => {
      const fresh = await authorizeInbox(actor, ceiling(actor), 'write');
      const current = await item(actor, fresh.channelIds, value);
      if (!current) throw new OperationError('not_found', await inboxServiceText('service7'));
      const t = await timeout();
      return prisma.$transaction(async tx => {
        await lockInboxChannel(tx, actor.workspaceId, current.targetId);
        if (value.action === 'assign') {
          if (value.assigneeId) await lockActorAndAssignee(tx, actor, value.assigneeId);
          else await lockActiveActor(tx, actor);
          const changed = value.kind === 'message'
            ? await tx.conversation.updateMany({ where: { id: value.id, targetId: current.targetId, target: { workspaceId: actor.workspaceId } }, data: { assigneeId: value.assigneeId } })
            : await tx.postComment.updateMany({ where: { id: value.id, parentRemoteId: null, postTarget: { targetId: current.targetId, target: { workspaceId: actor.workspaceId }, post: { workspaceId: actor.workspaceId } } }, data: { assigneeId: value.assigneeId } });
          if (!changed.count) throw new OperationError('not_found', await inboxServiceText('service7'));
          await audit(tx, actor, 'inbox.assignment_changed', { kind: value.kind, itemId: value.id, targetId: current.targetId, assigneeId: value.assigneeId });
          return { ok: true as const, action: value.action, kind: value.kind, id: value.id, assigneeId: value.assigneeId };
        }
        await lockActiveActor(tx, actor);
        await assertInboxDeletionsSettled(tx, actor.workspaceId, [current.targetId]);
        const noteId = randomUUID();
        const inserted = await tx.$executeRaw`INSERT INTO inbox_notes (id, "workspaceId", kind, "itemId", "authorId", body, "createdAt") VALUES (${noteId}, ${actor.workspaceId}, ${value.kind}, ${value.id}, ${actor.userId}, ${value.body}, NOW())`;
        if (!inserted) throw new OperationError('unavailable', await inboxServiceText('service40'));
        await audit(tx, actor, 'inbox.private_note_added', { kind: value.kind, itemId: value.id, targetId: current.targetId, noteId });
        return { ok: true as const, action: value.action, id: noteId };
      }, t);
    });
  }
  if (value.action === 'note.delete') {
    const notes = await prisma.$queryRaw<Array<{ id: string; kind: string; itemId: string; authorId: string | null }>>(Prisma.sql`SELECT id, kind, "itemId", "authorId" FROM inbox_notes WHERE id=${value.id} AND "workspaceId"=${actor.workspaceId}`);
    const note = notes[0]; if (!note || !['message','comment'].includes(note.kind) || !idSchema.safeParse(note.itemId).success) throw new OperationError('not_found', await inboxServiceText('service41'));
    const current = await item(actor, access.channelIds, { kind: note.kind as 'message'|'comment', id: note.itemId });
    if (!current) throw new OperationError('not_found', await inboxServiceText('service41'));
    return withWorkspaceOperation(actor.workspaceId, async () => {
      const fresh = await authorizeInbox(actor, ceiling(actor), 'write');
      const checked = await item(actor, fresh.channelIds, { kind: note.kind as 'message'|'comment', id: note.itemId });
      if (!checked) throw new OperationError('not_found', await inboxServiceText('service41'));
      const t = await timeout();
      return prisma.$transaction(async tx => {
        await lockInboxChannel(tx, actor.workspaceId, checked.targetId);
        const { role } = await lockActiveActor(tx, actor);
        const currentNoteRows = await tx.$queryRaw<Array<{ authorId: string | null; kind: string; itemId: string }>>`SELECT "authorId", kind, "itemId" FROM inbox_notes WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
        const currentNote = currentNoteRows[0];
        if (!currentNote || currentNote.kind !== note.kind || currentNote.itemId !== note.itemId) throw new OperationError('not_found', await inboxServiceText('service41'));
        if (currentNote.authorId !== actor.userId && role !== 'owner' && role !== 'admin') throw new OperationError('forbidden', await inboxServiceText('service42'));
        await assertInboxDeletionsSettled(tx, actor.workspaceId, [checked.targetId]);
        const changed = await tx.$executeRaw`DELETE FROM inbox_notes WHERE id=${value.id} AND "workspaceId"=${actor.workspaceId} AND kind=${currentNote.kind} AND "itemId"=${currentNote.itemId} AND "authorId" IS NOT DISTINCT FROM ${currentNote.authorId}`;
        if (!changed) throw new OperationError('not_found', await inboxServiceText('service41'));
        await audit(tx, actor, 'inbox.private_note_deleted', { kind: note.kind, itemId: note.itemId, targetId: checked.targetId, noteId: value.id });
        return { ok: true as const, action: value.action, id: value.id };
      }, t);
    });
  }
  return withWorkspaceOperation(actor.workspaceId, async () => {
    await authorizeInbox(actor, {}, 'write'); const t = await timeout();
    return prisma.$transaction(async tx => {
      await lockActiveActor(tx, actor);
      let id: string;
      if (value.action === 'reply.create') {
        // Serialize creators per workspace so concurrent requests cannot both pass the count check.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`saved_replies:${actor.workspaceId}`}))`;
        const existing = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM saved_replies WHERE "workspaceId" = ${actor.workspaceId}`;
        if (Number(existing[0]?.count ?? 0) >= cap.savedReplyMaxCount) throw new OperationError('conflict', await inboxServiceText('savedReplyLimit', { limit: cap.savedReplyMaxCount }));
        id = randomUUID();
        const inserted = await tx.$executeRaw`INSERT INTO saved_replies (id, "workspaceId", name, body, "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${value.name}, ${value.body}, NOW(), NOW())`;
        if (!inserted) throw new OperationError('unavailable', await inboxServiceText('service43'));
      } else {
        id = value.id;
        const exists = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM saved_replies WHERE id=${value.id} AND "workspaceId"=${actor.workspaceId} FOR UPDATE`;
        if (!exists.length) throw new OperationError('not_found', await inboxServiceText('service44'));
        const changed = value.action === 'reply.update'
          ? await tx.$executeRaw`UPDATE saved_replies SET name=${value.name}, body=${value.body}, "updatedAt"=NOW() WHERE id=${value.id} AND "workspaceId"=${actor.workspaceId}`
          : await tx.$executeRaw`DELETE FROM saved_replies WHERE id=${value.id} AND "workspaceId"=${actor.workspaceId}`;
        if (!changed) throw new OperationError('not_found', await inboxServiceText('service44'));
      }
      await audit(tx, actor, `inbox.${value.action.replace('.', '_')}`, { replyId: id });
      return { ok: true as const, action: value.action, id };
    }, t);
  });
}
