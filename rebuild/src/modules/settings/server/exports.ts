import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { canonicalMediaRoot, validateWorkspaceId } from '@/server/data-control/storage';
import { exportWorkspaceArchive } from '@/server/data-control/archive';
import type { DataControlActor } from '@/server/data-control';
import { SETTINGS_MODULE_CONFIG } from '../config';

type Job = { id: string; workspaceId: string; requestedById: string; apiKeyId: string | null; status: string; mediaRoot: string; leaseToken: string | null; leaseUntil: Date | null; createdAt: Date; expiresAt: Date; error: string | null; bytes: number | null };
const missing = () => new OperationError('not_found', 'This export is unavailable in the current workspace.');
const publicJob = ({ id, status, createdAt, expiresAt, error, bytes }: Job) => ({ id, status: expiresAt <= new Date() ? 'expired' : status, createdAt, expiresAt, error, bytes });

async function limit(key: string): Promise<number> {
  const definition = SETTINGS_MODULE_CONFIG.find(item => item.key === key);
  const result = definition?.schema.safeParse(await runtimeConfig(key));
  if (!result?.success || typeof result.data !== 'number') throw new OperationError('unavailable', 'Export settings are unavailable.');
  return result.data;
}

async function authorize(actor: DataControlActor, write = false) {
  const [membership, entitlements, permissions] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true, user: { select: { disabledAt: true } } } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!membership || membership.user.disabledAt || !['owner', 'admin'].includes(membership.role) || !entitlements || !canUseFeature(entitlements, 'settings/data') || !permissions || !canAccessFeature(permissions, 'settings/data', write ? 'write' : 'read')) {
    throw new OperationError('forbidden', 'Only active workspace owners and admins can export workspace data.');
  }
}

/** Only computed file names are accepted; no stored relative path can escape the tenant. */
async function archivePath(job: Pick<Job, 'id' | 'workspaceId' | 'mediaRoot'>, create = false) {
  validateWorkspaceId(job.workspaceId);
  if (!/^[a-f0-9-]{36}$/.test(job.id)) throw missing();
  const root = await canonicalMediaRoot(job.mediaRoot);
  let directory = root;
  for (const part of ['exports', job.workspaceId]) {
    directory = path.join(directory, part);
    if (create) await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe export directory.');
  }
  return path.join(directory, `${job.id}.zip`);
}
async function removeArchive(job: Pick<Job, 'id' | 'workspaceId' | 'mediaRoot'>) {
  try {
    // A removed storage root already contains no retained archive.
    await lstat(job.mediaRoot);
    await unlink(await archivePath(job));
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
async function audit(actor: DataControlActor, id: string, action: string, db: Pick<typeof prisma, '$executeRaw'> = prisma) {
  await db.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, exportId: id, ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {}) })}::jsonb, NOW())`;
}

export async function listWorkspaceExports(actor: DataControlActor) {
  return withWorkspaceOperation(actor.workspaceId, async () => {
    await authorize(actor);
    const max = await limit('data.exportMaxJobs');
    const jobs = await prisma.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt" DESC, id DESC LIMIT ${max}`;
    return jobs.map(publicJob);
  });
}

export async function requestWorkspaceExport(actor: DataControlActor, confirmation: string) {
  if (confirmation !== `REQUEST WORKSPACE EXPORT ${actor.workspaceId}`) throw new OperationError('invalid_request', 'Confirm the exact workspace export request.');
  return withWorkspaceOperation(actor.workspaceId, async () => {
    await authorize(actor, true);
    const [max, hours, configuredRoot] = await Promise.all([limit('data.exportMaxJobs'), limit('data.exportExpiryHours'), runtimeConfig('storage.mediaRoot')]);
    const mediaRoot = await canonicalMediaRoot(String(configuredRoot ?? ''));
    // Serialize requests separately from the workspace SHARE gate; never upgrade that gate.
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace-export:${actor.workspaceId}`}, 0))`;
      const pending = await tx.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE "workspaceId" = ${actor.workspaceId} AND status IN ('requested','running') LIMIT 1`;
      if (pending[0]) return publicJob(pending[0]);
      await tx.$executeRaw`DELETE FROM rebuild_workspace_exports WHERE "workspaceId" = ${actor.workspaceId} AND status IN ('expired','failed')`;
      const counts = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM rebuild_workspace_exports WHERE "workspaceId" = ${actor.workspaceId}`;
      if (Number(counts[0]!.count) >= max) throw new OperationError('conflict', 'Wait for an existing export to expire before requesting another.');
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + hours * 3600000);
      const rows = await tx.$queryRaw<Job[]>`INSERT INTO rebuild_workspace_exports (id, "workspaceId", "requestedById", "apiKeyId", "mediaRoot", "expiresAt") VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${actor.apiKeyId ?? null}, ${mediaRoot}, ${expiresAt}) RETURNING *`;
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.userId}, 'workspace.export_requested', ${JSON.stringify({ workspaceId: actor.workspaceId, exportId: id, apiKeyId: actor.apiKeyId })}::jsonb, NOW())`;
      return publicJob(rows[0]!);
    });
  });
}

export async function downloadWorkspaceExport(actor: DataControlActor, id: string) {
  return withWorkspaceOperation(actor.workspaceId, async () => {
    await authorize(actor);
    const rows = await prisma.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    const job = rows[0];
    if (!job || job.status !== 'ready' || job.expiresAt <= new Date()) throw missing();
    const handle = await open(await archivePath(job), constants.O_RDONLY | constants.O_NOFOLLOW);
    let content: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== job.bytes) throw missing();
      content = await handle.readFile();
    } finally { await handle.close(); }
    // Current authority is checked again after disk I/O; no bearer download token.
    await authorize(actor);
    if (job.expiresAt <= new Date()) throw missing();
    await audit(actor, id, 'workspace.export_downloaded');
    return { content, id };
  });
}

/** Row locks fence a stale claim; recovery can never build alongside its predecessor. */
export async function runWorkspaceExports(): Promise<string> {
  const batch = await limit('data.exportWorkerBatch');
  const leaseSeconds = await limit('data.exportLeaseSeconds');
  const timeout = await runtimeConfig('data.workspaceOperationTimeoutMs') as number;
  const deleted = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; mediaRoot: string }>>`SELECT * FROM rebuild_export_file_cleanups WHERE "nextAttemptAt" <= NOW() ORDER BY "nextAttemptAt", id LIMIT ${batch}`;
  for (const item of deleted) {
    try {
      await removeArchive(item);
      await prisma.$executeRaw`DELETE FROM rebuild_export_file_cleanups WHERE id = ${item.id}`;
    } catch {
      await prisma.$executeRaw`UPDATE rebuild_export_file_cleanups SET "nextAttemptAt" = ${new Date(Date.now() + leaseSeconds * 1000)} WHERE id = ${item.id}`;
    }
  }
  const due = await prisma.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE "expiresAt" <= NOW() AND status <> 'expired' AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()) ORDER BY "expiresAt" LIMIT ${batch}`;
  for (const job of due) {
    try {
      await prisma.$transaction(async tx => {
        // Cleanup is permitted for suspended tenants. Erasure takes the exclusive
        // workspace lock and owns cleanup once its purge request is persisted.
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${job.workspaceId} FOR SHARE`;
        const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: job.workspaceId }, select: { status: true } });
        if (purge && purge.status !== 'completed') return;
        const locked = await tx.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE id = ${job.id} AND status <> 'expired' AND "expiresAt" <= NOW() FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return;
        await removeArchive(locked[0]!);
        await tx.$executeRaw`UPDATE rebuild_workspace_exports SET status = 'expired', bytes = NULL, "leaseToken" = NULL, "leaseUntil" = NULL WHERE id = ${job.id}`;
      }, { timeout });
    } catch {
      // Back off unreadable storage so it does not monopolize the cleanup batch.
      await prisma.$executeRaw`UPDATE rebuild_workspace_exports SET "leaseUntil" = ${new Date(Date.now() + leaseSeconds * 1000)} WHERE id = ${job.id} AND status <> 'expired'`.catch(() => undefined);
    }
  }
  const candidates = await prisma.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE "expiresAt" > NOW() AND ((status = 'requested' AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())) OR (status = 'running' AND "leaseUntil" < NOW())) ORDER BY "createdAt" LIMIT ${batch}`;
  let built = 0;
  for (const candidate of candidates) {
    await withWorkspaceOperation(candidate.workspaceId, async () => {
      const token = randomUUID();
      // Skip a row locked by a live builder, even if its lease clock has elapsed.
      const claimed = await prisma.$queryRaw<Job[]>`UPDATE rebuild_workspace_exports SET status = 'running', "leaseToken" = ${token}, "leaseUntil" = ${new Date(Date.now() + leaseSeconds * 1000)} WHERE id IN (SELECT id FROM rebuild_workspace_exports WHERE id = ${candidate.id} AND "expiresAt" > NOW() AND ((status = 'requested' AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())) OR (status = 'running' AND "leaseUntil" < NOW())) FOR UPDATE SKIP LOCKED) RETURNING *`;
      const job = claimed[0];
      if (!job) return;
      try {
        await prisma.$transaction(async tx => {
          const locked = await tx.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE id = ${job.id} AND "leaseToken" = ${token} AND status = 'running' FOR UPDATE`;
          if (!locked.length) return;
          const actor = { userId: job.requestedById, workspaceId: job.workspaceId, ...(job.apiKeyId ? { apiKeyId: job.apiKeyId } : {}) };
          await authorize(actor);
          // The one existing builder owns record/media coverage and archive bounds.
          // Its configured root must still match the root captured by the request.
          if (await canonicalMediaRoot(String(await runtimeConfig('storage.mediaRoot'))) !== job.mediaRoot) throw new Error('Storage root changed.');
          await removeArchive(job);
          const content = await exportWorkspaceArchive(actor);
          await authorize(actor);
          if (job.expiresAt <= new Date()) throw new Error('Export expired while building.');
          const file = await open(await archivePath(job, true), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await file.writeFile(content); } finally { await file.close(); }
          await tx.$executeRaw`UPDATE rebuild_workspace_exports SET status = 'ready', bytes = ${content.length}, "leaseUntil" = NULL WHERE id = ${job.id} AND "leaseToken" = ${token}`;
          await audit(actor, job.id, 'workspace.export_ready', tx);
          built++;
        }, { timeout });
      } catch {
        // Reacquire the row and prove this token still owns it before touching
        // disk. A successor may have claimed the job after transaction rollback.
        await prisma.$transaction(async tx => {
          const owned = await tx.$queryRaw<Job[]>`SELECT * FROM rebuild_workspace_exports WHERE id = ${job.id} AND "leaseToken" = ${token} AND status = 'running' FOR UPDATE SKIP LOCKED`;
          if (!owned.length) return;
          await removeArchive(job);
          await tx.$executeRaw`UPDATE rebuild_workspace_exports SET status = 'failed', error = 'The export could not be built. Request another export.', "leaseToken" = NULL, "leaseUntil" = NULL WHERE id = ${job.id} AND "leaseToken" = ${token}`;
        }, { timeout });
      }
    }).catch(async () => {
      // Suspended/deleting workspaces must not block other tenants' requests.
      await prisma.$executeRaw`UPDATE rebuild_workspace_exports SET "leaseUntil" = ${new Date(Date.now() + leaseSeconds * 1000)} WHERE id = ${candidate.id} AND status IN ('requested','running')`.catch(() => undefined);
    });
  }
  return `built=${built} cleanupExamined=${due.length}`;
}
