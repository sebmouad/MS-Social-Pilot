import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { publishPost } from '@/server/publishing/lifecycle';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '@/server/data-control/guard';
import type { JobSummary } from './types';
export type { JobSummary } from './types';

/** Publish due local queue items through the same guarded lifecycle as the UI. */
export async function publishDuePosts(now = new Date()): Promise<JobSummary> {
  const limit = await runtimeConfig('sync.maxItemsPerJob');
  const rows = await prisma.post.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now }, targets: { some: { status: 'pending' } } },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: limit,
    select: { id: true, authorId: true, workspaceId: true },
  });
  const result: JobSummary = { examined: rows.length, updated: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    try {
      await assertWorkspaceNotPurging(row.workspaceId);
      const [permissions, entitlements] = await Promise.all([
        loadPermissions(row.authorId, row.workspaceId), loadEntitlements(row.authorId, row.workspaceId),
      ]);
      if (!permissions || !entitlements || !canAccessFeature(permissions, 'publishing/posts', 'write') || !canUseFeature(entitlements, 'publishing/posts')) {
        result.skipped++;
        continue;
      }
      const actor = { userId: row.authorId, workspaceId: row.workspaceId, ...(permissions.pageScope.all ? {} : { allowedTargetIds: permissions.pageScope.ids }) };
      const outcome = await withWorkspaceOperation(row.workspaceId, () => publishPost(actor, row.id));
      result.updated += outcome.published;
      result.failed += outcome.failed;
      if (outcome.needsReconciliation) result.skipped++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
