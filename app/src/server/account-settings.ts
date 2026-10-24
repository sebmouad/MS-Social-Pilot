import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/client';

/** Compatibility exports; account validation belongs to Settings. */
export { accountPasswordPolicy, validateProfileName, validateNewPassword, type AccountPasswordPolicy } from '@/modules/settings/server/account-policy';

export function accountAuditId() {
  return `account_${randomBytes(12).toString('hex')}`;
}

export async function auditAccountMutation(tx: Prisma.TransactionClient, actorId: string, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${accountAuditId()}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}
