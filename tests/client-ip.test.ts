import { describe, expect, it } from 'vitest';

import { clientIp } from '../src/lib/client-ip';

/**
 * Which address a request is attributed to, in front of each kind of proxy.
 *
 * Worth testing rather than reading, because the two callers care about
 * different failures: a click counted twice is a wrong number in a report, and
 * a sign-in limit keyed on the proxy's own address throttles every visitor
 * together the moment one of them starts guessing passwords.
 */

const withHeaders = (headers: Record<string, string>) =>
  new Request('http://localhost/l/abc', { headers });

describe('the address a request came from', () => {
  it('prefers what Cloudflare says over what the client claimed', () => {
    // Cloudflare overwrites its own header on every request and appends to
    // x-forwarded-for, so behind it the list still begins with whatever the
    // visitor sent. Reading the list first would take a visitor's word for it.
    const request = withHeaders({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '10.0.0.1, 203.0.113.7',
    });

    expect(clientIp(request)).toBe('203.0.113.7');
  });

  it('takes the left-most entry of the forwarded list', () => {
    // Everything after the first entry is the chain of proxies that carried
    // it, so the right-hand end is the proxy nearest this app.
    const request = withHeaders({ 'x-forwarded-for': '198.51.100.4, 70.41.3.18, 150.172.238.178' });

    expect(clientIp(request)).toBe('198.51.100.4');
  });

  it('trims the spaces a forwarded list is usually written with', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '  198.51.100.4 , 10.0.0.1' }))).toBe(
      '198.51.100.4',
    );
  });

  it('falls back to x-real-ip, which nginx sets and Cloudflare does not', () => {
    expect(clientIp(withHeaders({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('is null when nothing in front of the app said anything', () => {
    // A direct connection with no proxy. Null rather than a placeholder: the
    // callers decide what an unknown address means, and they differ.
    expect(clientIp(withHeaders({}))).toBeNull();
  });

  it('ignores a header that is present but empty', () => {
    // Some proxies send the header with nothing in it, and an empty string
    // read as an address makes every such visitor share one rate-limit key.
    const request = withHeaders({ 'cf-connecting-ip': '', 'x-forwarded-for': '198.51.100.4' });

    expect(clientIp(request)).toBe('198.51.100.4');
  });

  it('does not mistake a blank forwarded list for an address', () => {
    expect(clientIp(withHeaders({ 'x-forwarded-for': '   ', 'x-real-ip': '198.51.100.5' }))).toBe(
      '198.51.100.5',
    );
  });
});
