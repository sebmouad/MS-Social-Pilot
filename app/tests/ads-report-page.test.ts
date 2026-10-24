import { describe, expect, it } from 'vitest';
import { pageAdsRows, parseAdsResultPage, AdsPageError } from '../src/modules/ads/report-page';

describe('Ads report pagination', () => {
  it('defaults a missing page to the first page and accepts canonical positive safe integers', () => {
    expect(parseAdsResultPage(undefined)).toBe(1);
    expect(parseAdsResultPage('1')).toBe(1);
    expect(parseAdsResultPage('24')).toBe(24);
  });

  it.each(['', '0', '-1', '1.0', '1e2', '+1', '01', '9007199254740992', ['2', '3']])('rejects malformed or repeated result pages: %s', value => {
    expect(() => parseAdsResultPage(value)).toThrow(AdsPageError);
  });

  it('slices only the requested window and reports the full total', () => {
    expect(pageAdsRows(['a', 'b', 'c', 'd', 'e'], 2, 2)).toEqual({
      items: ['c', 'd'], page: 2, pageSize: 2, pageCount: 3, resultCount: 5, from: 3, to: 4,
    });
  });

  it('clamps stale pages to the last nonempty page and gives empty data a stable first page', () => {
    expect(pageAdsRows(['a', 'b', 'c'], 9, 2)).toMatchObject({ items: ['c'], page: 2, pageCount: 2, from: 3, to: 3, resultCount: 3 });
    expect(pageAdsRows([], 9, 2)).toEqual({ items: [], page: 1, pageSize: 2, pageCount: 1, resultCount: 0, from: 0, to: 0 });
  });
});
