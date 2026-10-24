import { defaultAdsText } from '@/modules/ads/copy';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';

export type AdsReadPolicy = { pageSize: number; maxRows: number };

export const ADS_READ_DEFAULT_POLICY: AdsReadPolicy = { pageSize: 25, maxRows: 20000 };
export const ADS_READ_PAGE_SIZE_SCHEMA = z.number().int().min(1).max(100);
export const ADS_READ_MAX_ROWS_SCHEMA = z.number().int().min(1).max(100000);

export class AdsReportLimitError extends OperationError {
  constructor() {
    super('invalid_request', defaultAdsText('validation057'));
    this.name = 'AdsReportLimitError';
  }
}
