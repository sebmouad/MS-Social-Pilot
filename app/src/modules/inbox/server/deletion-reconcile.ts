import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { platformInbox } from '@/server/platforms/registry';
import type { JobSummary } from '@/server/jobs/types';
import { withInboxChannelOperation } from './comment-guard';
import { finish, type Journal } from './deletion';

type Candidate = Journal & { actorId: string };

/** Worker step: re-read unresolved comment deletions through the owning module's read-only capability.
 * Only positive evidence of absence finalizes; present, unknown or unreadable answers leave the journal held
 * and never trigger another delete. Rows are rechecked no sooner than the Root interval and abandoned to
 * manual/Root recovery after the Root age limit. */
export async function reconcileInboxDeletions(now = new Date()): Promise<JobSummary> {
  const summary: JobSummary = { examined: 0, updated: 0, skipped: 0, failed: 0 };
  const [batch, minAge, maxAge] = await Promise.all([
    runtimeConfig('inbox.deletionReconcileBatch'), runtimeConfig('inbox.deletionReconcileMinAgeMs'), runtimeConfig('inbox.deletionReconcileMaxAgeMs'),
  ]) as [number, number, number];
  if (!(batch > 0)) return summary;
  const idle = new Date(now.getTime() - minAge);
  const oldest = new Date(now.getTime() - maxAge);
  const rows = await prisma.$queryRaw<Candidate[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state, "actorId"
    FROM rebuild_inbox_deletions
    WHERE (state = 'remote_confirmed' OR (state IN ('started', 'uncertain') AND "createdAt" >= ${oldest}::timestamp)) AND "updatedAt" <= ${idle}::timestamp
    ORDER BY "updatedAt" ASC, id ASC LIMIT ${batch}`;
  for (const row of rows) {
    summary.examined++;
    try {
      const outcome = await withWorkspaceOperation(row.workspaceId, async () => withInboxChannelOperation(row.workspaceId, row.targetId, async signal => {
        // Recheck inside the channel lock: a manual action may have settled it, and a live dispatch holds this lock.
        const fresh = (await prisma.$queryRaw<Candidate[]>`SELECT id, "workspaceId", "targetId", provider, "remoteId", "localItemId", state, "actorId"
          FROM rebuild_inbox_deletions WHERE id = ${row.id} AND "workspaceId" = ${row.workspaceId}`)[0];
        if (!fresh || !['started', 'uncertain', 'remote_confirmed'].includes(fresh.state)) return 'skipped' as const;
        const actor = { userId: fresh.actorId, workspaceId: fresh.workspaceId };
        if (fresh.state === 'remote_confirmed') { await finish(fresh, actor, { source: 'reconciliation' }); return 'finalized' as const; }
        const host = await platformInbox(fresh.provider);
        if (!host?.readCommentPresence) return 'skipped' as const;
        await assertWorkspaceJobAccess(fresh.workspaceId, { provider: fresh.provider, anyFeatureOf: ['inbox/conversations'] });
        const post = (await prisma.$queryRaw<Array<{ remotePostId: string | null }>>`SELECT pt."remotePostId" FROM post_comments c
          JOIN post_targets pt ON pt.id = c."postTargetId" JOIN posts p ON p.id = pt."postId"
          WHERE pt."targetId" = ${fresh.targetId} AND p."workspaceId" = ${fresh.workspaceId} AND c."remoteId" = ${fresh.remoteId} LIMIT 1`)[0];
        let presence: 'present' | 'absent' | 'unknown' = 'unknown';
        if (post?.remotePostId) {
          signal.throwIfAborted();
          presence = await host.readCommentPresence({ workspaceId: fresh.workspaceId, targetId: fresh.targetId, remoteId: fresh.remoteId, postRemoteId: post.remotePostId }, signal);
        }
        signal.throwIfAborted();
        if (presence !== 'absent') {
          // Rotate fairly through held rows; no state change, no resend.
          await prisma.$executeRaw`UPDATE rebuild_inbox_deletions SET "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${fresh.id} AND "workspaceId" = ${fresh.workspaceId} AND state = ${fresh.state}`;
          return 'held' as const;
        }
        const [timeout, maxWait] = await Promise.all([runtimeConfig('inbox.workflowTransactionTimeoutMs'), runtimeConfig('inbox.workflowTransactionMaxWaitMs')]);
        const confirmed = await prisma.$transaction(async tx => {
          const count = await tx.$executeRaw`UPDATE rebuild_inbox_deletions SET state = 'remote_confirmed', reason = 'local_pending', "remoteConfirmedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = ${fresh.id} AND "workspaceId" = ${fresh.workspaceId} AND state IN ('started', 'uncertain')`;
          if (count !== 1) return false;
          await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${fresh.actorId}, 'inbox.comment_deletion_reconciled', ${JSON.stringify({ workspaceId: fresh.workspaceId, targetId: fresh.targetId, itemId: fresh.localItemId, operationId: fresh.id, previousState: fresh.state, evidence: 'absent_from_post_listing' })}::jsonb, NOW())`;
          return true;
        }, { timeout, maxWait });
        if (!confirmed) return 'skipped' as const;
        await finish({ ...fresh, state: 'remote_confirmed' }, actor, { source: 'reconciliation' });
        return 'finalized' as const;
      }));
      if (outcome === 'finalized') summary.updated++; else summary.skipped++;
    } catch (error) {
      if (error instanceof OperationError && ['forbidden', 'not_found', 'conflict', 'unavailable'].includes(error.code)) summary.skipped++; else summary.failed++;
    }
  }
  return summary;
}
