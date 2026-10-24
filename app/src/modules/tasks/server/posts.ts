import { prisma } from '@/server/data';
import { canUseFeature, canUseModule } from '@/server/entitlements';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from '@/modules/publishing/server/read-scope';
import type { Prisma } from '../../../../generated/client';
import type { TasksActor } from '../tasks';
import { featureAllowed, type TasksAccess } from './access';

/**
 * A task may point at a post. Which posts the viewer may see or link is Publishing's rule, not Tasks':
 * this reuses Publishing's selected-channel and whole-post visibility helpers, and requires the viewer to
 * hold the Publishing posts feature. Without it every link is treated as hidden.
 */
export async function postVisibility(actor: TasksActor, access: TasksAccess): Promise<Prisma.PostWhereInput | null> {
  if (!canUseModule(access.entitlements, 'publishing') || !canUseFeature(access.entitlements, 'publishing/posts')
    || !featureAllowed(access, 'publishing/posts', 'read')) return null;
  const selected = await selectedPublishingTargetIds(actor.workspaceId, access.entitlements, access.targetIds);
  // Scoped members (and keys) see unconnected drafts only when they wrote them; same rule as Publishing.
  const own = access.targetIds !== undefined || access.role === 'contributor' ? actor.userId : undefined;
  return publishingPostVisibilityWhere(actor.workspaceId, selected, own);
}

export type VisiblePost = { id: string; preview: string; status: string };

export async function visiblePosts(client: Pick<typeof prisma, 'post'>, visibility: Prisma.PostWhereInput | null, ids: readonly string[]): Promise<Map<string, VisiblePost>> {
  if (!visibility || !ids.length) return new Map();
  const rows = await client.post.findMany({ where: { AND: [{ id: { in: [...ids] } }, visibility] }, select: { id: true, message: true, status: true }, take: ids.length });
  return new Map(rows.map(row => [row.id, { id: row.id, preview: row.message.slice(0, 140), status: String(row.status) }]));
}
