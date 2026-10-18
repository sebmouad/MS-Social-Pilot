import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { ADS_ANALYSIS_DEFAULT_POLICY } from './metrics';

const positive = (max: number) => z.number().int().min(1).max(max);
const ratio = z.number().min(1).max(100);
export const ADS_ANALYSIS_POLICY_SCHEMA = z.object({
  minImpressions: positive(10_000_000), minClicks: positive(10_000_000),
  changeThresholdPercent: z.number().min(1).max(1000), concentrationPercent: z.number().min(1).max(100),
  bestCtrRatio: ratio, costlyCpcRatio: ratio, costlyMinSpendSharePercent: z.number().min(0).max(100),
  staleAfterHours: positive(24 * 365), maxCompareAccounts: positive(100), maxObjects: positive(5000),
}).strict();

/** Root-owned analysis thresholds. Installed by the typed host configuration registry. */
export const ADS_ANALYSIS_CONFIG = [entry({
  key: 'ads.analysisPolicy', group: 'Ads · Analysis', label: 'Ads analysis thresholds', kind: 'json',
  description: 'Sample-size minimums, change thresholds, freshness window and list bounds for Ads comparison, findings and object browsing.',
  defaultValue: ADS_ANALYSIS_DEFAULT_POLICY, schema: ADS_ANALYSIS_POLICY_SCHEMA, consumption: 'active',
})] as const;
