import { OperationError } from '@/lib/operation-error';
import type { AdsDailyRow } from './report-data';

export const ADS_REPORT_CSV_COLUMNS = [
  'row_id', 'account_id', 'account_name', 'currency', 'level', 'object_id', 'object_name', 'date', 'fetched_at', 'spend',
  'impressions', 'clicks', 'reach', 'cpc', 'cpm', 'cpp', 'ctr', 'frequency', 'actions_json', 'fields_json', 'redacted_paths_json',
] as const;

const EXPORT_LIMIT_MESSAGE = 'Advertising report exceeds the configured export size limit.';
const encoder = new TextEncoder();

export function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function safeText(value: string): string {
  return /^[\s\uFEFF]*[=+\-@＝＋－＠]/.test(value) ? `'${value}` : value;
}

function jsonCell(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error();
    return serialized;
  } catch {
    throw new OperationError('unavailable', 'Advertising report data is temporarily unavailable.');
  }
}

function scalarCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new OperationError('unavailable', 'Advertising report data is temporarily unavailable.');
    return String(value);
  }
  return quote(safeText(value));
}

function rowCsv(row: AdsDailyRow): string {
  const cells: string[] = [
    scalarCell(row.id), scalarCell(row.accountId), scalarCell(row.accountName), scalarCell(row.currency),
    scalarCell(row.level), scalarCell(row.objectId), scalarCell(row.objectName), scalarCell(row.date), scalarCell(row.fetchedAt),
    scalarCell(row.spend), scalarCell(row.impressions), scalarCell(row.clicks), scalarCell(row.reach),
    scalarCell(row.cpc), scalarCell(row.cpm), scalarCell(row.cpp), scalarCell(row.ctr), scalarCell(row.frequency),
    quote(jsonCell(row.actions)), quote(jsonCell(row.fields)), quote(jsonCell(row.redactedPaths)),
  ];
  return `${cells.join(',')}\r\n`;
}

/** Build one complete UTF-8 CSV v1 payload, refusing the whole export above its byte ceiling. */
export function buildAdsReportCsv(rows: readonly AdsDailyRow[], maxBytes: number): { csv: string; rowCount: number; byteLength: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new OperationError('invalid_request', 'Choose a valid advertising report export size limit.');
  let byteLength = 0;
  let csv = '';
  const append = (record: string) => {
    const recordBytes = encoder.encode(record).byteLength;
    if (byteLength + recordBytes > maxBytes) throw new OperationError('invalid_request', EXPORT_LIMIT_MESSAGE);
    csv += record;
    byteLength += recordBytes;
  };
  append(`${ADS_REPORT_CSV_COLUMNS.join(',')}\r\n`);
  for (const row of rows) append(rowCsv(row));
  return { csv, rowCount: rows.length, byteLength };
}
