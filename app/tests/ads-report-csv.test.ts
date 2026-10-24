import { describe, expect, it } from 'vitest';
import { buildAdsReportCsv, ADS_REPORT_CSV_COLUMNS } from '../src/modules/ads/report-csv';
import type { AdsDailyRow } from '../src/modules/ads/report-data';

const row: AdsDailyRow = {
  id: 'row-1', accountId: 'account-1', accountName: ' Café, "North"\nTeam', currency: 'EUR', level: 'campaign',
  objectId: 'object-1', objectName: '  =HYPERLINK("bad")', date: '2026-10-13T00:00:00.000Z', spend: -1,
  fetchedAt: '2026-10-14T06:07:08.009Z',
  impressions: 100, clicks: 2, reach: 50, cpc: null, cpm: 10, cpp: 0.02, ctr: 2, frequency: 1.5,
  actions: [{ action_type: 'purchase', value: '2' }], fields: { customMetric: 'safe' }, redactedPaths: [],
};

describe('Ads report CSV v1', () => {
  it('exports every daily row with stable columns, safe spreadsheet strings and finite numeric cells', () => {
    const result = buildAdsReportCsv([row], 10000);
    expect(ADS_REPORT_CSV_COLUMNS).toEqual([
      'row_id', 'account_id', 'account_name', 'currency', 'level', 'object_id', 'object_name', 'date', 'fetched_at', 'spend',
      'impressions', 'clicks', 'reach', 'cpc', 'cpm', 'cpp', 'ctr', 'frequency', 'actions_json', 'fields_json', 'redacted_paths_json',
    ]);
    expect(result.csv).toContain('" Café');
    expect(result.csv).toContain('"\'  =HYPERLINK(""bad"")"');
    expect(result.csv).toContain('\r\n');
    expect(result.csv).toContain('"2026-10-13T00:00:00.000Z","2026-10-14T06:07:08.009Z",-1');
    expect(result.csv).toContain(',-1,100,2,50,,10,0.02,2,1.5,');
    expect(result).toMatchObject({ rowCount: 1, byteLength: new TextEncoder().encode(result.csv).byteLength });
  });

  it('preserves raw rows and currencies without aggregation and emits headers for an empty result', () => {
    const second = { ...row, id: 'row-2', accountId: 'account-2', currency: 'USD', spend: 0 };
    expect(buildAdsReportCsv([row, second], 10000).rowCount).toBe(2);
    const empty = buildAdsReportCsv([], 10000);
    expect(empty.rowCount).toBe(0);
    expect(empty.csv).toBe(`${ADS_REPORT_CSV_COLUMNS.join(',')}\r\n`);
  });

  it('defends formula-like text after whitespace or BOM while preserving typed finite negatives', () => {
    const result = buildAdsReportCsv([{
      ...row,
      id: '=1+1',
      accountName: '\t+SUM(1,1)',
      objectName: '\uFEFF@HYPERLINK("bad")',
      currency: '-not-a-number',
      spend: -12.5,
      actions: { note: '=still JSON text' },
    }], 10000);
    expect(result.csv).toContain(`"'=1+1"`);
    expect(result.csv).toContain('"\'\t+SUM(1,1)"');
    expect(result.csv).toContain('"\'\uFEFF@HYPERLINK(""bad"")"');
    expect(result.csv).toContain('"\'-not-a-number"');
    expect(buildAdsReportCsv([{ ...row, id: '＝1+1' }], 10000).csv).toContain(`"'＝1+1"`);
    expect(result.csv).toContain(',-12.5,');
    expect(result.csv).toContain('"{""note"":""=still JSON text""}"');
    expect(result.byteLength).toBe(new TextEncoder().encode(result.csv).byteLength);
  });

  it('accepts the exact UTF-8 byte cap and rejects one byte less without returning a partial CSV', () => {
    const exact = buildAdsReportCsv([row], 10000);
    expect(buildAdsReportCsv([row], exact.byteLength).byteLength).toBe(exact.byteLength);
    expect(() => buildAdsReportCsv([row], exact.byteLength - 1)).toThrowError(expect.objectContaining({ code: 'invalid_request' }));
    expect(() => buildAdsReportCsv([], new TextEncoder().encode(`${ADS_REPORT_CSV_COLUMNS.join(',')}\r\n`).byteLength - 1))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('guards malformed byte limits', () => {
    expect(() => buildAdsReportCsv([], 0)).toThrowError(expect.objectContaining({ code: 'invalid_request' }));
    expect(() => buildAdsReportCsv([], Number.POSITIVE_INFINITY)).toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
});
