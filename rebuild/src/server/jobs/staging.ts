import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';

/**
 * Root-guarded rehearsal switch for worker outbound writes. When
 * `jobs.stagingDryRun` is on, the worker paths that dispatch outward
 * (due-post publishing, due first comments, automatic inbox moderation,
 * team-chat notifications and outbound webhook deliveries) skip the dispatch
 * and audit what they would have sent instead. Local scheduling, drafts,
 * reads, reconciliation, queueing and every user-initiated action are
 * unaffected. Token refreshes that enable those reads, and worker AI
 * classification (for example comment sentiment), also keep running: they
 * dispatch nothing outward and are what makes the rehearsal realistic. Only
 * the outward dispatches above stay silent, so a rehearsal exercises the full
 * local pipeline without
 * touching providers or external receivers. Staging is silent outbound:
 * no provider write, no chat message and no webhook POST leaves the worker.
 */

/** True when Root switched worker provider writes off. Unreadable config means live behavior, the default. */
export async function isStagingDryRun(): Promise<boolean> {
  try {
    return await runtimeConfig('jobs.stagingDryRun') === true;
  } catch {
    return false;
  }
}

export type StagingDryRunKind = 'publish' | 'first_comment' | 'inbox_moderation' | 'chat_notification' | 'outbound_webhook';

/** Audit one suppressed worker dispatch batch. Worker rows carry actorId NULL like other worker audits. */
export async function logStagingDryRunIntent(input: { workspaceId: string; job: string; kind: StagingDryRunKind; count: number; sampleIds: string[] }): Promise<void> {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt")
    VALUES (${`staging_${randomUUID()}`}, NULL, 'worker.staging_dry_run', ${JSON.stringify({ workspaceId: input.workspaceId, job: input.job, kind: input.kind, count: input.count, sampleIds: input.sampleIds.slice(0, 10) })}::jsonb, NOW())`;
}

/** Audit one dry-run row per workspace for a suppressed candidate batch. Returns the suppressed count. */
export async function suppressStagingBatch(job: string, kind: StagingDryRunKind, rows: Array<{ workspaceId: string; id: string }>): Promise<number> {
  const byWorkspace = new Map<string, string[]>();
  for (const row of rows) {
    const ids = byWorkspace.get(row.workspaceId) ?? [];
    ids.push(row.id);
    byWorkspace.set(row.workspaceId, ids);
  }
  for (const [workspaceId, ids] of byWorkspace) {
    await logStagingDryRunIntent({ workspaceId, job, kind, count: ids.length, sampleIds: ids });
  }
  return rows.length;
}
