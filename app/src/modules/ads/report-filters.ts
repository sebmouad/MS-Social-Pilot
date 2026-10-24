import { defaultAdsText } from '@/modules/ads/copy';
import { OperationError } from '@/lib/operation-error';
import { ADS_REPORT_DEFAULT_POLICY, type AdsReportPolicy } from './report-policy';

export type AdsPeriod = string;
export type AdsFilters = { period: AdsPeriod; since: Date; until: Date; accountId: string | null };
export type AdsSearchParams = { period?: string | string[]; since?: string | string[]; until?: string | string[]; account?: string | string[] };
export type AdsFilterField = keyof AdsSearchParams;
export type AdsFilterErrors = Partial<Record<AdsFilterField, string>>;

export class AdsFilterError extends OperationError {
  constructor(readonly fields: AdsFilterErrors, code: 'invalid_request' | 'unavailable' = 'invalid_request') {
    super(code, Object.values(fields).filter(Boolean).join(' '));
  }
}

const DAY = 24 * 60 * 60 * 1000; // UTC calendar duration, not an operational setting.
export const adsIsoDay = (date: Date) => date.toISOString().slice(0, 10);
export const isAdsReportDay = (value: string | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && adsIsoDay(date) === value;
};

/** Invalid input never changes the caller's requested scope to a default report. */
export function parseAdsFilters(params: AdsSearchParams, accountIds: readonly string[], now = new Date(), policy: AdsReportPolicy = ADS_REPORT_DEFAULT_POLICY): AdsFilters {
  const errors: AdsFilterErrors = {};
  let accountFilterTooLong = false;
  const single = (key: AdsFilterField) => {
    const value = params[key];
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (values.some(item => item.length > policy.maxFilterCharacters)) {
      errors[key] = defaultAdsText('validation061', { value0: policy.maxFilterCharacters });
      if (key === 'account') accountFilterTooLong = true;
    }
    if (Array.isArray(value)) {
      if (value.length !== 1) errors[key] = defaultAdsText('validation062');
      return value[0];
    }
    return value;
  };
  const requestedPeriod = single('period') ?? policy.defaultPreset;
  const preset = policy.presets.find(item => item.id === requestedPeriod);
  if (!preset && requestedPeriod !== 'custom') errors.period = defaultAdsText('validation063');
  const requestedAccount = single('account');
  const accountId = requestedAccount && requestedAccount !== 'all' ? requestedAccount : null;
  const unavailableAccount = Boolean(accountId && !accountIds.includes(accountId));
  if (unavailableAccount && !accountFilterTooLong) errors.account = defaultAdsText('validation064');
  if (requestedAccount === '') errors.account = defaultAdsText('validation065');
  const since = single('since'), until = single('until');
  let customStart: Date | null = null, customEnd: Date | null = null;
  if (requestedPeriod === 'custom') {
    if (!isAdsReportDay(since)) errors.since = defaultAdsText('validation066');
    else customStart = new Date(`${since}T00:00:00.000Z`);
    if (!isAdsReportDay(until)) errors.until = defaultAdsText('validation067');
    else customEnd = new Date(`${until}T00:00:00.000Z`);
    if (customStart && customEnd && customStart > customEnd) errors.until = defaultAdsText('validation068');
    if (customStart && customEnd && Math.floor((customEnd.getTime() - customStart.getTime()) / DAY) + 1 > policy.maxRangeDays) errors.until = defaultAdsText('validation069', { value0: policy.maxRangeDays });
  }
  if (Object.keys(errors).length) throw new AdsFilterError(errors, unavailableAccount && !accountFilterTooLong && Object.keys(errors).length === 1 && !Array.isArray(params.account) ? 'unavailable' : 'invalid_request');
  if (customStart && customEnd) return { period: 'custom', since: customStart, until: new Date(customEnd.getTime() + DAY), accountId };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { period: preset!.id, since: new Date(today.getTime() - (preset!.days - 1) * DAY), until: new Date(today.getTime() + DAY), accountId };
}
