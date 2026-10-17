import { describe, expect, it } from 'vitest';
import { normalizeAdsDailyRow, sanitizeAdsReportJson } from '../src/modules/ads/report-data';
import type { InsightRow } from '../src/server/ads/summary';

const source: InsightRow = {
  id: 'daily-1', adAccountId: 'account-1', level: 'campaign', objectId: 'campaign-1', objectName: 'Spring',
  date: new Date('2026-10-13T00:00:00.000Z'), spend: 12, impressions: 1000, clicks: 20, reach: 800,
  cpc: 0.6, cpm: 12, cpp: null, ctr: 2, frequency: 1.25,
  actions: [{ action_type: 'link_click', value: '10', nested: { token_count: 4, access_Token: 'private' } }],
  fields: { newMetric: { breakdown: [1, null, { value: 4 }] } },
  adAccount: { id: 'account-1', name: 'Main', currency: 'USD' },
};

describe('Ads report data', () => {
  it('normalizes stored rows without filtering raw metrics or replacing nullable ratios', () => {
    const result = normalizeAdsDailyRow(source);
    expect(result).toMatchObject({
      id: 'daily-1', accountId: 'account-1', accountName: 'Main', currency: 'USD', level: 'campaign',
      objectId: 'campaign-1', objectName: 'Spring', date: '2026-10-13T00:00:00.000Z', spend: 12,
      impressions: 1000, clicks: 20, reach: 800, cpc: 0.6, cpm: 12, cpp: null, ctr: 2, frequency: 1.25,
      actions: [{ action_type: 'link_click', value: '10', nested: { token_count: 4, access_Token: '[REDACTED]' } }],
      fields: { newMetric: { breakdown: [1, null, { value: 4 }] } },
      fetchedAt: null,
    });
    expect(result.redactedPaths).toEqual(['$.actions[0].nested.access_Token']);
  });

  it('preserves a stored fetchedAt timestamp as ISO metadata', () => {
    const result = normalizeAdsDailyRow({ ...source, fetchedAt: new Date('2026-10-14T06:07:08.009Z') });
    expect(result.fetchedAt).toBe('2026-10-14T06:07:08.009Z');
  });

  it('redacts credential keys and sensitive URL parts while preserving unrelated metrics', () => {
    const result = sanitizeAdsReportJson({
      Authorization: 'Bearer secret', refresh_token: 'refresh', setCookie: 'session=secret',
      accessToken: 'access', bearer_token: 'bearer', idToken: 'identity', api_key: 'api', token_count: 12, key: 'ordinary metric key',
      metric: 'https://user:pass@example.test/path?access_token=hidden&access-token=second&key=query-secret&oauth_signature=signed&X-Amz-Signature=cloud-signed&X-Amz-Credential=cloud-id&keep=1#private',
      relativeMetric: '//user:pass@example.test/path?refresh_token=hidden&token_count=12#private',
      signed: { signature: 'signed-value', oauthSignature: 'oauth-value', x_amz_signature: 'cloud-value' },
      rows: [{ clientSecret: 'secret', total: 3 }],
    });
    expect(result.value).toEqual({
      Authorization: '[REDACTED]', refresh_token: '[REDACTED]', setCookie: '[REDACTED]',
      accessToken: '[REDACTED]', bearer_token: '[REDACTED]', idToken: '[REDACTED]', api_key: '[REDACTED]', token_count: 12,
      key: 'ordinary metric key',
      metric: 'https://[REDACTED]@example.test/path?access_token=[REDACTED]&access-token=[REDACTED]&key=[REDACTED]&oauth_signature=[REDACTED]&X-Amz-Signature=[REDACTED]&X-Amz-Credential=[REDACTED]&keep=1#[REDACTED]',
      relativeMetric: '//[REDACTED]@example.test/path?refresh_token=[REDACTED]&token_count=12#[REDACTED]',
      signed: { signature: '[REDACTED]', oauthSignature: '[REDACTED]', x_amz_signature: '[REDACTED]' },
      rows: [{ clientSecret: '[REDACTED]', total: 3 }],
    });
    expect(result.redactedPaths).toEqual([
      '$.Authorization', '$.refresh_token', '$.setCookie', '$.accessToken', '$.bearer_token', '$.idToken', '$.api_key',
      '$.metric.<userinfo>', '$.metric.<query:access_token>', '$.metric.<query:access-token>', '$.metric.<query:key>',
      '$.metric.<query:oauth_signature>', '$.metric.<query:X-Amz-Signature>', '$.metric.<query:X-Amz-Credential>', '$.metric.<fragment>',
      '$.relativeMetric.<userinfo>', '$.relativeMetric.<query:refresh_token>', '$.relativeMetric.<fragment>',
      '$.signed.signature', '$.signed.oauthSignature', '$.signed.x_amz_signature', '$.rows[0].clientSecret',
    ]);
  });

  it('fails closed on malformed URL-shaped strings rather than preserving possible userinfo', () => {
    expect(() => sanitizeAdsReportJson({ metric: 'https://user:private@[invalid' }))
      .toThrowError(expect.objectContaining({ code: 'unavailable' }));
  });

  it('clones JSON keys without allowing prototype mutation', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"metric":2}');
    const result = sanitizeAdsReportJson(input);
    expect(Object.getPrototypeOf(result.value)).toBeNull();
    expect(Object.hasOwn(result.value as object, '__proto__')).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects invalid numeric scalars with a safe unavailable error', () => {
    expect(() => normalizeAdsDailyRow({ ...source, spend: Number.NaN })).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    let dateError: unknown;
    try { normalizeAdsDailyRow({ ...source, date: new Date(Number.NaN) }); } catch (error) { dateError = error; }
    expect(dateError).toMatchObject({ code: 'unavailable' });
    expect((dateError as Error).message).not.toContain('NaN');
    expect(() => normalizeAdsDailyRow({ ...source, fetchedAt: new Date(Number.NaN) } as InsightRow))
      .toThrowError(expect.objectContaining({ code: 'unavailable' }));
  });

  it('rejects cycles and unsupported nested values without exposing their contents', () => {
    const cycle: Record<string, unknown> = { safe: 1, token: 'do-not-print' };
    cycle.self = cycle;
    expect(() => sanitizeAdsReportJson(cycle)).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    expect(() => sanitizeAdsReportJson({ safe: BigInt(1), password: 'do-not-print' })).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    expect(() => sanitizeAdsReportJson({ safe: () => 'do-not-print' })).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    expect(() => sanitizeAdsReportJson([1, Symbol('unsupported')])).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    const extraArrayValue: unknown[] & { metric?: string } = [1];
    extraArrayValue.metric = 'would-be-dropped';
    expect(() => sanitizeAdsReportJson(extraArrayValue)).toThrowError(expect.objectContaining({ code: 'unavailable' }));
  });

  it('walks deeply nested JSON iteratively', () => {
    let input: unknown = 'kept';
    for (let index = 0; index < 20000; index++) input = { child: input };
    const result = sanitizeAdsReportJson(input);
    expect(result.redactedPaths).toEqual([]);
  });
});
