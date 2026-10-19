import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { publishPost } from '@/modules/publishing/server/lifecycle';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import type { JobSummary } from './types';
export type { JobSummary } from './types';

/** Publish due local queue items through the same guarded lifecycle as the UI. */
export async function publishDuePosts(now = new Date()): Promise<JobSummary> {
  const limit = await runtimeConfig('sync.maxItemsPerJob');
  const rows = await prisma.post.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now }, targets: { some: { status: 'pending' } } },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: limit,
    select: { id: true, authorId: true, workspaceId: true, scheduledAt: true },
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
      if (!row.scheduledAt) { result.skipped++; continue; }
      const outcome = await publishPost(actor, row.id, row.scheduledAt);
      result.updated += outcome.published;
      result.failed += outcome.failed;
      if (outcome.needsReconciliation || outcome.skipped) result.skipped++;
    } catch (error) {
      if (error instanceof OperationError && ['conflict', 'not_found'].includes(error.code)) result.skipped++;
      else result.failed++;
    }
  }
  return result;
}
