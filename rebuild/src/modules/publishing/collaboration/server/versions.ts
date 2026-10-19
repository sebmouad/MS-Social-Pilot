import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { COLLAB_CONFIG } from '../config';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { collaborationPorts, type VersionSnapshot } from '../ports';
import { restoreVersionConfirmation, VERSION_LIST, VERSION_RESTORE } from '../schemas';
import { assertMayEdit, audit, bounds, exact, lockActor, pageOffset, parse, POSTS, protect, transact, visiblePost } from './core';
import type { Tx } from './core';

/** Consume the same typed policy Root validates, without duplicating its bounds. */
export async function loadVersionRetention(): Promise<number> {
  const definition = COLLAB_CONFIG.find(item => item.key === 'publishing.collab.versionRetention');
  if (!definition) throw new OperationError('unavailable', 'Version history is temporarily unavailable.');
  const value = await runtimeConfig(definition.key);
  if (!definition.schema.safeParse(value).success || typeof value !== 'number') throw new OperationError('unavailable', 'Version history is temporarily unavailable.');
  return value;
}

export type PostVersionRecord = {
  id: string; postId: string; authorId: string | null; authorName: string | null; createdAt: Date; message: string; firstComment: string | null; firstCommentDelayMinutes: number;
  link: string | null; media: unknown; format: string; destinationFormats: Record<string, string>; targetIds: string[]; labelIds: string[]; scheduledAt: Date | null; timezone: string;
};
/** Statuses where content is final or in flight; the lifecycle port makes the final decision for all others. */
const LOCKED_STATUSES = new Set(['published', 'publishing', 'partially_failed', 'cancelled', 'scheduled']);

export async function readPostVersions(actor: PublishingActor, input: unknown) {
  const query = parse(VERSION_LIST, input);
  const limit = await bounds();
  const auth = await authorizePublishing(actor, POSTS, 'read');
  const post = await visiblePost(prisma, auth, query.postId);
  const page = query.page ?? 1;
  const rows = await protect(prisma.$queryRaw<PostVersionRecord[]>`SELECT v.id, v."postId", v."authorId", u.name AS "authorName", v."createdAt", v.message, v."firstComment", v."firstCommentDelayMinutes", v.link, v.media, v.format, v."destinationFormats", v."targetIds", v."labelIds", v."scheduledAt", v.timezone FROM post_versions v JOIN posts p ON p.id = v."postId" LEFT JOIN users u ON u.id = v."authorId" WHERE v."postId" = ${query.postId} AND p."workspaceId" = ${actor.workspaceId} ORDER BY v."createdAt" DESC, v.id DESC LIMIT ${limit.versionPageSize + 1} OFFSET ${pageOffset(page, limit.versionPageSize)}`);
  return { postId: query.postId, restorable: !LOCKED_STATUSES.has(post.status), versions: rows.slice(0, limit.versionPageSize), page, pageSize: limit.versionPageSize, hasMore: rows.length > limit.versionPageSize };
}

/**
 * Helper for server/publishing/lifecycle.ts: record the post as it stands now inside the lifecycle transaction.
 * Skips the write when nothing changed since the latest version; prunes beyond the retention bound.
 */
export async function recordPostVersion(tx: Tx, postId: string, authorId: string | null, retention: number): Promise<boolean> {
  if (!Number.isSafeInteger(retention) || retention < 1) throw new OperationError('unavailable', 'Version history is temporarily unavailable.');
  const inserted = await tx.$executeRaw`
    INSERT INTO post_versions (id, "postId", "authorId", "createdAt", message, "firstComment", "firstCommentDelayMinutes", link, media, format, "destinationFormats", "targetIds", "labelIds", "scheduledAt", timezone)
    SELECT 'ver_' || gen_random_uuid()::text, p.id, ${authorId},
      GREATEST(clock_timestamp(), COALESCE((SELECT MAX("createdAt") + interval '1 millisecond' FROM post_versions WHERE "postId" = p.id), clock_timestamp())), p.message, p."firstComment", p."firstCommentDelayMinutes", p.link, p.media, p.format,
      COALESCE((SELECT jsonb_object_agg(t."targetId", COALESCE(t."formatId", p.format)) FROM post_targets t WHERE t."postId" = p.id), '{}'::jsonb),
      COALESCE((SELECT array_agg(t."targetId" ORDER BY t."targetId") FROM post_targets t WHERE t."postId" = p.id), ARRAY[]::text[]),
      COALESCE((SELECT array_agg(l."labelId" ORDER BY l."labelId") FROM post_labels l WHERE l."postId" = p.id), ARRAY[]::text[]),
      p."scheduledAt", p.timezone
    FROM posts p WHERE p.id = ${postId}
      AND NOT EXISTS (
        SELECT 1 FROM post_versions prev WHERE prev."postId" = p.id AND prev.id = (SELECT id FROM post_versions WHERE "postId" = p.id ORDER BY "createdAt" DESC, id DESC LIMIT 1)
          AND prev."firstCommentDelayMinutes" = p."firstCommentDelayMinutes" AND prev.message = p.message AND prev."firstComment" IS NOT DISTINCT FROM p."firstComment" AND prev.link IS NOT DISTINCT FROM p.link
          AND prev.media IS NOT DISTINCT FROM p.media AND prev.format = p.format AND prev.timezone = p.timezone AND prev."scheduledAt" IS NOT DISTINCT FROM p."scheduledAt"
          AND prev."targetIds" = COALESCE((SELECT array_agg(t."targetId" ORDER BY t."targetId") FROM post_targets t WHERE t."postId" = p.id), ARRAY[]::text[])
          AND prev."destinationFormats" IS NOT DISTINCT FROM COALESCE((SELECT jsonb_object_agg(t."targetId", COALESCE(t."formatId", p.format)) FROM post_targets t WHERE t."postId" = p.id), '{}'::jsonb)
          AND prev."labelIds" = COALESCE((SELECT array_agg(l."labelId" ORDER BY l."labelId") FROM post_labels l WHERE l."postId" = p.id), ARRAY[]::text[]))`;
  if (inserted > 0) await tx.$executeRaw`DELETE FROM post_versions WHERE "postId" = ${postId} AND id IN (SELECT id FROM post_versions WHERE "postId" = ${postId} ORDER BY "createdAt" DESC, id DESC OFFSET ${retention})`;
  return inserted > 0;
}

/**
 * Asks the publishing lifecycle to apply an earlier version as an ordinary save. This service checks the caller,
 * the post and the version; the lifecycle owns content validation, destination checks, approval reset and the new version.
 * Without a registered lifecycle port the request is refused and nothing changes.
 */
export async function requestVersionRestore(actor: PublishingActor, input: unknown) {
  const data = parse(VERSION_RESTORE, input); exact(data.confirmation, restoreVersionConfirmation(data.versionId));
  const port = collaborationPorts().versions;
  if (!port) throw new OperationError('unavailable', 'Restoring earlier versions is not available yet.');
  const limit = await bounds();
  await authorizePublishing(actor, POSTS, 'write');
  const snapshot = await protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, POSTS, true);
    const post = await visiblePost(tx, auth, data.postId, true);
    assertMayEdit(auth, post);
    if (LOCKED_STATUSES.has(post.status)) throw new OperationError('conflict', 'This post can no longer be edited, so an earlier version cannot be restored.');
    const rows = await tx.$queryRaw<Array<Omit<VersionSnapshot, 'versionId'> & { id: string; currentFormat: string }>>`SELECT p.format AS "currentFormat", v.id, v.message, v."firstComment", v."firstCommentDelayMinutes", v.link, v.media, v.format, v."destinationFormats", v."targetIds", v."labelIds", v."scheduledAt", v.timezone FROM post_versions v JOIN posts p ON p.id = v."postId" WHERE v.id = ${data.versionId} AND v."postId" = ${data.postId} AND p."workspaceId" = ${actor.workspaceId}`;
    const row = rows[0];
    if (!row) throw new OperationError('not_found', 'This version is unavailable for the post.');
    if (row.currentFormat !== row.format) throw new OperationError('conflict', 'This version uses a different post format and cannot be restored here. No content was changed.');
    await audit(tx, actor, 'publishing.version_restore_requested', { postId: data.postId, versionId: row.id });
    const { id, currentFormat: _currentFormat, ...rest } = row;
    return { versionId: id, ...rest } satisfies VersionSnapshot;
  }));
  // The save itself runs outside this transaction in the lifecycle (its own locks and provider-aware checks).
  let outcome;
  try { outcome = await port.restorePostVersion({ actor, postId: data.postId, snapshot }); }
  catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('upstream_failure', 'The restore could not be confirmed. Open the post and check its current content before trying again.');
  }
  try { await transact(actor.workspaceId, limit, tx => audit(tx, actor, 'publishing.version_restored', { postId: data.postId, versionId: snapshot.versionId, status: outcome.status, approvalReset: outcome.approvalReset })); } catch { /* the lifecycle has its own audit; the request was audited above */ }
  return { postId: outcome.postId, versionId: snapshot.versionId, status: outcome.status, approvalReset: outcome.approvalReset };
}
