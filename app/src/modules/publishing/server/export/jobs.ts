import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { exportPublishingPosts } from '../export';
import { publishingPostReadQuery } from '../read-query';
import type { PublishingActor } from '../types';
import { asyncExportPolicySchema } from './config';
import { jobStopRequested } from '@/server/jobs/job-context';
import { postExportCopy } from './copy';
const filtersSchema = z.object({ q: z.string().optional(), channelId: z.string().optional(), status: z.string().optional() }).strict();
type Filters = z.infer<typeof filtersSchema>;
type Job = { id: string; workspaceId: string; userId: string; filters: Filters; ceiling: string[] | null; scope: string; status: string; expiresAt: Date; csv: string | null; attempts: number };
const fingerprint = (scope: { targetIds: string[]; authorId?: string }) => createHash('sha256').update(JSON.stringify({ targetIds: [...scope.targetIds].sort(), authorId: scope.authorId ?? null })).digest('hex');
const missing = async () => new OperationError('not_found', (await postExportCopy()).unavailable);
const policy = async () => asyncExportPolicySchema.parse(await runtimeConfig('publishing.asyncExportPolicy'));
/** Enqueue only; the worker performs the CSV query out of the request path. */
export async function requestPostExport(actor: PublishingActor, raw: unknown, confirmation: string) {
 const filters = filtersSchema.parse(raw);
 const query = await publishingPostReadQuery(actor, filters);
 if (confirmation !== 'EXPORT POSTS') throw new OperationError('invalid_request', (await postExportCopy()).confirmation);
 const p = await policy();
 return prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
  const members = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  if (!members[0] || members[0].disabledAt) throw await missing();
  const current = await publishingPostReadQuery(actor, filters);
  if (fingerprint(current.scope) !== fingerprint(query.scope)) throw await missing();
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`post-export:${actor.workspaceId}:${actor.userId}`}))::text`;
  const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM post_exports WHERE "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} AND status IN ('queued','processing') AND "expiresAt" > now()`;
  if (Number(count[0].count) >= p.maxPendingPerUser) throw new OperationError('conflict', (await postExportCopy()).busy);
  const id = randomUUID(); const expiresAt = new Date(Date.now() + p.expiryMs);
  await tx.$executeRaw`INSERT INTO post_exports (id, "workspaceId", "userId", filters, ceiling, scope, status, "expiresAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${JSON.stringify(filters)}::jsonb, ${JSON.stringify(actor.allowedTargetIds ?? null)}::jsonb, ${fingerprint(query.scope)}, 'queued', ${expiresAt})`;
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'publishing.export_requested', ${JSON.stringify({ id })}::jsonb, now())`;
  return { id, status: 'queued', expiresAt: expiresAt.toISOString() };
 });
}
/** Status and download both recheck current resource scope; no public bearer URL. */
export async function readPostExport(actor: PublishingActor, id: string, download = false) {
 // Authorize before lookup, including on missing ids.
 await publishingPostReadQuery(actor, {});
 const rows = await prisma.$queryRaw<Job[]>`SELECT * FROM post_exports WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} AND "expiresAt" > now()`;
 const job = rows[0]; if (!job) throw await missing();
 const query = await publishingPostReadQuery(actor, job.filters);
 if (fingerprint(query.scope) !== job.scope) throw await missing();
 if (download && (job.status !== 'ready' || job.csv === null)) throw await missing();
 const p = await policy();
 const runs = await prisma.$queryRaw<Array<{ attempt: number; outcome: string; startedAt: Date; finishedAt: Date | null }>>`SELECT attempt, outcome, "startedAt", "finishedAt" FROM post_export_runs WHERE "exportId" = ${id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} ORDER BY attempt DESC LIMIT ${p.historyLimit}`;
 if (download) await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'publishing.export_downloaded', ${JSON.stringify({ id })}::jsonb, now())`;
 return { id: job.id, status: job.status, expiresAt: job.expiresAt.toISOString(), runs, ...(download ? { csv: job.csv, fileName: 'posts.csv' } : {}) };
}
/** One durable attempt per invocation; stale workers cannot settle another worker's lease. */
export async function runPostExportJob() {
 const p = await policy();
 const [timeout, maxWait] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs')]);
 if (p.leaseMs <= Number(timeout) + Number(maxWait)) throw new OperationError('unavailable', (await postExportCopy()).lease);
 const token = randomUUID(); const leaseUntil = new Date(Date.now() + p.leaseMs);
 const job = await prisma.$transaction(async tx => {
  const rows = await tx.$queryRaw<Job[]>`UPDATE post_exports SET status = 'processing', token = ${token}, "leaseUntil" = ${leaseUntil}, attempts = attempts + 1 WHERE id = (SELECT id FROM post_exports WHERE "expiresAt" > now() AND attempts < ${p.maxAttempts} AND "nextAttemptAt" <= now() AND (status = 'queued' OR (status = 'processing' AND "leaseUntil" < now())) ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  const claimed = rows[0]; if (!claimed) return null;
  await tx.$executeRaw`UPDATE post_export_runs SET outcome = 'expired', "finishedAt" = now(), "errorCode" = 'lease_expired' WHERE "exportId" = ${claimed.id} AND outcome = 'running'`;
  await tx.$executeRaw`INSERT INTO post_export_runs (id, "exportId", "workspaceId", "userId", attempt, outcome) VALUES (${token}, ${claimed.id}, ${claimed.workspaceId}, ${claimed.userId}, ${claimed.attempts}, 'running')`;
  return claimed;
 });
 if (!job) return false;
 const actor: PublishingActor = { userId: job.userId, workspaceId: job.workspaceId, ...(job.ceiling === null ? {} : { allowedTargetIds: job.ceiling }) };
 try {
  const before = await publishingPostReadQuery(actor, job.filters);
  if (fingerprint(before.scope) !== job.scope) throw await missing();
  const result = await exportPublishingPosts(actor, job.filters);
  const after = await publishingPostReadQuery(actor, job.filters);
  if (fingerprint(after.scope) !== job.scope) throw await missing();
  await prisma.$transaction(async tx => {
   const updated = await tx.$executeRaw`UPDATE post_exports SET status = 'ready', csv = ${result.csv}, token = NULL, "leaseUntil" = NULL, "completedAt" = now(), "lastError" = NULL WHERE id = ${job.id} AND token = ${token} AND "expiresAt" > now() AND "leaseUntil" > now()`;
   if (!updated) return;
   await tx.$executeRaw`UPDATE post_export_runs SET outcome = 'succeeded', "finishedAt" = now(), "postCount" = ${result.postCount}, "byteLength" = ${result.byteLength} WHERE id = ${token} AND outcome = 'running'`;
   await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${job.workspaceId}, ${job.userId}, 'publishing.export_completed', ${JSON.stringify({ id: job.id, postCount: result.postCount, byteLength: result.byteLength })}::jsonb, now())`;
  });
 } catch (error) {
  const code = error instanceof OperationError ? error.code : 'upstream_failure';
  const retry = job.attempts < p.maxAttempts && ['upstream_failure','unavailable'].includes(code);
  const nextAttemptAt = new Date(Date.now() + p.retryDelayMs);
  await prisma.$transaction(async tx => {
   const updated = await tx.$executeRaw`UPDATE post_exports SET status = ${retry ? 'queued' : 'failed'}, csv = NULL, token = NULL, "leaseUntil" = NULL, "lastError" = ${code}, "nextAttemptAt" = ${nextAttemptAt}, "completedAt" = ${retry ? null : new Date()} WHERE id = ${job.id} AND token = ${token} AND "leaseUntil" > now() AND "expiresAt" > now()`;
   if (!updated) return;
   await tx.$executeRaw`UPDATE post_export_runs SET outcome = ${retry ? 'retry' : 'failed'}, "errorCode" = ${code}, "finishedAt" = now() WHERE id = ${token} AND outcome = 'running'`;
   await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${job.workspaceId}, ${job.userId}, 'publishing.export_attempt_failed', ${JSON.stringify({ id: job.id, code, retry })}::jsonb, now())`;
  });
 }
 return true;
}
export async function expirePostExports() {
 const p = await policy();
 return prisma.$transaction(async tx => {
  // Exhausted crashed attempts become terminal rather than remaining stuck in processing.
  await tx.$executeRaw`UPDATE post_export_runs SET outcome = 'expired', "finishedAt" = now(), "errorCode" = 'lease_expired' WHERE outcome = 'running' AND "exportId" IN (SELECT id FROM post_exports WHERE status = 'processing' AND "leaseUntil" <= now())`;
  await tx.$executeRaw`UPDATE post_exports SET status = 'failed', csv = NULL, token = NULL, "leaseUntil" = NULL, "lastError" = 'lease_expired', "completedAt" = now() WHERE status = 'processing' AND "leaseUntil" <= now() AND attempts >= ${p.maxAttempts}`;
  return tx.$executeRaw`DELETE FROM post_exports WHERE "expiresAt" <= now()`;
 });
}

/** Shared worker invokes a bounded batch; individual attempts retain independent leases. */
export async function runPostExportBatch(): Promise<string> {
 const p = await policy();
 const expired = await expirePostExports();
 let processed = 0;
 for (; processed < p.workerBatch; processed++) {
  if (jobStopRequested() || !await runPostExportJob()) break;
 }
 return `Post exports: ${processed} attempted, ${expired} expired`;
}
