import { describe, expect, it } from 'vitest';

import { isCrossSiteWrite } from '../src/lib/cross-site';

describe('isCrossSiteWrite', () => {
  it('refuses a write another site started, including a sibling subdomain', () => {
    expect(isCrossSiteWrite('POST', 'cross-site')).toBe(true);
    expect(isCrossSiteWrite('DELETE', 'same-site')).toBe(true);
    expect(isCrossSiteWrite('patch', 'Cross-Site')).toBe(true);
  });

  it('lets through the app talking to itself', () => {
    expect(isCrossSiteWrite('POST', 'same-origin')).toBe(false);
  });

  it('lets through callers that are not browsers, which send nothing', () => {
    // Meta's data-deletion callback, the cron endpoint, curl.
    expect(isCrossSiteWrite('POST', null)).toBe(false);
  });

  it('never blocks a read', () => {
    // The Facebook OAuth callback arrives cross-site, as a GET.
    expect(isCrossSiteWrite('GET', 'cross-site')).toBe(false);
    expect(isCrossSiteWrite('HEAD', 'cross-site')).toBe(false);
  });
});
