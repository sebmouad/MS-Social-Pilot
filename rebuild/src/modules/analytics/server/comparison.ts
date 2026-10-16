import type { MetricView } from '@/server/analytics/aggregate';

/** UTC milliseconds per calendar day; analytics boundaries are UTC dates, unlike publishing workspace-local times. */
const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export type AnalyticsOperationErrorCode = 'invalid_date' | 'invalid_range' | 'range_too_large' | 'invalid_policy' | 'invalid_comparison' | 'duplicate_metric_identity';

export class AnalyticsComparisonError extends Error {
  readonly code: AnalyticsOperationErrorCode;

  constructor(code: AnalyticsOperationErrorCode) {
    super('The analytics operation could not be completed.');
    this.name = 'AnalyticsComparisonError';
    this.code = code;
  }
}

type ComparisonInput = MetricView & { coveredResourceIds?: readonly string[] };
type ComparisonResult = { previous: number | null; delta: number | null; percent: number | null; status: 'comparable' | 'missing' | 'coverage_changed' | 'not_comparable' };

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AnalyticsComparisonError('invalid_date');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new AnalyticsComparisonError('invalid_date');
  }
  return { year, month, day };
}

function utcDate(value: string, endOfDay = false): Date {
  const { year, month, day } = dateParts(value);
  const result = new Date(0);
  result.setUTCHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  result.setUTCFullYear(year, month - 1, day);
  return result;
}

function dayString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftYear(value: string): string {
  const { year, month, day } = dateParts(value);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year - 1, month - 1, day);
  if (candidate.getUTCMonth() !== month - 1) candidate.setUTCFullYear(year - 1, month - 1, 28);
  return dayString(candidate);
}

export function analyticsDateRange(
  input: { start?: string; end?: string; compare?: 'none' | 'previous' | 'year' },
  policy: { defaultDays: number; maxDays: number; now?: Date },
): {
  start: string;
  end: string;
  range: { from: Date; to: Date };
  comparison: null | { mode: 'previous' | 'year'; start: string; end: string; range: { from: Date; to: Date } };
} {
  if (!Number.isSafeInteger(policy.defaultDays) || !Number.isSafeInteger(policy.maxDays) || policy.defaultDays < 1 || policy.maxDays < 1 || policy.defaultDays > policy.maxDays) {
    throw new AnalyticsComparisonError('invalid_policy');
  }
  const now = policy.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new AnalyticsComparisonError('invalid_policy');
  const today = dayString(now);
  const end = input.end === undefined ? today : dayString(utcDate(input.end));
  const endDate = utcDate(end);
  const start = input.start === undefined
    ? dayString(new Date(endDate.getTime() - (policy.defaultDays - 1) * UTC_DAY_MS))
    : dayString(utcDate(input.start));
  const startDate = utcDate(start);
  if (startDate.getTime() > endDate.getTime()) throw new AnalyticsComparisonError('invalid_range');
  const dayCount = Math.floor((endDate.getTime() - startDate.getTime()) / UTC_DAY_MS) + 1;
  if (dayCount > policy.maxDays) throw new AnalyticsComparisonError('range_too_large');
  if (input.compare !== undefined && !['none', 'previous', 'year'].includes(input.compare)) {
    throw new AnalyticsComparisonError('invalid_comparison');
  }
  const range = { from: startDate, to: utcDate(end, true) };
  if (!input.compare || input.compare === 'none') return { start, end, range, comparison: null };

  let comparisonStart: string;
  let comparisonEnd: string;
  if (input.compare === 'previous') {
    const offset = dayCount * UTC_DAY_MS;
    comparisonEnd = dayString(new Date(startDate.getTime() - UTC_DAY_MS));
    comparisonStart = dayString(new Date(startDate.getTime() - offset));
  } else {
    comparisonStart = shiftYear(start);
    comparisonEnd = shiftYear(end);
  }
  return {
    start,
    end,
    range,
    comparison: {
      mode: input.compare,
      start: comparisonStart,
      end: comparisonEnd,
      range: { from: utcDate(comparisonStart), to: utcDate(comparisonEnd, true) },
    },
  };
}

function metricIdentity(metric: ComparisonInput): string {
  return JSON.stringify([metric.key, metric.sourceLabel, metric.resourceKind, metric.unit]);
}

function indexMetrics(metrics: ComparisonInput[]): Map<string, ComparisonInput> {
  const indexed = new Map<string, ComparisonInput>();
  for (const metric of metrics) {
    const identity = metricIdentity(metric);
    if (indexed.has(identity)) throw new AnalyticsComparisonError('duplicate_metric_identity');
    indexed.set(identity, metric);
  }
  return indexed;
}

function sameCoveredResources(current: ComparisonInput, previous: ComparisonInput): boolean {
  const currentIds = current.coveredResourceIds;
  const previousIds = previous.coveredResourceIds;
  if (currentIds === undefined || previousIds === undefined) return false;
  if (currentIds.length !== current.coverage || previousIds.length !== previous.coverage || currentIds.length !== previousIds.length) return false;
  const currentSet = new Set(currentIds);
  const previousSet = new Set(previousIds);
  return currentSet.size === currentIds.length && previousSet.size === previousIds.length && previousIds.every(id => currentSet.has(id));
}

function comparison(current: ComparisonInput, previous: ComparisonInput): ComparisonResult {
  const previousValue = previous.total;
  if (current.coverage !== previous.coverage || current.available !== previous.available || !sameCoveredResources(current, previous)) {
    return { previous: previousValue, delta: null, percent: null, status: 'coverage_changed' };
  }
  if (current.available === 0 || current.coverage !== current.available || current.kind !== previous.kind || current.aggregationLabel !== previous.aggregationLabel ||
      !['stock', 'flow', 'ratio'].includes(current.kind) || current.total === null || previousValue === null ||
      current.displayTotal !== undefined || previous.displayTotal !== undefined || !Number.isFinite(current.total) || !Number.isFinite(previousValue)) {
    return { previous: previousValue, delta: null, percent: null, status: 'not_comparable' };
  }
  const delta = current.total - previousValue;
  const percent = previousValue === 0 ? (current.total === 0 ? 0 : null) : (delta / Math.abs(previousValue)) * 100;
  if (!Number.isFinite(delta) || (percent !== null && !Number.isFinite(percent))) {
    return { previous: previousValue, delta: null, percent: null, status: 'not_comparable' };
  }
  return { previous: previousValue, delta, percent, status: 'comparable' };
}

/** Compare neutral scalar metrics. Unknown resource identities cannot establish comparable coverage. */
export function compareAnalytics(current: MetricView[], previous: MetricView[]): Map<string, ComparisonResult> {
  const currentByIdentity = indexMetrics(current);
  const previousByIdentity = indexMetrics(previous);
  const identities = new Set([...currentByIdentity.keys(), ...previousByIdentity.keys()]);
  const result = new Map<string, ComparisonResult>();
  for (const identity of identities) {
    const currentMetric = currentByIdentity.get(identity);
    const previousMetric = previousByIdentity.get(identity);
    result.set(identity, currentMetric && previousMetric
      ? comparison(currentMetric as ComparisonInput, previousMetric as ComparisonInput)
      : { previous: previousMetric?.total ?? null, delta: null, percent: null, status: 'missing' });
  }
  return result;
}
