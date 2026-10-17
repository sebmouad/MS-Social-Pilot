import { OperationError } from '@/lib/operation-error';

// Existing report presets live in one Ads-owned catalog rather than separately
// in the parser and picker. Runtime configuration of this catalog remains open.
export const ADS_REPORT_PRESETS = [
  { id: '7d', days: 7, label: 'Last 7 days' },
  { id: '30d', days: 30, label: 'Last 30 days' },
  { id: '90d', days: 90, label: 'Last 90 days' },
] as const;
export type AdsPeriod = typeof ADS_REPORT_PRESETS[number]['id'] | 'custom';
export type AdsFilters = { period: AdsPeriod; since: Date; until: Date; accountId: string | null };
export type AdsSearchParams = { period?: string | string[]; since?: string | string[]; until?: string | string[]; account?: string | string[] };
export type AdsFilterField = keyof AdsSearchParams;
export type AdsFilterErrors = Partial<Record<AdsFilterField, string>>;

export class AdsFilterError extends OperationError {
  constructor(readonly fields: AdsFilterErrors, code: 'invalid_request' | 'unavailable' = 'invalid_request') {
    super(code, 'Review the highlighted filters before loading results.');
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
export function parseAdsFilters(params: AdsSearchParams, accountIds: readonly string[], now = new Date()): AdsFilters {
  const errors: AdsFilterErrors = {};
  const single = (key: AdsFilterField) => {
    const value = params[key];
    if (Array.isArray(value)) {
      if (value.length !== 1) errors[key] = 'Choose one value for this filter.';
      return value[0];
    }
    return value;
  };
  const requestedPeriod = single('period') ?? '30d';
  const preset = ADS_REPORT_PRESETS.find(item => item.id === requestedPeriod);
  if (!preset && requestedPeriod !== 'custom') errors.period = 'Choose an available date range.';
  const requestedAccount = single('account');
  const accountId = requestedAccount && requestedAccount !== 'all' ? requestedAccount : null;
  if (accountId && !accountIds.includes(accountId)) errors.account = 'This account is unavailable. Choose an available account or All accounts.';
  const since = single('since'), until = single('until');
  let customStart: Date | null = null, customEnd: Date | null = null;
  if (requestedPeriod === 'custom') {
    if (!isAdsReportDay(since)) errors.since = 'Enter a valid start date.';
    else customStart = new Date(`${since}T00:00:00.000Z`);
    if (!isAdsReportDay(until)) errors.until = 'Enter a valid end date.';
    else customEnd = new Date(`${until}T00:00:00.000Z`);
    if (customStart && customEnd && customStart > customEnd) errors.until = 'End date must be on or after start date.';
  }
  if (Object.keys(errors).length) throw new AdsFilterError(errors, errors.account && Object.keys(errors).length === 1 && !Array.isArray(params.account) ? 'unavailable' : 'invalid_request');
  if (customStart && customEnd) return { period: 'custom', since: customStart, until: new Date(customEnd.getTime() + DAY), accountId };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { period: preset!.id, since: new Date(today.getTime() - (preset!.days - 1) * DAY), until: new Date(today.getTime() + DAY), accountId };
}
