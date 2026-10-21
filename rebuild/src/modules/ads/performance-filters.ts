import { defaultAdsText } from '@/modules/ads/copy';
import { OperationError } from '@/lib/operation-error';
import { adsIsoDay, isAdsReportDay, parseAdsFilters } from './report-filters';
import type { AdsReportPolicy } from './report-policy';

const DAY = 86_400_000; // Fixed UTC calendar duration.

/** Normalize the MCP date interface, then use the same policy and parser as UI. */
export function parseAdsPerformanceFilters(input: Record<string, unknown>, accountIds: readonly string[], now: Date, policy: AdsReportPolicy) {
  const optionalString = (key: 'start' | 'end' | 'accountId' | 'period') => {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > policy.maxFilterCharacters) throw new OperationError('invalid_request', defaultAdsText('filterTextLimit', { key, max: policy.maxFilterCharacters }));
    return value;
  };
  const start = optionalString('start'), end = optionalString('end'), accountId = optionalString('accountId');
  const period = optionalString('period');
  // Unlike the UI's reserved "all" option, a supplied MCP accountId is always
  // an explicit identity. Never let empty/reserved input become a wider report.
  if (accountId !== undefined && !accountIds.includes(accountId)) throw new OperationError('unavailable', defaultAdsText('validation055'));
  if (period !== undefined && period !== 'custom' && (start !== undefined || end !== undefined)) throw new OperationError('invalid_request', defaultAdsText('validation056'));
  if (period === 'custom') return parseAdsFilters({ period, since: start, until: end, account: accountId }, accountIds, now, policy);
  if (start === undefined && end === undefined) return parseAdsFilters({ period, account: accountId }, accountIds, now, policy);
  if (start !== undefined && !isAdsReportDay(start)) throw new OperationError('invalid_request', defaultAdsText('startDateFormat'));
  if (end !== undefined && !isAdsReportDay(end)) throw new OperationError('invalid_request', defaultAdsText('endDateFormat'));
  const until = end ?? adsIsoDay(now);
  const defaultDays = policy.presets.find(preset => preset.id === policy.defaultPreset)!.days;
  const since = start ?? adsIsoDay(new Date(new Date(`${until}T00:00:00.000Z`).getTime() - (defaultDays - 1) * DAY));
  return parseAdsFilters({ period: 'custom', since, until, account: accountId }, accountIds, now, policy);
}
