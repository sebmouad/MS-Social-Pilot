import { inboxServiceText } from './service-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizeInbox } from './access';
import { INBOX_SAVED_VIEW_BOUNDS, INBOX_SAVED_VIEW_CREATE_SCHEMA, INBOX_SAVED_VIEW_DELETE_SCHEMA, INBOX_SAVED_VIEW_PATH, INBOX_SAVED_VIEW_SCREEN, deleteInboxSavedViewConfirmation, normalizeInboxSavedViewQuery, type InboxSavedViewRecord } from '../saved-views';
import type { InboxReadActor } from './types';

/**
 * Personal Inbox saved views (triage filters). Each view belongs to one user
 * in one workspace; reads and writes are always constrained by both. Saving
 * only requires Inbox read access, because a view stores the viewer's own
 * filters and grants nothing.
 */
type Row = { id: string; name: string; query: string; createdAt: Date };
const bad = async () => new OperationError('invalid_request', await inboxServiceText('service3'));
const toRecord = (row: Row): InboxSavedViewRecord => {
  const query = normalizeInboxSavedViewQuery(row.query) ?? '';
  return { id: row.id, name: row.name, query, href: query ? `${INBOX_SAVED_VIEW_PATH}?${query}` : INBOX_SAVED_VIEW_PATH, createdAt: row.createdAt.toISOString() };
};
async function protect<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('unavailable', await inboxServiceText('service4')); }
}

export async function listInboxSavedViews(actor: InboxReadActor): Promise<{ views: InboxSavedViewRecord[] }> {
  await authorizeInbox(actor);
  const rows = await protect(() => prisma.$queryRaw<Row[]>`SELECT id, name, query, "createdAt" FROM saved_views WHERE "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} AND screen = ${INBOX_SAVED_VIEW_SCREEN} ORDER BY lower(name), id LIMIT ${INBOX_SAVED_VIEW_BOUNDS.maxPerScreen}`);
  return { views: rows.map(toRecord) };
}

export async function createInboxSavedView(actor: InboxReadActor, input: unknown): Promise<{ view: InboxSavedViewRecord }> {
  const parsed = INBOX_SAVED_VIEW_CREATE_SCHEMA.safeParse(input);
  if (!parsed.success) throw await bad();
  const normalized = normalizeInboxSavedViewQuery(parsed.data.query);
  if (normalized === null) throw await bad();
  const access = await authorizeInbox(actor);
  void access;
  return protect(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`inbox-saved-views:${actor.workspaceId}:${actor.userId}`}))::text`;
    const counted = await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM saved_views WHERE "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} AND screen = ${INBOX_SAVED_VIEW_SCREEN}`;
    if (Number(counted[0]?.count ?? 0) >= INBOX_SAVED_VIEW_BOUNDS.maxPerScreen) throw new OperationError('conflict', await inboxServiceText('service3'));
    const id = randomUUID();
    const rows = await tx.$queryRaw<Row[]>`INSERT INTO saved_views (id, "workspaceId", "userId", name, screen, query, "createdAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${parsed.data.name}, ${INBOX_SAVED_VIEW_SCREEN}, ${normalized}, NOW()) RETURNING id, name, query, "createdAt"`;
    if (!rows[0]) throw new OperationError('unavailable', await inboxServiceText('service4'));
    return { view: toRecord(rows[0]) };
  }));
}

export async function deleteInboxSavedView(actor: InboxReadActor, input: unknown): Promise<{ id: string; deleted: true }> {
  const parsed = INBOX_SAVED_VIEW_DELETE_SCHEMA.safeParse(input);
  if (!parsed.success) throw await bad();
  if (parsed.data.confirmation !== deleteInboxSavedViewConfirmation(parsed.data.id)) throw await bad();
  await authorizeInbox(actor);
  const removed = await protect(() => prisma.$executeRaw`DELETE FROM saved_views WHERE id = ${parsed.data.id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} AND screen = ${INBOX_SAVED_VIEW_SCREEN}`);
  if (removed !== 1) throw new OperationError('not_found', await inboxServiceText('service7'));
  return { id: parsed.data.id, deleted: true as const };
}
