
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { authorizePublishing } from '../../server/access';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from '../../server/read-scope';
import type { PublishingActor, PublishingAuthorization, PublishingFeature } from '../../server/types';
import { COLLAB_KEYS, COLLAB_CONFIG, type CollabBounds } from '../config';

export type Tx = Prisma.TransactionClient;
export const POSTS = 'publishing/collaboration' as const;
export const QUEUE = 'publishing/queue' as const;
export const bad = (message: string | undefined = undefined, errorText: PublishingErrorText = defaultPublishingErrorText) => {
  message ??= errorText('collaboration_57');
return new OperationError('invalid_request', message); };
export const unavailable = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('unavailable', 'collaboration_12', {}, errorText);
export const missingPost = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('not_found', 'collaboration_13', {}, errorText);
export const parse = <S extends import('zod').ZodTypeAny>(schema: S, input: unknown, message?: string, errorText: PublishingErrorText = defaultPublishingErrorText): import('zod').output<S> => {
  const result = schema.safeParse(input);
  if (!result.success) throw bad(message, errorText);
  return result.data;
};
export function exact(actual: string, expected: string, errorText: PublishingErrorText = defaultPublishingErrorText) { if (actual !== expected) throw bad(errorText('collaboration_14'), errorText); }
export const isUnique = (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && ((error as { code?: unknown }).code === 'P2002' || (error as { code?: unknown }).code === '23505'));
export async function protect<T>(operation: Promise<T>, fallback: string | undefined = undefined): Promise<T> {
  const errorText = await loadPublishingErrorText();
  fallback ??= errorText('collaboration_58');
  try { return await operation; } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', fallback); }
}

/** Live Root-managed bounds. Any missing or invalid value makes the feature unavailable rather than guessing. */
export async function bounds(): Promise<CollabBounds> {
  const errorText = await loadPublishingErrorText();
  try {
    const [values, workspaceTimeout] = await Promise.all([
      Promise.all(COLLAB_CONFIG.map(item => runtimeConfig(item.key))), runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    const out: Record<string, number> = {};
    COLLAB_CONFIG.forEach((item, index) => { const parsed = item.schema.safeParse(values[index]); if (!parsed.success) throw unavailable(errorText); out[COLLAB_KEYS[index]!] = parsed.data as number; });
    if (typeof workspaceTimeout !== 'number' || out.transactionTimeoutMs! + out.transactionMaxWaitMs! >= workspaceTimeout) throw unavailable(errorText);
    return out as CollabBounds;
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(errorText); }
}

export async function transact<T>(workspaceId: string, limit: CollabBounds, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: limit.transactionTimeoutMs, maxWait: limit.transactionMaxWaitMs }));
}

/** Locks membership and user, then re-reads current authority inside the transaction. */
export async function lockActor(tx: Tx, actor: PublishingActor, feature: PublishingFeature, write: boolean): Promise<PublishingAuthorization> {
  const errorText = await loadPublishingErrorText();
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  const state = rows[0];
  if (!state || state.disabledAt) throw new PublishingOperationError('unauthorized', 'collaboration_15', {}, errorText);
  return authorizePublishing(actor, feature, write ? 'write' : 'read');
}

export async function audit(tx: Tx, actor: PublishingActor, action: string, detail: object) {
  const errorText = await loadPublishingErrorText();
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw unavailable(errorText);
}

const MANAGERS = new Set(['owner', 'admin', 'editor']);
export const isManager = (role: string) => MANAGERS.has(role);
export const isAdmin = (role: string) => role === 'owner' || role === 'admin';
/** Workspace-wide settings (field definitions, shared timetables, group mix) need an admin who sees every channel. */
export function requireWorkspaceAdmin(auth: PublishingAuthorization, what: string, errorText: PublishingErrorText = defaultPublishingErrorText) {
  if (!isAdmin(auth.role)) throw new PublishingOperationError('forbidden', 'collaboration_16', {value0: what}, errorText);
  if (!auth.permissions.pageScope.all) throw new PublishingOperationError('forbidden', 'collaboration_17', {value0: what}, errorText);
}

export type VisiblePost = { id: string; authorId: string; status: string; scheduledAt: Date | null };
/** A post the caller may see right now (whole-post visibility: mixed-destination posts are hidden in full). */
export async function visiblePost(tx: Tx | typeof prisma, auth: PublishingAuthorization, postId: string, lock = false): Promise<VisiblePost> {
  const errorText = await loadPublishingErrorText();
  const { actor, role } = auth;
  const selected = await selectedPublishingTargetIds(actor.workspaceId, auth.entitlements, actor.allowedTargetIds);
  const own = actor.allowedTargetIds !== undefined || role === 'contributor' ? actor.userId : undefined;
  const post = await tx.post.findFirst({ where: { id: postId, ...publishingPostVisibilityWhere(actor.workspaceId, selected, own) }, select: { id: true, authorId: true, status: true, scheduledAt: true } });
  if (!post) throw missingPost(errorText);
  if (lock) await (tx as Tx).$queryRaw`SELECT id FROM posts WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
  return { id: post.id, authorId: post.authorId, status: String(post.status), scheduledAt: post.scheduledAt };
}
/** Managers change any visible post; contributors only their own. Read-only roles are stopped by the write permission. */
export function assertMayEdit(auth: PublishingAuthorization, post: VisiblePost, errorText: PublishingErrorText = defaultPublishingErrorText) {
  if (isManager(auth.role) || (auth.role === 'contributor' && post.authorId === auth.actor.userId)) return;
  throw new PublishingOperationError('forbidden', 'collaboration_18', {}, errorText);
}
/** Channels the caller can use for timetables, mixes and reports. */
export async function usableTargets(auth: PublishingAuthorization): Promise<Array<{ id: string; name: string; type: string }>> {
  const ids = await selectedPublishingTargetIds(auth.actor.workspaceId, auth.entitlements, auth.actor.allowedTargetIds);
  if (!ids.length) return [];
  return prisma.$queryRaw<Array<{ id: string; name: string; type: string }>>`SELECT id, name, type::text AS type FROM targets WHERE "workspaceId" = ${auth.actor.workspaceId} AND id = ANY(${ids}::text[]) ORDER BY name ASC, id ASC`;
}
export const pageOffset = (page: number | undefined, size: number) => ((page ?? 1) - 1) * size;
