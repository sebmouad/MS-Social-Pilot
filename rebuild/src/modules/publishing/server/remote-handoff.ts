import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { holdScheduledPostAtProvider } from './lifecycle';

export type HandOffSummary = { examined: number; handedOver: number; skipped: number };

/**
 * Hand scheduled posts that were saved by a system job (queue-less auto-scheduling: content mix, recycle) to the destinations that
 * chose platform-held scheduling. The saving transaction cannot call a platform, so this runs right after it, as the post's author
 * with that author's current access. Repeating it is safe: held destinations are skipped, and destinations the platform cannot hold
 * yet (too soon / too far ahead) are simply tried again on the next run until the application worker takes them at their time.
 */
export async function handOffRemoteSchedules(workspaceId?: string, now = new Date()): Promise<HandOffSummary> {
  const batch = Number(await runtimeConfig('publishing.remoteScheduling.handOffBatch'));
  const rows = await prisma.$queryRaw<Array<{ id: string; authorId: string; workspaceId: string }>>`
    SELECT p.id, p."authorId", p."workspaceId" FROM posts p
    WHERE p.status::text = 'scheduled' AND p."publishMode"::text = 'native' AND p."scheduledAt" > ${now}
      AND (${workspaceId ?? null}::text IS NULL OR p."workspaceId" = ${workspaceId ?? null})
      AND EXISTS (SELECT 1 FROM post_targets t WHERE t."postId" = p.id AND t.status::text = 'pending' AND COALESCE(t."scheduleMode", 'remote') = 'remote')
    ORDER BY p."scheduledAt" ASC, p.id ASC LIMIT ${batch}`;
  const summary: HandOffSummary = { examined: rows.length, handedOver: 0, skipped: 0 };
  for (const row of rows) {
    try {
      await assertWorkspaceNotPurging(row.workspaceId);
      const [permissions, entitlements] = await Promise.all([loadPermissions(row.authorId, row.workspaceId), loadEntitlements(row.authorId, row.workspaceId)]);
      if (!permissions || !entitlements || !canAccessFeature(permissions, 'publishing/posts', 'write') || !canUseFeature(entitlements, 'publishing/posts')) { summary.skipped++; continue; }
      const actor = { userId: row.authorId, workspaceId: row.workspaceId, ...(permissions.pageScope.all ? {} : { allowedTargetIds: permissions.pageScope.ids }) };
      const result = await holdScheduledPostAtProvider(actor, row.id);
      if (result && (result.remoteHold?.held ?? 0) > 0) summary.handedOver++; else summary.skipped++;
    } catch (error) {
      if (error instanceof OperationError) summary.skipped++; else throw error;
    }
  }
  return summary;
}
