import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { ADS_READ_MAX_ROWS_SCHEMA, ADS_READ_PAGE_SIZE_SCHEMA, type AdsReadPolicy } from '../read-policy';

export async function loadAdsReadPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsReadPolicy> {
  try {
    const [pageSize, maxRows] = await Promise.all([
      readConfig('ads.reportPageSize'),
      readConfig('ads.reportMaxRows'),
    ]);
    return {
      pageSize: ADS_READ_PAGE_SIZE_SCHEMA.parse(pageSize),
      maxRows: ADS_READ_MAX_ROWS_SCHEMA.parse(maxRows),
    };
  } catch {
    throw new OperationError('unavailable', 'Reports are temporarily unavailable. Try again later.');
  }
}
