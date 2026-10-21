import { z } from 'zod';
import { RESCHEDULE_POLICY, reschedulePolicySchema } from './reschedule-policy';

/** Bootstrap defaults for synchronous guards. Root declarations use these same values. */
export const SYNCHRONOUS_POLICY = {
  'shared.reschedulePolicy': { defaultValue: RESCHEDULE_POLICY, schema: reschedulePolicySchema },
  'auth.passwordVerificationMaxBytes': { defaultValue: 800, schema: z.number().int().min(64).max(65536) },
  'root.registrationIdentifierMaxCharacters': { defaultValue: 255, schema: z.number().int().min(1).max(255) },
  'connections.expiryWarningDays': { defaultValue: 7, schema: z.number().int().min(0).max(365) },
  'auth.passwordMaxBytes': { defaultValue: 800, schema: z.number().int().min(64).max(4096) },
  'settings.accountNameMaxLength': { defaultValue: 100, schema: z.number().int().min(1).max(1000) },
  'security.rateLimitMaxKeys': { defaultValue: 10000, schema: z.number().int().min(1).max(1000000) },
  'auth.invitationTokenMaxCharacters': { defaultValue: 128, schema: z.number().int().min(43).max(4096) },
  'root.identifierMaxCharacters': { defaultValue: 200, schema: z.number().int().min(1).max(2000) },
  'root.confirmationMaxCharacters': { defaultValue: 400, schema: z.number().int().min(1).max(4000) },
  'root.pageMaxNumber': { defaultValue: 100000, schema: z.number().int().min(1).max(1000000) },
  'root.providerIdMaxCharacters': { defaultValue: 64, schema: z.number().int().min(1).max(1000) },
  'root.emailMaxCharacters': { defaultValue: 320, schema: z.number().int().min(1).max(1000) },
  'root.planNameMaxCharacters': { defaultValue: 60, schema: z.number().int().min(1).max(1000) },
  'root.planKeyMaxCharacters': { defaultValue: 100, schema: z.number().int().min(1).max(1000) },
  'root.planFeatureKeyMaxCharacters': { defaultValue: 60, schema: z.number().int().min(1).max(1000) },
  'root.planFeatureMaxItems': { defaultValue: 60, schema: z.number().int().min(1).max(1000) },
  'root.planQuotaMaxValue': { defaultValue: 1000000, schema: z.number().int().min(1).max(1000000000) },
  'root.planMonthlyPriceMaxValue': { defaultValue: 10000000, schema: z.number().int().min(1).max(1000000000) },
  'root.planYearlyPriceMaxValue': { defaultValue: 100000000, schema: z.number().int().min(1).max(1000000000) },
  'root.planExtraChannelPriceMaxValue': { defaultValue: 1000000, schema: z.number().int().min(1).max(1000000000) },
  'diagnostics.identifierMaxCharacters': { defaultValue: 100, schema: z.number().int().min(1).max(100) },
  'diagnostics.labelMaxCharacters': { defaultValue: 160, schema: z.number().int().min(1).max(160) },
  'diagnostics.codeMaxCharacters': { defaultValue: 100, schema: z.number().int().min(1).max(100) },
  'diagnostics.messageMaxCharacters': { defaultValue: 500, schema: z.number().int().min(1).max(500) },
  'diagnostics.checksMaxItems': { defaultValue: 100, schema: z.number().int().min(1).max(100) },
  'diagnostics.confirmationMaxCharacters': { defaultValue: 300, schema: z.number().int().min(1).max(300) },
} as const;
export type SynchronousPolicyKey = keyof typeof SYNCHRONOUS_POLICY;

// Plain typed policy state; no server or database imports enter browser-safe schema helpers.
type PolicyValue<K extends SynchronousPolicyKey> = z.infer<(typeof SYNCHRONOUS_POLICY)[K]['schema']>;
type PolicySnapshot = { [K in SynchronousPolicyKey]?: PolicyValue<K> };
const state = ((globalThis as { __mspSynchronousPolicy?: PolicySnapshot }).__mspSynchronousPolicy ??= {});
export function synchronousPolicy<K extends SynchronousPolicyKey>(key: K): PolicyValue<K> {
  return (state[key] ?? SYNCHRONOUS_POLICY[key].defaultValue) as PolicyValue<K>;
}
export function applySynchronousPolicy(key: string, value: unknown): void {
  if (!Object.hasOwn(SYNCHRONOUS_POLICY, key)) return;
  const name = key as SynchronousPolicyKey;
  (state as Record<string, unknown>)[name] = SYNCHRONOUS_POLICY[name].schema.parse(value);
}
export const withinSynchronousLimit = (key: SynchronousPolicyKey) => (value: string) => { const limit = synchronousPolicy(key); return typeof limit === 'number' && value.length <= limit; };
