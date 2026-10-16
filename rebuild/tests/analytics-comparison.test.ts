import { describe, expect, it } from 'vitest';
import { AnalyticsComparisonError, analyticsDateRange, compareAnalytics } from '../src/modules/analytics/server/comparison';
import type { MetricView } from '../src/server/analytics/aggregate';

const metric = (overrides: Partial<MetricView> & { coveredResourceIds?: readonly string[] } = {}): MetricView & { coveredResourceIds?: readonly string[] } => ({
  key: 'views', label: 'Views', sourceLabel: 'Community', resourceKind: 'channel',
  aggregationLabel: 'Total over the selected period', unit: 'count', kind: 'flow', total: 20,
  latestAt: null, coverage: 2, available: 2, coveredResourceIds: ['resource-a', 'resource-b'], points: [], rows: [], ...overrides,
});

describe('analytics date ranges', () => {
  const policy = { defaultDays: 7, maxDays: 31, now: new Date('2026-10-16T18:42:00.000Z') };

  it('uses inclusive UTC calendar dates and end-of-day boundaries', () => {
    const result = analyticsDateRange({}, policy);
    expect(result).toMatchObject({ start: '2026-10-10', end: '2026-10-16' });
    expect(result.range.from.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(result.range.to.toISOString()).toBe('2026-10-16T23:59:59.999Z');
  });

  it('builds an equal-day previous period and a clamped calendar-year comparison', () => {
    const previous = analyticsDateRange({ start: '2026-10-10', end: '2026-10-16', compare: 'previous' }, policy);
    expect(previous.comparison).toMatchObject({ mode: 'previous', start: '2026-10-03', end: '2026-10-09' });
    const year = analyticsDateRange({ start: '2024-02-29', end: '2024-03-01', compare: 'year' }, policy);
    expect(year.comparison).toMatchObject({ mode: 'year', start: '2023-02-28', end: '2023-03-01' });
  });

  it('defaults a missing end to UTC today and rejects impossible dates, reversed ranges, and oversized ranges', () => {
    expect(analyticsDateRange({ start: '2026-10-12' }, policy).end).toBe('2026-10-16');
    for (const input of [
      [{ start: '2026-02-31', end: '2026-03-02' }, 'invalid_date'],
      [{ start: '2026-10-17', end: '2026-10-16' }, 'invalid_range'],
      [{ start: '2026-09-15', end: '2026-10-16' }, 'range_too_large'],
    ]) {
      try {
        analyticsDateRange(input[0] as { start: string; end: string }, policy);
        throw new Error('expected invalid range');
      } catch (error) {
        expect(error).toBeInstanceOf(AnalyticsComparisonError);
        expect((error as AnalyticsComparisonError).code).toBe(input[1]);
      }
    }
  });
});

describe('analytics comparisons', () => {
  const identity = (value: MetricView) => JSON.stringify([value.key, value.sourceLabel, value.resourceKind, value.unit]);

  it('compares finite, fully covered compatible metrics and treats ratio deltas as percentage points', () => {
    const current = metric({ kind: 'ratio', unit: 'percent', total: 3, aggregationLabel: 'Calculated for the selected period' });
    const previous = metric({ kind: 'ratio', unit: 'percent', total: 2, aggregationLabel: 'Calculated for the selected period' });
    expect(compareAnalytics([current], [previous]).get(identity(current))).toEqual({ previous: 2, delta: 1, percent: 50, status: 'comparable' });
  });

  it('keeps missing values distinct from zero and defines a zero baseline percentage', () => {
    const current = metric({ total: 0 });
    const previous = metric({ total: 0 });
    expect(compareAnalytics([current], [previous]).get(identity(current))).toEqual({ previous: 0, delta: 0, percent: 0, status: 'comparable' });
    expect(compareAnalytics([current], []).get(identity(current))).toMatchObject({ previous: null, delta: null, percent: null, status: 'missing' });
    expect(compareAnalytics([metric({ total: 4 })], [metric({ total: 0 })]).values().next().value).toMatchObject({ percent: null });
  });

  it('marks changed or incomplete coverage and incompatible aggregation as not comparable', () => {
    const current = metric({ coverage: 1, available: 2 });
    const changed = metric({ coverage: 2, available: 2 });
    expect(compareAnalytics([current], [changed]).get(identity(current))?.status).toBe('coverage_changed');
    expect(compareAnalytics([metric()], [metric({ aggregationLabel: 'Latest value per resource' })]).values().next().value?.status).toBe('not_comparable');
    expect(compareAnalytics([metric({ total: null })], [metric()]).values().next().value?.status).toBe('not_comparable');
  });

  it('checks covered resource identity sets when the caller supplies them', () => {
    const current = metric({ coveredResourceIds: ['a', 'b'] });
    const previous = metric({ coveredResourceIds: ['a', 'c'] });
    expect(compareAnalytics([current], [previous]).get(identity(current))?.status).toBe('coverage_changed');
    const duplicatePrevious = metric({ coveredResourceIds: ['a', 'a'] });
    expect(compareAnalytics([current], [duplicatePrevious]).get(identity(current))?.status).toBe('coverage_changed');
  });

  it('does not compare equal coverage counts when covered resource identities are missing', () => {
    const { coveredResourceIds: _ids, ...current } = metric();
    const { coveredResourceIds: _previousIds, ...previous } = metric();
    expect(compareAnalytics([current], [previous]).values().next().value?.status).toBe('coverage_changed');
  });

  it('matches identities without labels and rejects duplicate identities safely', () => {
    const a = metric({ key: 'reach', label: 'Reach', total: 10 });
    const b = metric({ key: 'reach', label: 'Different display label', total: 8 });
    const result = compareAnalytics([a], [b]);
    expect(result.size).toBe(1);
    expect(result.get(identity(a))).toMatchObject({ previous: 8, delta: 2 });
    expect(() => compareAnalytics([a, a], [b])).toThrowError();
  });
});
