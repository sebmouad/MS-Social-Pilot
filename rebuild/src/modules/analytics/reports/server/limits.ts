import { analyticsError } from '@/modules/analytics/server/error-copy';
import { z } from 'zod';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { unavailable, type Tx } from './access';

const schema = z.object({
  pageSize: z.number().int().min(1).max(1000), maxTemplates: z.number().int().min(1).max(5000), nameMax: z.number().int().min(1).max(500),
  maxSchedules: z.number().int().min(1).max(5000), maxRecipients: z.number().int().min(1).max(1000), dueBatch: z.number().int().min(1).max(5000),
  timeout: z.number().int().min(1000).max(60000), maxWait: z.number().int().min(500).max(30000), sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  maxRows: z.number().int().min(100).max(100000), maxBytes: z.number().int().min(10000).max(20000000), maxStoredBytes: z.number().int().min(20000).max(45000000), leaseSeconds: z.number().int().min(60).max(3600), historyPageSize: z.number().int().min(5).max(100),
  staleBatch: z.number().int().min(1).max(500), finishRetries: z.number().int().min(0).max(5), retentionHours: z.number().int().min(1).max(720),
}).strict();
export type ReportLimits = z.infer<typeof schema>;

const KEYS = ['pageSize', 'maxTemplates', 'templateNameMaxCharacters', 'maxSchedules', 'maxRecipients', 'dueBatchSize', 'transactionTimeoutMs', 'transactionMaxWaitMs', 'sendTime', 'maxOutputRows', 'maxOutputBytes', 'maxStoredArtifactBytes', 'runLeaseSeconds', 'runHistoryPageSize', 'staleSweepBatchSize', 'finishRetries', 'outputRetentionHours'] as const;
export async function reportLimits(): Promise<ReportLimits> {
  const v = await Promise.all(KEYS.map(k => runtimeConfig(`analytics.reports.${k}`)));
  const parsed = schema.safeParse({ pageSize: v[0], maxTemplates: v[1], nameMax: v[2], maxSchedules: v[3], maxRecipients: v[4], dueBatch: v[5], timeout: v[6], maxWait: v[7], sendTime: v[8], maxRows: v[9], maxBytes: v[10], maxStoredBytes: v[11], leaseSeconds: v[12], historyPageSize: v[13], staleBatch: v[14], finishRetries: v[15], retentionHours: v[16] });
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

/**
 * One transaction for every report change: a shared workspace row lock (erasure cannot pass while it is open), a per-workspace
 * advisory lock (serialises limits such as "templates per workspace") and the work itself. It deliberately does NOT wrap itself
 * in `withWorkspaceOperation`: that helper holds its own pooled connection and nesting a second transaction inside it can exhaust
 * the pool under concurrent writes. The host must list the report write tools in its service-owned lock bypass set, as for
 * Sharing and Tasks. Suspension and erasure are re-read under lock by `lockActor`.
 */
export function transact<T>(workspaceId: string, limits: Pick<ReportLimits, 'timeout' | 'maxWait'>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR SHARE`;
    if (!locked.length) throw await analyticsError('unavailable', "This workspace is unavailable.");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: limits.timeout, maxWait: limits.maxWait });
}
