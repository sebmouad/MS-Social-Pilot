import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { readRootActivityForExport } from './activity';
import { readAuditConfig } from './audit-config';

/** Quote every cell and neutralize formula prefixes, including leading whitespace. */
export function auditCsvCell(value: string) {
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function exportRootActivity(actorId: string, input: unknown) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
  if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
  const policy = await readAuditConfig();
  const result = await readRootActivityForExport(actorId, input, policy.exportMaxRows);
  const rows = result.items.map(item => [item.id, item.createdAt.toISOString(), item.action, item.actor?.name ?? '', item.actor?.email ?? '', item.metadata.join('; ')]);
  const csv = [['id', 'created_at_utc', 'action', 'actor_name', 'actor_email', 'safe_details'], ...rows].map(row => row.map(auditCsvCell).join(',')).join('\r\n') + '\r\n';
  // An audit failure prevents delivery. Do not store search strings or exported data.
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.activity.exported', ${JSON.stringify({ rowCount: rows.length })}::jsonb, NOW())`;
  return { filename: 'root-activity.csv', csv, rowCount: rows.length };
}
