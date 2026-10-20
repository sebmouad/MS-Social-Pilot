import { OperationError } from '@/lib/operation-error';
import { quote, safeText } from '../report-csv';
import type { AdsComparisonResult } from './server';

export const ADS_COMPARISON_CSV_COLUMNS = [
  'group', 'currency', 'account_id', 'account_name', 'level', 'object_id', 'object_name', 'spend', 'share_of_spend_percent',
  'impressions', 'clicks', 'ctr_percent', 'cpc', 'cpm', 'reach_peak_day', 'actions_json', 'range_from', 'range_to_exclusive',
] as const;

const encoder = new TextEncoder();
const text = (value: string) => quote(safeText(value));
const num = (value: number | null) => {
  if (value === null) return '';
  if (!Number.isFinite(value)) throw new OperationError('unavailable', 'Ads comparison data is temporarily unavailable.');
  return String(value);
};

/**
 * One row per compared object. Unknown figures are empty cells, never zero, and amounts
 * keep their group's currency so different currencies are never mixed in a column.
 */
export function buildAdsComparisonCsv(result: AdsComparisonResult, maxBytes: number): { csv: string; rowCount: number; byteLength: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new OperationError('invalid_request', 'Choose a valid export size limit.');
  const lines = [`${ADS_COMPARISON_CSV_COLUMNS.join(',')}\r\n`];
  let rowCount = 0;
  for (const group of result.groups) {
    for (const object of group.objects) {
      lines.push(`${[
        text(group.key), text(group.currency ?? ''), text(object.accountId), text(object.accountName), text(result.level), text(object.objectId), text(object.name),
        num(object.spend), num(object.sharePercent), num(object.impressions), num(object.clicks), num(object.ctr), num(object.cpc), num(object.cpm), num(object.reachPeakDay),
        quote(JSON.stringify(object.actions).replaceAll('\u0000', '')), text(result.range.from), text(result.range.to),
      ].join(',')}\r\n`);
      rowCount += 1;
    }
  }
  const csv = lines.join('');
  const byteLength = encoder.encode(csv).byteLength;
  if (byteLength > maxBytes) throw new OperationError('invalid_request', 'Advertising comparison exceeds the configured export size limit.');
  return { csv, rowCount, byteLength };
}

export const ADS_COMPARISON_DAILY_CSV_COLUMNS = [
  'group', 'currency', 'accounts', 'date', 'spend', 'impressions', 'clicks', 'ctr_percent', 'cpc', 'cpm', 'range_from', 'range_to_exclusive',
] as const;

const round = (value: number) => Math.round(value * 100) / 100;

/** Account-level daily series, one row per group and day. Ratios are recomputed from the day's flows; zero denominators stay empty. */
export function buildAdsComparisonDailyCsv(result: AdsComparisonResult, maxBytes: number): { csv: string; rowCount: number; byteLength: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new OperationError('invalid_request', 'Choose a valid export size limit.');
  const lines = [`${ADS_COMPARISON_DAILY_CSV_COLUMNS.join(',')}\r\n`];
  let rowCount = 0;
  for (const group of result.groups) {
    const accounts = group.accounts.map(account => account.name).join('; ');
    for (const day of group.trend) {
      lines.push(`${[
        text(group.key), text(group.currency ?? ''), text(accounts), text(day.date), num(day.spend), num(day.impressions), num(day.clicks),
        num(day.impressions > 0 ? round((day.clicks / day.impressions) * 100) : null), num(day.clicks > 0 ? round(day.spend / day.clicks) : null),
        num(day.impressions > 0 ? round((day.spend / day.impressions) * 1000) : null), text(result.range.from), text(result.range.to),
      ].join(',')}\r\n`);
      rowCount += 1;
    }
  }
  const csv = lines.join('');
  const byteLength = encoder.encode(csv).byteLength;
  if (byteLength > maxBytes) throw new OperationError('invalid_request', 'Advertising comparison exceeds the configured export size limit.');
  return { csv, rowCount, byteLength };
}

export const ADS_DIRECTORY_CSV_COLUMNS = [
  'account_id', 'account_name', 'currency', 'level', 'object_id', 'object_name', 'parent_id', 'spend', 'impressions', 'clicks', 'ctr_percent', 'cpc', 'cpm',
  'last_delivery_day', 'last_fetched_at', 'range_from', 'range_to_exclusive',
] as const;

type DirectoryLike = { level: string; range: { from: string; to: string }; items: ReadonlyArray<{
  accountId: string; accountName: string; currency: string | null; objectId: string; name: string; parentId: string | null;
  spend: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null; cpm: number | null;
  lastDeliveryDate: string | null; lastFetchedAt: string | null }> };

/** The object directory (one row per campaign, ad set or ad) with parent link and last delivery day. */
export function buildAdsDirectoryCsv(result: DirectoryLike, maxBytes: number): { csv: string; rowCount: number; byteLength: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new OperationError('invalid_request', 'Choose a valid export size limit.');
  const lines = [`${ADS_DIRECTORY_CSV_COLUMNS.join(',')}\r\n`];
  for (const item of result.items) {
    lines.push(`${[
      text(item.accountId), text(item.accountName), text(item.currency ?? ''), text(result.level), text(item.objectId), text(item.name), text(item.parentId ?? ''),
      num(item.spend), num(item.impressions), num(item.clicks), num(item.ctr), num(item.cpc), num(item.cpm),
      text(item.lastDeliveryDate ?? ''), text(item.lastFetchedAt ?? ''), text(result.range.from), text(result.range.to),
    ].join(',')}\r\n`);
  }
  const csv = lines.join('');
  const byteLength = encoder.encode(csv).byteLength;
  if (byteLength > maxBytes) throw new OperationError('invalid_request', 'Advertising objects exceed the configured export size limit.');
  return { csv, rowCount: result.items.length, byteLength };
}
