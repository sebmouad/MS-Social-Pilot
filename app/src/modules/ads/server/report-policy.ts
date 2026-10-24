import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { OperationError } from '@/lib/operation-error';
import { ADS_REPORT_POLICY_SCHEMA } from '../config';
import type { AdsReportPolicy } from '../report-policy';
import { runtimeConfig } from '@/server/config/store';

export async function loadAdsReportPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsReportPolicy> {
  return withAdsCopySnapshot(async () => {
  try {
    return ADS_REPORT_POLICY_SCHEMA.parse(await readConfig('ads.reportingFilters')) as AdsReportPolicy;
  } catch {
    throw new OperationError('unavailable', await adsServiceText('service024'));
  }

  });
}
