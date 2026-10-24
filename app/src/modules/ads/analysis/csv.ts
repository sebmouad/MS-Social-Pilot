import { defaultAdsText } from '@/modules/ads/copy';
import { OperationError } from '@/lib/operation-error';
import { quote, safeText } from '../report-csv';
import { adsFindingText, adsCopy, type AdsAnalysisCopy, type AdsLocale } from './copy';
import type { AdsComparisonResult } from './server';

export const ADS_COMPARISON_CSV_COLUMNS = [
  'group', 'currency', 'account_id', 'account_name', 'level', 'object_id', 'object_name', 'spend', 'share_of_spend_percent',
  'impressions', 'clicks', 'ctr_percent', 'cpc', 'cpm', 'reach_peak_day', 'actions_json', 'range_from', 'range_to_exclusive', 'previous_range_from', 'previous_range_to_exclusive',
  'previous_spend', 'previous_impressions', 'previous_clicks', 'previous_ctr_percent', 'previous_cpc', 'previous_cpm',
  'spend_change_percent', 'impressions_change_percent', 'clicks_change_percent', 'ctr_change_percent', 'cpc_change_percent', 'cpm_change_percent', 'daily_trend_json',
] as const;

const encoder = new TextEncoder();
const text = (value: string) => quote(safeText(value));
const num = (value: number | null) => {
  if (value === null) return 'Not available';
  if (!Number.isFinite(value)) throw new OperationError('unavailable', defaultAdsText('validation034'));
  return String(value);
};

/**
 * One row per compared object. Unknown figures are Not available, never zero, and amounts
 * keep their group's currency so different currencies are never mixed in a column.
 */
export function buildAdsComparisonCsv(result: AdsComparisonResult, maxBytes: number, kind: 'objects' | 'findings' = 'objects', locale: AdsLocale = 'en', copy: AdsAnalysisCopy = adsCopy): { csv: string; rowCount: number; byteLength: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new OperationError('invalid_request', defaultAdsText('validation035'));
  const columns = kind === 'objects' ? ADS_COMPARISON_CSV_COLUMNS : ['group', 'currency', 'account_ids_json', 'level', 'range_from', 'range_to_exclusive', 'previous_range_from', 'previous_range_to_exclusive', 'tone', 'finding_key', 'message', 'params_json'];
  const lines: string[] = [];
  let byteLength = 0;
  const append = (line: string) => {
    byteLength += encoder.encode(line).byteLength;
    if (byteLength > maxBytes) throw new OperationError('invalid_request', defaultAdsText('validation036'));
    lines.push(line);
  };
  append(`${columns.join(',')}\r\n`);
  let rowCount = 0;
  for (const group of result.groups) {
    if (group.objectCount !== group.objects.length) throw new OperationError('invalid_request', defaultAdsText('validation037'));
    if (kind === 'findings') {
      for (const finding of group.findings) {
        append(`${[
          text(group.key), text(group.currency ?? 'Not available'), quote(JSON.stringify(group.accounts.map(account => account.id))), text(result.level),
          text(result.range.from), text(result.range.to), text(result.previousRange?.from ?? 'Not available'), text(result.previousRange?.to ?? 'Not available'),
          text(finding.tone), text(finding.key), text(adsFindingText(locale, finding.key, finding.params, copy)), quote(JSON.stringify(finding.params)),
        ].join(',')}\r\n`);
        rowCount += 1;
      }
      continue;
    }
    for (const object of group.objects) {
      append(`${[
        text(group.key), text(group.currency ?? 'Not available'), text(object.accountId), text(object.accountName), text(result.level), text(object.objectId), text(object.name),
        num(object.spend), num(object.sharePercent), num(object.impressions), num(object.clicks), num(object.ctr), num(object.cpc), num(object.cpm), num(object.reachPeakDay),
        quote(JSON.stringify(object.actions).replaceAll('\u0000', '')), text(result.range.from), text(result.range.to),
        text(result.previousRange?.from ?? 'Not available'), text(result.previousRange?.to ?? 'Not available'),
        ...(['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'] as const).map(key => num(object.previous?.[key] ?? null)),
        ...(['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'] as const).map(key => num(object.kpis.find(kpi => kpi.key === key)?.changePercent ?? null)),
        quote(JSON.stringify(object.trend)),
      ].join(',')}\r\n`);
      rowCount += 1;
    }
  }
  const csv = lines.join('');
  return { csv, rowCount, byteLength };
}
