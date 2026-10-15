import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/client';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 800;

export function validateProfileName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 100 ? name : null;
}

export function validateNewPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) return false;
  return true;
}

export function accountAuditId() {
  return `account_${randomBytes(12).toString('hex')}`;
}

export async function auditAccountMutation(tx: Prisma.TransactionClient, actorId: string, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${accountAuditId()}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

export const accountPasswordPolicy = { minLength: MIN_PASSWORD_LENGTH, maxBytes: MAX_PASSWORD_BYTES };
