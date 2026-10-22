import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isAllowedWrite } from '@/server/cross-site-write';

const { readPolicy } = vi.hoisted(() => ({ readPolicy: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfigBatch: readPolicy }));
import { middleware, config } from '@/middleware';

const origin = 'https://social.example.test';
const policy = { publicOrigin: origin, developmentOrigins: ['http://localhost:3200'] };
function request(headers: Record<string, string> = {}, method = 'POST', path = '/api/settings/profile') {
  return new NextRequest(`http://localhost:3200${path}`, { method, headers });
}

describe('shared cross-site write provenance', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('leaves safe %s requests to their route', method => {
    expect(isAllowedWrite(request({ origin: 'null', 'sec-fetch-site': 'cross-site' }, method), policy)).toBe(true);
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses cross-site and sibling-site %s writes even with a forged trusted Origin', method => {
    for (const site of ['cross-site', 'same-site']) {
      expect(isAllowedWrite(request({ origin, 'sec-fetch-site': site }, method), policy)).toBe(false);
    }
  });
  it.each(['https://evil.example.test', 'null', `${origin}/`, `${origin}/path`, `${origin}, https://evil.test`, 'https://user@social.example.test', 'file:///tmp/test', ''])('rejects an untrusted/malformed origin %s', sent => {
    expect(isAllowedWrite(request({ origin: sent, 'sec-fetch-site': 'same-origin' }), policy)).toBe(false);
  });
  it('honors the exact public address behind an internal proxy and Root development origins', () => {
    expect(isAllowedWrite(request({ origin }), policy)).toBe(true);
    expect(isAllowedWrite(request({ origin: 'http://localhost:3200' }), policy)).toBe(true);
    expect(isAllowedWrite(request({ origin: 'http://localhost:3201' }), policy)).toBe(false);
  });
  it('never uses forged forwarding or Host headers as trusted origins', () => {
    expect(isAllowedWrite(request({ origin: 'https://evil.test', host: 'evil.test', 'x-forwarded-host': 'evil.test', forwarded: 'host=evil.test;proto=https' }), policy)).toBe(false);
  });
  it('uses the received origin only when Root public origin is empty', () => {
    expect(isAllowedWrite(request({ origin: 'http://localhost:3200' }), { publicOrigin: '', developmentOrigins: [] })).toBe(true);
    expect(isAllowedWrite(request({ origin: 'https://evil.test', 'x-forwarded-host': 'evil.test' }), { publicOrigin: '', developmentOrigins: [] })).toBe(false);
  });
  it('accepts a trusted Referer fallback but never lets it override a bad Origin', () => {
    expect(isAllowedWrite(request({ cookie: 'session=secret', referer: `${origin}/settings` }), policy)).toBe(true);
    expect(isAllowedWrite(request({ cookie: 'session=secret', referer: 'https://evil.test/' }), policy)).toBe(false);
    expect(isAllowedWrite(request({ origin: 'null', referer: `${origin}/settings` }), policy)).toBe(false);
  });
  it('denies originless cookie writes without browser-controlled same-origin evidence', () => {
    for (const site of [undefined, 'none', 'invalid', 'same-site', 'cross-site']) {
      expect(isAllowedWrite(request({ cookie: 'session=secret', ...(site ? { 'sec-fetch-site': site } : {}) }), policy)).toBe(false);
    }
    expect(isAllowedWrite(request({ cookie: 'session=secret', 'sec-fetch-site': 'same-origin' }), policy)).toBe(true);
  });
  it('does not allow Authorization to bypass cookie provenance checks', () => {
    expect(isAllowedWrite(request({ cookie: 'session=secret', authorization: 'Bearer invented' }), policy)).toBe(false);
  });
  it('preserves originless cookieless MCP, OAuth and signed-provider clients', () => {
    for (const path of ['/api/mcp', '/api/oauth/token', '/api/oauth/register', '/api/platforms/facebook/deauthorize']) {
      expect(isAllowedWrite(request({ authorization: 'Bearer client-credential' }, 'POST', path), policy)).toBe(true);
      expect(isAllowedWrite(request({}, 'POST', path), policy)).toBe(true);
    }
  });
  it('rejects cross-site form and JSON bodies alike', () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json']) {
      expect(isAllowedWrite(request({ origin: 'https://evil.test', 'content-type': contentType }), policy)).toBe(false);
    }
  });
});

describe('global mutation middleware', () => {
  beforeEach(() => { readPolicy.mockReset().mockResolvedValue({ 'app.publicOrigin': origin, 'app.developmentOrigins': [] }); });
  it('runs on every path with the Node runtime needed by the Root store', () => {
    expect(config).toEqual({ runtime: 'nodejs', matcher: '/:path*' });
  });
  it.each(['/api/auth/sign-out', '/api/auth/sign-in', '/api/publishing/posts', '/api/inbox/reply', '/api/analytics/goals', '/api/ads/management', '/api/settings/account', '/api/root/config', '/api/mcp', '/api/v1/posts', '/api/oauth/authorize', '/settings/profile'])('blocks a cross-site mutation on %s before dispatch', async path => {
    const result = await middleware(request({ origin: 'https://evil.test' }, 'POST', path));
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ code: 'CROSS_SITE_WRITE_DENIED' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-middleware-next')).toBeNull();
  });
  it.each(['owner', 'member', 'viewer'])('does not let the %s role bypass origin protection', async role => {
    expect((await middleware(request({ cookie: `role=${role}`, origin: 'https://evil.test' }))).status).toBe(403);
  });
  it('preserves trusted requests and reads current Root configuration', async () => {
    const result = await middleware(request({ origin, cookie: 'session=secret' }));
    expect(result.headers.get('x-middleware-next')).toBe('1');
    expect(readPolicy).toHaveBeenCalledWith(['app.publicOrigin', 'app.developmentOrigins']);
    readPolicy.mockResolvedValue({ 'app.publicOrigin': 'https://replacement.test', 'app.developmentOrigins': [] });
    expect((await middleware(request({ origin }))).status).toBe(403);
  });
  it('does not need configuration for reads but fails closed for mutations on configuration failure', async () => {
    readPolicy.mockRejectedValue(new Error('Database unavailable'));
    expect((await middleware(request({}, 'GET'))).headers.get('x-middleware-next')).toBe('1');
    expect(readPolicy).not.toHaveBeenCalled();
    const result = await middleware(request({ origin }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: 'WRITE_ORIGIN_CHECK_UNAVAILABLE' });
  });
});
