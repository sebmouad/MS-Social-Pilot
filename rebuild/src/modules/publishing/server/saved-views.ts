import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from './access';
import { SAVED_VIEW_BOUNDS, SAVED_VIEW_CREATE_SCHEMA, SAVED_VIEW_DELETE_SCHEMA, SAVED_VIEW_LIST_SCHEMA, SAVED_VIEW_PATHS, deleteSavedViewConfirmation, normalizeSavedViewQuery, type SavedViewRecord, type SavedViewScreen } from '../saved-views';
import type { PublishingActor } from './types';

/**
 * Personal saved views. Each view belongs to one user in one workspace; reads and
 * writes are always constrained by both. Saving only requires read access to the
 * screen, because a view stores the viewer's own filters and grants nothing.
 */
type Row = { id: string; name: string; screen: string; query: string; createdAt: Date };
const FEATURE: Record<SavedViewScreen, 'publishing/posts' | 'publishing/calendar'> = { posts: 'publishing/posts', calendar: 'publishing/calendar' };
const bad = (message = 'Choose a valid saved view name and filters.') => new OperationError('invalid_request', message);
const parse = <T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw bad();
  return result.data;
};
const toRecord = (row: Row): SavedViewRecord => {
  const screen = row.screen as SavedViewScreen;
  const query = normalizeSavedViewQuery(screen, row.query) ?? '';
  return { id: row.id, name: row.name, screen, query, href: query ? `${SAVED_VIEW_PATHS[screen]}?${query}` : SAVED_VIEW_PATHS[screen], createdAt: row.createdAt.toISOString() };
};
async function protect<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
  try { return await operation(); } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('unavailable', fallback); }
}

export async function listSavedViews(actor: PublishingActor, input: unknown): Promise<{ views: SavedViewRecord[] }> {
  const { screen } = parse(SAVED_VIEW_LIST_SCHEMA, input);
  const auth = await authorizePublishing(actor, FEATURE[screen], 'read');
  const rows = await protect(() => prisma.$queryRaw<Row[]>`SELECT id, name, screen, query, "createdAt" FROM saved_views WHERE "workspaceId" = ${auth.actor.workspaceId} AND "userId" = ${auth.actor.userId} AND screen = ${screen} ORDER BY lower(name), id LIMIT ${SAVED_VIEW_BOUNDS.maxPerScreen}`, 'Saved views are temporarily unavailable.');
  return { views: rows.map(toRecord) };
}

export async function createSavedView(actor: PublishingActor, input: unknown): Promise<{ view: SavedViewRecord }> {
  const { screen, name, query } = parse(SAVED_VIEW_CREATE_SCHEMA, input);
  const normalized = normalizeSavedViewQuery(screen, query);
  if (normalized === null) throw bad('These filters cannot be saved. Reset the filters and try again.');
  const auth = await authorizePublishing(actor, FEATURE[screen], 'read');
  const { workspaceId, userId } = auth.actor;
  return protect(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`saved-views:${workspaceId}:${userId}`}))::text`;
    const counted = await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM saved_views WHERE "workspaceId" = ${workspaceId} AND "userId" = ${userId} AND screen = ${screen}`;
    if (Number(counted[0]?.count ?? 0) >= SAVED_VIEW_BOUNDS.maxPerScreen) throw new OperationError('conflict', 'You have reached the saved view limit for this screen. Remove one first.');
    const id = randomUUID();
    const rows = await tx.$queryRaw<Row[]>`INSERT INTO saved_views (id, "workspaceId", "userId", name, screen, query, "createdAt") VALUES (${id}, ${workspaceId}, ${userId}, ${name}, ${screen}, ${normalized}, NOW()) RETURNING id, name, screen, query, "createdAt"`;
    if (!rows[0]) throw new OperationError('unavailable', 'The view could not be saved.');
    return { view: toRecord(rows[0]) };
  }), 'The view could not be saved. Refresh and try again.');
}

export async function deleteSavedView(actor: PublishingActor, input: unknown): Promise<{ deleted: true; id: string }> {
  const { id, confirmation } = parse(SAVED_VIEW_DELETE_SCHEMA, input);
  if (confirmation !== deleteSavedViewConfirmation(id)) throw bad('Confirm the exact saved view removal.');
  const owned = await protect(() => prisma.$queryRaw<Array<{ screen: string }>>`SELECT screen FROM saved_views WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId}`, 'Saved views are temporarily unavailable.');
  const screen = owned[0]?.screen as SavedViewScreen | undefined;
  if (!screen || !(screen in FEATURE)) throw new OperationError('not_found', 'This saved view is unavailable.');
  const auth = await authorizePublishing(actor, FEATURE[screen], 'read');
  const count = await protect(() => prisma.$executeRaw`DELETE FROM saved_views WHERE id = ${id} AND "workspaceId" = ${auth.actor.workspaceId} AND "userId" = ${auth.actor.userId}`, 'The view could not be removed.');
  if (count !== 1) throw new OperationError('not_found', 'This saved view is unavailable.');
  return { deleted: true, id };
}
