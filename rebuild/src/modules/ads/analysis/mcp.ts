import { assertAdsResultCeiling, validateAdsResultCeiling } from '../result-ceiling';
import { OperationError } from '@/lib/operation-error';
import type { AdsReadActor } from '../server/access';
import { readAdsComparison } from './server';

const filters = {
  period: { type: 'string' }, start: { type: 'string', description: 'Inclusive UTC day, YYYY-MM-DD.' }, end: { type: 'string', description: 'Inclusive UTC day, YYYY-MM-DD.' },
  accountId: { type: 'string' }, compare: { type: 'string', enum: ['previous', 'accounts'], description: 'previous compares with the preceding window of equal length; accounts compares each account.' },
  level: { type: 'string', enum: ['campaign', 'adset', 'ad'] },
  sort: { type: 'string', enum: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'name'] }, direction: { type: 'string', enum: ['asc', 'desc'] },
};
export const adsAnalysisTools = new Set(['compare_ads_performance']);
export const adsAnalysisWriteTools = new Set<string>();
export const adsAnalysisToolDefinitions = [{
  name: 'compare_ads_performance',
  description: 'Compare stored Ads performance with the previous period or across accounts: totals, deltas, daily trend, findings, sorted objects and data freshness. Currencies are never combined.',
  inputSchema: { type: 'object', properties: filters, additionalProperties: false },
}];
export async function executeAdsAnalysisTool(actor: AdsReadActor, name: string, args: Record<string, unknown>, maxResultItems?: number) {
  if (name !== 'compare_ads_performance') throw new OperationError('invalid_request', 'Unknown Ads analysis tool.');
  validateAdsResultCeiling(maxResultItems);
  const result = await readAdsComparison(actor, args);
  assertAdsResultCeiling(result, maxResultItems);
  return result;
}
