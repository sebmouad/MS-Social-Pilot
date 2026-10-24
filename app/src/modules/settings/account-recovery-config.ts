import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Lifetime for the legacy one-use email_tokens rows used by account recovery. */
export const ACCOUNT_RECOVERY_CONFIG = [
  entry({ key: 'auth.passwordRecoveryTtlMinutes', group: 'Security · passwords', label: 'Password recovery link lifetime (minutes)', kind: 'number', description: 'Maximum age of a one-use password recovery link.', defaultValue: 60, schema: z.number().int().min(5).max(1440), consumption: 'active' }),
] as const;
