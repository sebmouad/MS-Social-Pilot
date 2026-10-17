import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { z } from 'zod';
import { authorizePublishing } from '../../server/access';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from '../../server/read-scope';
import type { PublishingActor } from '../../server/types';
import { bounds, pageOffset, parse, POSTS, protect } from './core';
import type { PostLabel } from './assignments';

const SCHEMA = z.object({ q: z.string().trim().refine(v => !/[\u0000-\u001f\u007f]/.test(v)).optional(), page: z.number().int().min(1).max(100000).optional() }).strict();
export type AssignablePost = { id: string; message: string; status: string; scheduledAt: Date | null; labels: PostLabel[] };

/** Posts the caller may see (and, for contributors, only their own), newest first, with labels, for bulk assignment. One page = the bulk limit. */
export async function listAssignablePosts(actor: PublishingActor, input: unknown = {}) {
  const query = parse(SCHEMA, input);
  const limit = await bounds();
  const searchMax = await runtimeConfig('publishing.searchMaxCharacters');
  if (!Number.isSafeInteger(searchMax) || searchMax < 1) throw new OperationError('unavailable', 'Search is temporarily unavailable.');
  if ((query.q?.length ?? 0) > searchMax) throw new OperationError('invalid_request', 'The search is too long.');
  const auth = await authorizePublishing(actor, POSTS, 'read');
  const selected = await selectedPublishingTargetIds(actor.workspaceId, auth.entitlements, auth.actor.allowedTargetIds);
  const own = auth.actor.allowedTargetIds !== undefined || auth.role === 'contributor' ? actor.userId : undefined;
  const size = limit.bulkPostLimit;
  const rows = await protect(prisma.post.findMany({
    where: { ...publishingPostVisibilityWhere(actor.workspaceId, selected, own), ...(query.q ? { message: { contains: query.q, mode: 'insensitive' as const } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: pageOffset(query.page, size), take: size + 1,
    select: { id: true, message: true, status: true, scheduledAt: true },
  }));
  const shown = rows.slice(0, size);
  const ids = shown.map(r => r.id);
  const labels = ids.length ? await protect(prisma.$queryRaw<Array<PostLabel & { postId: string }>>`SELECT pl."postId", l.id, l.name, l.color FROM post_labels pl JOIN labels l ON l.id = pl."labelId" WHERE pl."postId" = ANY(${ids}::text[]) AND l."workspaceId" = ${actor.workspaceId} ORDER BY l.name ASC`) : [];
  const canEditAll = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'editor';
  return {
    posts: shown.map((r): AssignablePost => ({ id: r.id, message: r.message.slice(0, 200), status: String(r.status), scheduledAt: r.scheduledAt, labels: labels.filter(l => l.postId === r.id).map(({ id, name, color }) => ({ id, name, color })) })),
    page: query.page ?? 1, pageSize: size, hasMore: rows.length > size, query: query.q ?? '', canEditAll, bulkLimit: limit.bulkPostLimit, labelsPerPostLimit: limit.labelsPerPostLimit,
  };
}
