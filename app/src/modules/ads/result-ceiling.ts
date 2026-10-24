import { defaultAdsText } from '@/modules/ads/copy';
import { OperationError } from '@/lib/operation-error';
const RECORD_ARRAYS = new Set(['groups', 'objects', 'trend', 'daily', 'items', 'accounts']);
export function validateAdsResultCeiling(maximum: number | undefined) {
  if (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 1)) throw new OperationError('unavailable', defaultAdsText('validation071'));
}
/** Refuse a complete read that cannot fit; never silently change totals or coverage. */
export function assertAdsResultCeiling(result: unknown, maximum: number | undefined) {
  validateAdsResultCeiling(maximum);
  if (maximum === undefined) return;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child)) {
        if (RECORD_ARRAYS.has(key) && child.length > maximum) throw new OperationError('invalid_request', defaultAdsText('validation072'));
        for (const item of child) visit(item);
      } else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(result);
}
