import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { defaultAdsText } from '@/modules/ads/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import { OperationError } from '@/lib/operation-error';
import { adsIsoDay } from '../report-filters';
import { parseAdsPerformanceFilters } from '../performance-filters';
import { normalizeAdsDailyRow } from '../report-data';
import { buildAdsReportCsv } from '../report-csv';
import { authorizeAdsRead, type AdsReadActor } from './access';
import { loadAdsReportPolicy } from './report-policy';
import { loadAdsOutputPolicy } from './output-policy';
import { getAdsAccounts, getAdsDataset, type AdsInsightLevel } from '@/modules/ads/server/queries';

export type AdsExportConstraints = { maxItems?: number };
const LEVELS: readonly AdsInsightLevel[] = ['account', 'campaign', 'adset', 'ad'];
const DAY = 86_400_000;
const INPUT_KEYS = new Set(['period', 'start', 'end', 'accountId', 'level', 'objectId']);

function recordInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', defaultAdsText('validation002'));
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !INPUT_KEYS.has(key))) throw new OperationError('invalid_request', defaultAdsText('validation002'));
  return value;
}

function text(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximum) throw new OperationError('invalid_request', defaultAdsText('validation003', { value0: name, value1: maximum }));
  return value;
}

function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

/** Produce a complete CSV report or refuse it; this service never exports a page or partial row set. */
export async function exportAdsReport(actor: AdsReadActor, input: unknown = {}, constraints: AdsExportConstraints = {}) {
  return withAdsCopySnapshot(async () => {
  const access = await authorizeAdsRead(actor);
  const values = recordInput(input);
  const [reportPolicy, outputPolicy] = await Promise.all([loadAdsReportPolicy(), loadAdsOutputPolicy()]);
  const level = text(values.level, 'level', reportPolicy.maxFilterCharacters);
  if (level !== undefined && !LEVELS.includes(level as AdsInsightLevel)) throw new OperationError('invalid_request', await adsServiceText('service013'));
  const objectId = text(values.objectId, 'objectId', reportPolicy.maxFilterCharacters);
  if (objectId !== undefined && (!objectId || /[\u0000-\u001f\u007f]/.test(objectId))) throw new OperationError('invalid_request', await adsServiceText('service014'));
  if (objectId !== undefined && (typeof values.accountId !== 'string' || typeof level !== 'string')) {
    throw new OperationError('invalid_request', await adsServiceText('service015'));
  }
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints) || Object.keys(constraints).some(key => key !== 'maxItems') ||
    (constraints.maxItems !== undefined && (!Number.isSafeInteger(constraints.maxItems) || constraints.maxItems < 1))) {
    throw new OperationError('invalid_request', await adsServiceText('service016'));
  }
  const period = text(values.period, 'period', reportPolicy.maxFilterCharacters);
  const start = text(values.start, 'start', reportPolicy.maxFilterCharacters);
  const end = text(values.end, 'end', reportPolicy.maxFilterCharacters);
  const accountId = text(values.accountId, 'accountId', reportPolicy.maxFilterCharacters);
  const accounts = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders, access.allowedAdAccountIds);
  const filters = parseAdsPerformanceFilters({ ...(period === undefined ? {} : { period }), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(accountId === undefined ? {} : { accountId }) }, accounts.map(account => account.id), new Date(), reportPolicy);
  if (objectId !== undefined && !filters.accountId) throw new OperationError('invalid_request', await adsServiceText('service015'));

  const levels = level === undefined ? undefined : [level as AdsInsightLevel];
  const dataset = await getAdsDataset(actor.workspaceId, filters, access.allowedTargetIds, access.allowedProviders, {
    allowedAdAccountIds: access.allowedAdAccountIds, ...(levels === undefined ? {} : { levels }), ...(objectId === undefined ? {} : { objectId }),
  });
  const maxItems = constraints.maxItems ?? dataset.maxRows;
  if (dataset.insights.length > maxItems) throw new OperationError('invalid_request', await adsServiceText('service017'));
  const rows = dataset.insights.map(normalizeAdsDailyRow).sort((a, b) =>
    compare(b.date, a.date) || compare(a.accountId, b.accountId) || compare(a.level, b.level) || compare(a.objectId, b.objectId) || compare(a.id, b.id));
  const csv = buildAdsReportCsv(rows, outputPolicy.exportMaxBytes);
  const from = adsIsoDay(filters.since), to = adsIsoDay(new Date(filters.until.getTime() - DAY));
  return {
    format: 'ms-social-pilot-ads-csv' as const,
    version: 1 as const,
    csv: csv.csv,
    fileName: outputPolicy.exportFileName,
    rowCount: csv.rowCount,
    byteLength: csv.byteLength,
    range: { from, to: adsIsoDay(filters.until), endExclusive: true as const },
    filters: { period: filters.period, start: from, end: to, accountId: filters.accountId, level: level ?? null, objectId: objectId ?? null },
    generatedAt: new Date().toISOString(),
    sensitiveFieldsRedacted: rows.reduce((count, row) => count + row.redactedPaths.length, 0),
  };

  });
}
