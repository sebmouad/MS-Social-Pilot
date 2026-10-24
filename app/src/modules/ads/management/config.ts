import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const ADS_MANAGEMENT_DEFAULT_POLICY = { historyPageLimit: 50, creativePageLimit: 25, nameMaxCharacters: 100, maxBudgetMinor: 100_000_000, recoveryNoteMaxCharacters: 500, creativeMessageMaxCharacters: 5000, creativeTitleMaxCharacters: 200, creativeUrlMaxCharacters: 2048, parentIdMaxCharacters: 100 };
export const ADS_MANAGEMENT_POLICY_SCHEMA = z.object({
  // Upper bounds preserve the current adapter/storage acceptance envelope; Root may tighten them.
  recoveryNoteMaxCharacters: z.number().int().min(1).max(500).default(500),
  creativeMessageMaxCharacters: z.number().int().min(1).max(5000).default(5000),
  creativeTitleMaxCharacters: z.number().int().min(1).max(200).default(200),
  creativeUrlMaxCharacters: z.number().int().min(1).max(2048).default(2048),
  parentIdMaxCharacters: z.number().int().min(1).max(100).default(100),
  historyPageLimit: z.number().int().min(1).max(200),
  creativePageLimit: z.number().int().min(1).max(100),
  nameMaxCharacters: z.number().int().min(10).max(500),
  /** Largest budget one confirmed change may set, in minor currency units (a typo guard, not a platform limit). */
  maxBudgetMinor: z.number().int().min(100).max(1_000_000_000_000),
}).strict();

/** Root-owned management limits. Registered by the host; validated and consumed at every management boundary. */
export const ADS_MANAGEMENT_CONFIG = [entry({
  key: 'ads.managementPolicy', group: 'Ads · Management', label: 'Ads management limits', kind: 'json',
  description: 'History and creative page sizes, object/identifier, recovery note and creative field lengths, and the largest budget a single change may set.',
  defaultValue: ADS_MANAGEMENT_DEFAULT_POLICY, schema: ADS_MANAGEMENT_POLICY_SCHEMA, consumption: 'active',
})] as const;
export type AdsManagementPolicy = z.infer<typeof ADS_MANAGEMENT_POLICY_SCHEMA>;
