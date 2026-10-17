import { describe, expect, it } from 'vitest';
import { ADS_REPORT_POLICY_SCHEMA } from '../src/modules/ads/config';
import { ADS_REPORT_DEFAULT_POLICY } from '../src/modules/ads/report-policy';
import { parseAdsFilters } from '../src/modules/ads/report-filters';
import { loadAdsReportPolicy } from '../src/modules/ads/server/report-policy';

const customPolicy = {
  presets: [{ id: '14d', days: 14, label: 'Past two weeks' }], defaultPreset: '14d',
  maxRangeDays: 30, maxFilterCharacters: 40,
};

describe('Ads report policy', () => {
  it('validates a bounded custom preset catalog', () => {
    expect(ADS_REPORT_POLICY_SCHEMA.parse(customPolicy)).toEqual(customPolicy);
  });
  it.each([
    { ...customPolicy, presets: [...customPolicy.presets, { id: '14d', days: 3, label: 'Duplicate' }] },
    { ...customPolicy, presets: [{ id: 'custom', days: 3, label: 'Reserved' }] },
    { ...customPolicy, defaultPreset: 'missing' },
    { ...customPolicy, maxRangeDays: 13 },
    { ...customPolicy, maxFilterCharacters: 0 },
    { ...customPolicy, maxFilterCharacters: 9 },
    { ...customPolicy, maxFilterCharacters: 10, presets: [{ id: '12345678901', days: 14, label: 'Two weeks' }] },
    { ...customPolicy, presets: [{ id: '14d', days: 14, label: 'Past two weeks\n' }] },
  ])('rejects unsafe or inconsistent policy: %j', policy => {
    expect(() => ADS_REPORT_POLICY_SCHEMA.parse(policy)).toThrow();
  });
  it('uses configured labels and default preset values', () => {
    expect(ADS_REPORT_DEFAULT_POLICY.defaultPreset).toBe('30d');
    const filters = parseAdsFilters({}, [], new Date('2026-10-17T12:00:00Z'), customPolicy);
    expect(filters.period).toBe('14d');
    expect(filters.since.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });
  it('enforces inclusive custom range limit and filter text cap', () => {
    expect(() => parseAdsFilters({ period: 'custom', since: '2026-01-01', until: '2026-01-30' }, [], new Date(), customPolicy)).not.toThrow();
    expect(() => parseAdsFilters({ period: 'custom', since: '2026-01-01', until: '2026-01-31' }, [], new Date(), customPolicy)).toThrow();
    expect(() => parseAdsFilters({ period: 'custom', since: 'x'.repeat(41), until: '2026-01-02' }, [], new Date(), customPolicy)).toThrow();
  });
  it('rejects unknown requested presets without defaulting', () => {
    expect(() => parseAdsFilters({ period: '999d' }, [], new Date(), customPolicy)).toThrow();
  });
  it('classifies overlong account input as invalid instead of unavailable', () => {
    expect(() => parseAdsFilters({ account: 'x'.repeat(41) }, ['x'.repeat(41)], new Date(), customPolicy))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
  it('hides configuration failure details from customer-facing errors', async () => {
    await expect(loadAdsReportPolicy(async () => { throw new Error('database secret: do-not-disclose'); }))
      .rejects.toMatchObject({ code: 'unavailable', message: 'Reports are temporarily unavailable. Try again later.' });
  });
  it('loads a validated serializable policy instead of a source fallback', async () => {
    expect(await loadAdsReportPolicy(async () => customPolicy)).toEqual(customPolicy);
  });
  it('fails closed when stored policy is invalid', async () => {
    await expect(loadAdsReportPolicy(async () => ({ ...customPolicy, defaultPreset: 'missing' }))).rejects.toMatchObject({ code: 'unavailable', message: 'Reports are temporarily unavailable. Try again later.' });
  });
});
