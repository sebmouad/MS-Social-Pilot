import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/client';
import { runtimeConfig } from '@/server/config/store';

export type AccountPasswordPolicy = { minLength: number; maxBytes: number };

export async function accountPasswordPolicy(): Promise<AccountPasswordPolicy> {
  const [minLength, maxBytes] = await Promise.all([
    runtimeConfig('auth.passwordMinLength'),
    runtimeConfig('auth.passwordMaxBytes'),
  ]);
  return { minLength, maxBytes };
}

export function validateProfileName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 100 ? name : null;
}

export function validateNewPassword(value: unknown, policy: AccountPasswordPolicy) {
  if (typeof value !== 'string' || value.length < policy.minLength || Buffer.byteLength(value, 'utf8') > policy.maxBytes) return false;
  return true;
}

export function accountAuditId() {
  return `account_${randomBytes(12).toString('hex')}`;
}

export async function auditAccountMutation(tx: Prisma.TransactionClient, actorId: string, action: string, detail: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${accountAuditId()}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}
