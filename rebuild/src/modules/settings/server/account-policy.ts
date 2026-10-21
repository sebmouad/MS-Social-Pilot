import { synchronousPolicy } from '@/server/synchronous-policy';
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
  return name.length >= 1 && name.length <= synchronousPolicy('settings.accountNameMaxLength') ? name : null;
}

export function validateNewPassword(value: unknown, policy: AccountPasswordPolicy) {
  if (typeof value !== 'string' || value.length < policy.minLength || Buffer.byteLength(value, 'utf8') > policy.maxBytes) return false;
  return true;
}

