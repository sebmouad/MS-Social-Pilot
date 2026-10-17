import { OperationError } from '@/lib/operation-error';
import { ADS_REPORT_POLICY_SCHEMA } from '../config';
import type { AdsReportPolicy } from '../report-policy';
import { runtimeConfig } from '@/server/config/store';

export async function loadAdsReportPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsReportPolicy> {
  try {
    return ADS_REPORT_POLICY_SCHEMA.parse(await readConfig('ads.reportingFilters')) as AdsReportPolicy;
  } catch {
    throw new OperationError('unavailable', 'Reports are temporarily unavailable. Try again later.');
  }
}
