import type { Prisma } from '../../../../generated/client';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { platformFor } from '@/server/platforms/registry';
import { prisma } from '@/server/data';
import { hasPlatformCapability, type Entitlements } from '@/server/entitlements';

/** Current selected destinations that the workspace may use for publishing.
 * Token expiry is deliberately not checked: retained post history stays readable. */
export async function selectedPublishingTargetIds(
  workspaceId: string,
  entitlements: Entitlements,
  callerTargetIds?: readonly string[],
): Promise<string[]> {
  if (entitlements.workspaceId !== workspaceId || !entitlements.modules.publishing) return [];
  const targets = await prisma.target.findMany({
    where: {
      workspaceId,
      enabled: true,
      socialAccount: { is: await selectedResourceConnectionWhere(workspaceId) },
      ...(callerTargetIds === undefined ? {} : { id: { in: [...callerTargetIds] } }),
    },
    select: { id: true, type: true, socialAccount: { select: { provider: true } } },
  });
  // One adapter/configuration read per provider for this authorized read, not per destination.
  const adapters = new Map<string, ReturnType<typeof platformFor>>();
  const eligible = await Promise.all(targets.map(async target => {
    const provider = target.socialAccount?.provider;
    if (!provider || !hasPlatformCapability(entitlements, provider)) return null;
    if (!adapters.has(provider)) adapters.set(provider, platformFor(provider, 'publishing'));
    const adapter = await adapters.get(provider);
    return adapter?.publish && adapter.supportsTargetKind?.(target.type, 'publishing') ? target.id : null;
  }));
  return eligible.filter((id): id is string => id !== null);
}

/** Whole-post visibility. Mixed posts are excluded in full so hidden destination
 * metadata and post actions cannot leak through a visible destination. */
export function publishingPostVisibilityWhere(
  workspaceId: string,
  allowedTargetIds?: readonly string[] | null,
  authorId?: string,
): Prisma.PostWhereInput {
  // A permission-unrestricted caller must still pass the selected, usable IDs
  // resolved above. Missing IDs are a safe fallback, never an all-resource read.
  const targetIds = allowedTargetIds ?? [];
  const visible: Prisma.PostWhereInput[] = [
    { targets: { some: { targetId: { in: [...targetIds] } }, every: { targetId: { in: [...targetIds] } } } },
  ];
  // The caller may omit authorId only after current permission checks prove
  // unrestricted post access; in that case unconnected drafts follow that policy.
  if (authorId) visible.push({ targets: { none: {} }, authorId });
  else if (allowedTargetIds !== null && allowedTargetIds !== undefined) visible.push({ targets: { none: {} } });
  return { workspaceId, OR: visible };
}
