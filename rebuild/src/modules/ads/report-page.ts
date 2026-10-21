import { defaultAdsText } from '@/modules/ads/copy';
import { OperationError } from '@/lib/operation-error';

/** Safe public validation failure for an Ads report page number. */
export class AdsPageError extends OperationError {
  constructor() {
    super('invalid_request', defaultAdsText('validation070'));
    this.name = 'AdsPageError';
  }
}

/** Accept a single canonical positive integer supplied by the route query. */
export function parseAdsResultPage(raw: unknown): number {
  if (raw === undefined) return 1;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) throw new AdsPageError();
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 1) throw new AdsPageError();
  return page;
}

export type AdsPageSlice<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  resultCount: number;
  from: number;
  to: number;
};

/** Paginate a fully aggregated report collection, clamping stale links safely. */
export function pageAdsRows<T>(rows: readonly T[], requestedPage: number, pageSize: number): AdsPageSlice<T> {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new AdsPageError();
  }
  const resultCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;
  const items = rows.slice(offset, offset + pageSize);
  return {
    items, page, pageSize, pageCount, resultCount,
    from: resultCount === 0 ? 0 : offset + 1,
    to: resultCount === 0 ? 0 : offset + items.length,
  };
}
