import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { readAuditConfig } from './audit-config';

/** One atomic bounded batch per table; repeated purge jobs drain the backlog. */
export async function runAuditRetention(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid retention time.');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('rebuild:root-audit-retention'))::text`;
    const policy = await readAuditConfig(tx);
    if (policy.retentionDays === 0) {
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, NULL, 'root.audit.retention', ${JSON.stringify({ enabled: false, retentionDays: 0, rootDeleted: 0, workspaceDeleted: 0 })}::jsonb, NOW())`;
      return { enabled: false, rootDeleted: 0, workspaceDeleted: 0 };
    }
    const cutoff = new Date(now.getTime() - policy.retentionDays * 86400000).toISOString();
    const remove = (table: Prisma.Sql) => tx.$executeRaw(Prisma.sql`
      DELETE FROM ${table} WHERE id IN (
        SELECT id FROM ${table} WHERE "createdAt" < ${cutoff}::timestamp
        ORDER BY "createdAt", id LIMIT ${policy.batchSize} FOR UPDATE SKIP LOCKED
      )`);
    const rootDeleted = await remove(Prisma.sql`root_activities`);
    const workspaceDeleted = await remove(Prisma.sql`activity_logs`);
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, NULL, 'root.audit.retention', ${JSON.stringify({ cutoff, retentionDays: policy.retentionDays, rootDeleted, workspaceDeleted })}::jsonb, NOW())`;
    return { enabled: true, rootDeleted, workspaceDeleted };
  });
}
