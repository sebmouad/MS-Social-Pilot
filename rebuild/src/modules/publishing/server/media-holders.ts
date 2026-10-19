import type { Prisma } from '../../../../generated/client';
import type { ScopedPermissions } from '@/server/permissions';
import { canUseFeature, type Entitlements } from '@/server/entitlements';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from './read-scope';

/**
 * Which posts the media library may name as holders of an image. Publishing's own
 * whole-post visibility applies: scoped members and contributors see only posts on
 * their channels (and their own unconnected drafts). Null hides every holder; the
 * library then reports a count without naming posts.
 */
export async function mediaHolderVisibility(viewer: {
  user: { id: string };
  workspaceId: string;
  entitlements: Entitlements;
  membership: { role: string };
  permissions: Pick<ScopedPermissions, 'features' | 'pageScope'>;
}): Promise<Prisma.PostWhereInput | null> {
  if (!canUseFeature(viewer.entitlements, 'publishing/posts') || !viewer.permissions.features['publishing/posts'].read) return null;
  const scope = viewer.permissions.pageScope;
  const scoped = !scope.all;
  const selected = await selectedPublishingTargetIds(viewer.workspaceId, viewer.entitlements, scope.all ? undefined : scope.ids);
  const own = scoped || viewer.membership.role === 'contributor' ? viewer.user.id : undefined;
  return publishingPostVisibilityWhere(viewer.workspaceId, selected, own);
}
