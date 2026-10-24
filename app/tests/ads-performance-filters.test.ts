import { describe, expect, it } from 'vitest';
import { parseAdsPerformanceFilters } from '../src/modules/ads/performance-filters';

const policy = { presets: [{ id: 'fortnight', days: 14, label: 'Past fortnight' }], defaultPreset: 'fortnight', maxRangeDays: 14, maxFilterCharacters: 40 };
const now = new Date('2026-10-17T18:12:00.000Z');
describe('Ads performance request mapping', () => {
  it('applies the same configured default as the sidebar', () => {
    expect(parseAdsPerformanceFilters({}, [], now, policy)).toEqual({ period: 'fortnight', accountId: null, since: new Date('2026-10-04T00:00:00.000Z'), until: new Date('2026-10-18T00:00:00.000Z') });
  });
  it('accepts a configured preset and refuses mixed or stale preset inputs', () => {
    expect(parseAdsPerformanceFilters({ period: 'fortnight' }, [], now, policy).period).toBe('fortnight');
    expect(() => parseAdsPerformanceFilters({ period: 'removed' }, [], now, policy)).toThrow();
    expect(() => parseAdsPerformanceFilters({ period: 'fortnight', start: '2026-10-01' }, [], now, policy)).toThrow();
    expect(() => parseAdsPerformanceFilters({ period: 'custom' }, [], now, policy)).toThrow();
    expect(() => parseAdsPerformanceFilters({ period: [] }, [], now, policy)).toThrow();
  });
  it('anchors an end-only request to the configured default number of days', () => {
    expect(parseAdsPerformanceFilters({ end: '2026-03-12' }, [], now, policy)).toMatchObject({ since: new Date('2026-02-27T00:00:00.000Z'), until: new Date('2026-03-13T00:00:00.000Z') });
  });
  it('ends a start-only request on the current UTC day', () => {
    expect(parseAdsPerformanceFilters({ start: '2026-10-17' }, [], now, policy)).toMatchObject({ since: new Date('2026-10-17T00:00:00.000Z'), until: new Date('2026-10-18T00:00:00.000Z') });
    expect(() => parseAdsPerformanceFilters({ start: '2026-10-01' }, [], now, policy)).toThrow(/14/);
  });
  it.each([{ start: '2026-02-30' }, { end: '2026-02-30' }, { start: null }, { end: ['2026-10-17'] }, { accountId: 12 }, { accountId: '' }, { accountId: 'all' }, { accountId: 'other' }])('refuses invalid inputs without broadening the report: %j', input => {
    expect(() => parseAdsPerformanceFilters(input, ['account-a'], now, policy)).toThrow();
  });
  it('preserves an explicitly authorized account and the exact inclusive ceiling', () => {
    expect(parseAdsPerformanceFilters({ accountId: 'account-a', start: '2026-10-01', end: '2026-10-14' }, ['account-a'], now, policy)).toMatchObject({ accountId: 'account-a', since: new Date('2026-10-01T00:00:00.000Z'), until: new Date('2026-10-15T00:00:00.000Z') });
    expect(() => parseAdsPerformanceFilters({ start: '2026-10-01', end: '2026-10-15' }, [], now, policy)).toThrow(/14/);
  });
});
