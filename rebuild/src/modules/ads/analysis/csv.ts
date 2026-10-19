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
