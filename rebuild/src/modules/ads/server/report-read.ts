import { OperationError } from '@/lib/operation-error';
import { parseAdsPerformanceFilters } from '../performance-filters';
import { loadAdsReportPolicy } from './report-policy';
import { loadAdsReadPolicy } from './read-policy';
import { loadAdsOutputPolicy } from './output-policy';
import { authorizeAdsRead, type AdsReadActor } from './access';
import { getAdsAccounts, getAdsDataset, type AdsInsightLevel } from '@/server/ads/queries';
import { adsIsoDay } from '../report-filters';
import { normalizeAdsDailyRow } from '../report-data';

export type AdsReadConstraints = { maxItems?: number };
const LEVELS: readonly AdsInsightLevel[] = ['account', 'campaign', 'adset', 'ad'];
const DAY = 86_400_000;
const INPUT_KEYS = new Set(['period', 'start', 'end', 'accountId', 'level', 'objectId', 'offset', 'limit']);

function recordInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', 'Choose valid Ads report filters.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !INPUT_KEYS.has(key))) throw new OperationError('invalid_request', 'Choose valid Ads report filters.');
  return value;
}

function optionalText(input: Record<string, unknown>, key: string, maximum: number): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximum) throw new OperationError('invalid_request', `Choose valid Ads report filters. ${key} must be text with at most ${maximum} characters.`);
  return value;
}

function safeInteger(value: unknown, minimum: number, maximum: number, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new OperationError('invalid_request', `Choose a ${name} from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

/** Read one complete bounded Ads dataset, then return a deterministic byte-bounded daily page. */
export async function readAdsDailyRows(actor: AdsReadActor, input: unknown = {}, constraints: AdsReadConstraints = {}) {
  const access = await authorizeAdsRead(actor);
  const values = recordInput(input);
  const reportPolicy = await loadAdsReportPolicy();
  const readPolicy = await loadAdsReadPolicy();
  const level = optionalText(values, 'level', reportPolicy.maxFilterCharacters);
  if (level !== undefined && !LEVELS.includes(level as AdsInsightLevel)) throw new OperationError('invalid_request', 'Choose one valid Ads report level.');
  const objectId = optionalText(values, 'objectId', reportPolicy.maxFilterCharacters);
  if (objectId !== undefined && (!objectId || /[\u0000-\u001f\u007f]/.test(objectId))) throw new OperationError('invalid_request', 'Choose a valid Ads object id.');
  if (objectId !== undefined && (typeof values.accountId !== 'string' || typeof level !== 'string')) {
    throw new OperationError('invalid_request', 'An Ads object id requires one explicit account and report level.');
  }
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints) || Object.keys(constraints).some(key => key !== 'maxItems') ||
    (constraints.maxItems !== undefined && (!Number.isSafeInteger(constraints.maxItems) || constraints.maxItems < 1))) {
    throw new OperationError('invalid_request', 'Choose valid Ads report filters.');
  }
  const start = optionalText(values, 'start', reportPolicy.maxFilterCharacters);
  const end = optionalText(values, 'end', reportPolicy.maxFilterCharacters);
  const accountId = optionalText(values, 'accountId', reportPolicy.maxFilterCharacters);
  const period = optionalText(values, 'period', reportPolicy.maxFilterCharacters);
  const filtersInput = { ...(period === undefined ? {} : { period }), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }), ...(accountId === undefined ? {} : { accountId }) };
  const accounts = await getAdsAccounts(actor.workspaceId, access.allowedTargetIds, access.allowedProviders);
  const filters = parseAdsPerformanceFilters(filtersInput, accounts.map(account => account.id), new Date(), reportPolicy);
  if (objectId !== undefined && !filters.accountId) throw new OperationError('invalid_request', 'An Ads object id requires one explicit account and report level.');

  const requestedLimit = safeInteger(values.limit, 1, readPolicy.maxRows, readPolicy.pageSize, 'report limit');
  const offset = safeInteger(values.offset, 0, Number.MAX_SAFE_INTEGER, 0, 'report offset');
  const levels = level === undefined ? undefined : [level as AdsInsightLevel];
  const dataset = await getAdsDataset(actor.workspaceId, filters, access.allowedTargetIds, access.allowedProviders, {
    ...(levels === undefined ? {} : { levels }), ...(objectId === undefined ? {} : { objectId }),
  });
  const sorted = [...dataset.insights].sort((a, b) =>
    b.date.getTime() - a.date.getTime() || compare(a.adAccountId, b.adAccountId) || compare(a.level, b.level) || compare(a.objectId, b.objectId) || compare(a.id, b.id));
  const requestedPageSize = values.limit === undefined ? dataset.pageSize : requestedLimit;
  const boundedLimit = Math.min(requestedPageSize, constraints.maxItems ?? dataset.maxRows, dataset.maxRows);
  const pageStart = Math.min(offset, sorted.length);
  const rows = sorted.slice(pageStart, Math.min(sorted.length, pageStart + boundedLimit)).map(normalizeAdsDailyRow);
  const filtersResult = {
    period: filters.period,
    start: adsIsoDay(filters.since),
    end: adsIsoDay(new Date(filters.until.getTime() - DAY)),
    accountId: filters.accountId,
    level: level ?? null,
    objectId: objectId ?? null,
  };
  const result = {
    format: 'ms-social-pilot-ads-daily' as const,
    version: 1 as const,
    range: { from: filtersResult.start, to: adsIsoDay(filters.until), endExclusive: true as const },
    filters: filtersResult,
    reportOptions: reportPolicy,
    resultCount: sorted.length,
    rows,
    offset,
    limit: boundedLimit,
    nextOffset: offset + rows.length < sorted.length ? offset + rows.length : null,
    generatedAt: new Date().toISOString(),
  };
  const outputPolicy = await loadAdsOutputPolicy();
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > outputPolicy.detailMaxBytes) {
    throw new OperationError('invalid_request', 'This Ads report is too large to return. Choose a shorter range, fewer results, or a lower result limit.');
  }
  return result;
}
