import { ROOT_AUDIT_BOUNDS } from '@/lib/config/root-audit-controls';
import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { randomUUID } from 'node:crypto';

export const ROOT_AUDIT_CONFIG = [
  entry({ key: 'root.auditExportMaxRows', group: 'Root · audit', label: 'Audit export row limit', kind: 'number', description: 'Refuse exports exceeding this many matching events.', defaultValue: 10000, schema: z.number().int().min(1).max(ROOT_AUDIT_BOUNDS.exportRows.max), consumption: 'active' }),
  entry({ key: 'root.auditRetentionDays', group: 'Root · audit', label: 'Audit retention days', kind: 'number', description: 'Zero keeps audit history forever. Applies to Root and workspace activity.', defaultValue: 0, schema: z.number().int().min(0).max(ROOT_AUDIT_BOUNDS.retentionDays.max), consumption: 'active' }),
  entry({ key: 'root.auditRetentionBatchSize', group: 'Root · audit', label: 'Audit retention batch size', kind: 'number', description: 'Maximum rows deleted per audit table in each purge run.', defaultValue: 1000, schema: z.number().int().min(1).max(ROOT_AUDIT_BOUNDS.batchSize.max), consumption: 'active' }),
] as const;

// Local bridge until the host aggregates ROOT_AUDIT_CONFIG. No unvalidated values.
export async function readAuditConfig(client: Pick<typeof prisma, 'appSetting'> = prisma) {
  const values = await Promise.all(ROOT_AUDIT_CONFIG.map(async definition => {
    const row = await client.appSetting.findUnique({ where: { key: definition.key }, select: { value: true, encrypted: true } });
    if (row?.encrypted) throw new Error('Audit configuration must not be encrypted.');
    return definition.schema.parse(row ? row.value : definition.defaultValue);
  }));
  return { exportMaxRows: values[0]!, retentionDays: values[1]!, batchSize: values[2]! };
}

export async function saveAuditRetention(actorId: string, days: number) {
  return saveAuditSettings(actorId, { 'root.auditRetentionDays': days });
}

export async function saveAuditSettings(actorId: string, input: Record<string, unknown>) {
  const changes = Object.entries(input).map(([key, value]) => {
    const definition = ROOT_AUDIT_CONFIG.find(item => item.key === key);
    if (!definition) throw new OperationError('invalid_request', 'Unknown audit setting.');
    return { key, value: definition.schema.parse(value) };
  });
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('rebuild:root-audit-retention'))::text`;
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    for (const { key, value } of changes) {
      await tx.appSetting.upsert({ where: { key }, create: { key, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'config.changed', ${JSON.stringify({ key, value })}::jsonb, NOW())`;
    }
  });
}
