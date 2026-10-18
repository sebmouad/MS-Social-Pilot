import { describe, expect, it } from 'vitest';
import { assertAdsResultCeiling, validateAdsResultCeiling } from '../src/modules/ads/result-ceiling';
describe('Ads MCP result ceilings', () => {
  it('refuses a nested oversized series without truncating the original report', () => {
    const result = { groups: [{ trend: [{ day: 'one' }, { day: 'two' }] }] };
    expect(() => assertAdsResultCeiling(result, 1)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(result.groups[0]!.trend).toHaveLength(2);
  });
  it('does not confuse explanatory metadata with returned data rows', () => {
    expect(() => assertAdsResultCeiling({ items: [{ id: 'one' }], notes: ['one', 'two'] }, 1)).not.toThrow();
  });
  it.each([0, -1, NaN, 1.5])('refuses an invalid configured ceiling %s', maximum => {
    expect(() => validateAdsResultCeiling(maximum)).toThrow(expect.objectContaining({ code: 'unavailable' }));
  });
});
