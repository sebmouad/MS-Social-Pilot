import { describe, expect, it, vi } from 'vitest';
import { checkUrlShape, guardedFetch, isNonPublicAddress, NetGuardError, type FetchDeps, type FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';

const policy: FetchPolicy = { timeoutMs: 1000, maxBytes: 1000, maxRedirects: 2, allowHttp: false, hostAllowlist: [] };
const body = (text: string, init: ResponseInit = {}) => new Response(text, { status: 200, ...init });
const deps = (responses: Response[], answers: string[] = ['93.184.216.34']): FetchDeps & { fetcher: ReturnType<typeof vi.fn> } => {
  const queue = [...responses];
  return { resolve: vi.fn(async () => answers), fetcher: vi.fn(async () => queue.shift()!) } as never;
};
const reason = async (p: Promise<unknown>) => { try { await p; return 'none'; } catch (e) { return e instanceof NetGuardError ? e.reason : 'other'; } };

describe('SSRF guard', () => {
  it.each(['http://example.com/a', 'ftp://example.com', 'https://user:pw@example.com', 'https://example.com:8443/x', 'https://localhost/x', 'https://intranet/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://192.168.1.1/', 'https://100.64.0.1/', 'https://thing.internal/'])('refuses %s without any network', url => {
    expect(() => checkUrlShape(url, { allowHttp: false, hostAllowlist: [] })).toThrow(NetGuardError);
  });
  it('allows http only when configured, and enforces the allowlist', () => {
    expect(() => checkUrlShape('http://example.com/a', { allowHttp: true, hostAllowlist: [] })).not.toThrow();
    expect(() => checkUrlShape('https://other.org/a', { allowHttp: false, hostAllowlist: ['example.com'] })).toThrow(/not on the allowed/);
    expect(() => checkUrlShape('https://cdn.example.com/a', { allowHttp: false, hostAllowlist: ['example.com'] })).not.toThrow();
  });
  it('classifies addresses', () => {
    for (const a of ['0.0.0.0', '127.0.0.1', '172.16.0.1', '172.31.255.255', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1']) expect(isNonPublicAddress(a)).toBe(true);
    for (const a of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) expect(isNonPublicAddress(a)).toBe(false);
  });
  it('fails closed when DNS answers are private, mixed or empty', async () => {
    for (const answers of [['10.0.0.1'], ['93.184.216.34', '127.0.0.1'], ['2001:2::1'], []]) {
      const d = deps([body('x')], answers);
      expect(await reason(guardedFetch('https://example.com/a', policy, d))).toBe('blocked_address');
      expect(d.fetcher).not.toHaveBeenCalled();
    }
  });
  it('re-checks every redirect hop, including a hop to a private literal', async () => {
    const d = deps([new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/meta' } })]);
    expect(await reason(guardedFetch('https://example.com/a', policy, d))).toBe('blocked_host');
    expect(d.fetcher).toHaveBeenCalledTimes(1);
  });
  it('limits redirects, size and status', async () => {
    const loop = () => new Response(null, { status: 301, headers: { location: 'https://example.com/b' } });
    expect(await reason(guardedFetch('https://example.com/a', policy, deps([loop(), loop(), loop()])))).toBe('too_many_redirects');
    expect(await reason(guardedFetch('https://example.com/a', policy, deps([body('x'.repeat(2000))])))).toBe('too_large');
    expect(await reason(guardedFetch('https://example.com/a', policy, deps([body('x', { headers: { 'content-length': '999999' } })])))).toBe('too_large');
    expect(await reason(guardedFetch('https://example.com/a', policy, deps([new Response('no', { status: 500 })])))).toBe('bad_status');
  });
  it('maps transport failure and timeout without provider text', async () => {
    const failing: FetchDeps = { resolve: async () => ['93.184.216.34'], fetcher: async () => { throw new Error('ECONNRESET secret-host'); } };
    const error = await guardedFetch('https://example.com/a', policy, failing).catch(e => e);
    expect(error).toBeInstanceOf(NetGuardError);
    expect(error.message).not.toMatch(/secret|ECONN/);
    const slow: FetchDeps = { resolve: async () => ['93.184.216.34'], fetcher: ({ signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) };
    expect(await reason(guardedFetch('https://example.com/a', { ...policy, timeoutMs: 20 }, slow))).toBe('timeout');
  });
  it('bounds DNS resolution by the overall deadline, including late failures', async () => {
    const never: FetchDeps = { resolve: () => new Promise(() => {}), fetcher: vi.fn() };
    expect(await reason(guardedFetch('https://example.com/a', { ...policy, timeoutMs: 20 }, never))).toBe('timeout');
    const lateReject: FetchDeps = { resolve: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late')), 30)), fetcher: vi.fn() };
    expect(await reason(guardedFetch('https://example.com/a', { ...policy, timeoutMs: 10 }, lateReject))).toBe('timeout');
  });
  it('links caller cancellation and bounds a fetcher that ignores its signal', async () => {
    const never: FetchDeps = { resolve: async () => ['93.184.216.34'], fetcher: () => new Promise(() => {}) };
    expect(await reason(guardedFetch('https://example.com/a', { ...policy, timeoutMs: 20 }, never))).toBe('timeout');
    const controller = new AbortController();
    const cancelled = guardedFetch('https://example.com/a', policy, deps([body('x')]), { signal: controller.signal });
    controller.abort();
    expect(await reason(cancelled)).toBe('timeout');
  });
  it('observes late results when cancellation happens inside the fetcher', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const d: FetchDeps = {
      resolve: async () => ['93.184.216.34'],
      fetcher: () => { controller.abort(); return new Promise(resolve => setTimeout(() => resolve(new Response(stream)), 10)); },
    };
    expect(await reason(guardedFetch('https://example.com/a', policy, d, { signal: controller.signal }))).toBe('timeout');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(cancelled).toBe(true);
  });
  it('handles a late rejected operation when its signal is already aborted', async () => {
    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      const d: FetchDeps = {
        resolve: () => { controller.abort(); return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late')), 10)); },
        fetcher: vi.fn(),
      };
      expect(await reason(guardedFetch('https://example.com/a', policy, d, { signal: controller.signal }))).toBe('timeout');
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally { process.removeListener('unhandledRejection', onUnhandled); }
  });
  it('drops credentials on cross-origin redirects while keeping feed validators', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const d: FetchDeps = {
      resolve: async () => ['93.184.216.34'],
      fetcher: async request => {
        seen.push({ url: request.url, headers: request.headers });
        return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://other.example/file' } }) : body('ok');
      },
    };
    await guardedFetch('https://example.com/a', policy, d, { headers: { accept: 'application/rss+xml', 'user-agent': 'feed-test', 'if-none-match': 'etag-secret', 'if-modified-since': 'date', authorization: 'Bearer secret', cookie: 'session=secret', 'x-api-key': 'secret' } });
    expect(seen[0]!.headers.authorization).toBe('Bearer secret');
    expect(seen[1]!.headers).toMatchObject({ accept: 'application/rss+xml', 'user-agent': 'feed-test', 'if-none-match': 'etag-secret', 'if-modified-since': 'date' });
    expect(Object.keys(seen[1]!.headers).some(name => ['authorization', 'cookie', 'x-api-key'].includes(name.toLowerCase()))).toBe(false);
  });
  it('returns bytes, validators and handles 304', async () => {
    const ok = await guardedFetch('https://example.com/a', policy, deps([body('hi', { headers: { 'content-type': 'Text/XML; charset=utf-8', etag: '"e1"' } })]));
    expect(ok).toMatchObject({ notModified: false, contentType: 'text/xml', etag: '"e1"' });
    const nm = await guardedFetch('https://example.com/a', policy, deps([new Response(null, { status: 304 })]), { acceptNotModified: true });
    expect(nm.notModified).toBe(true);
  });
  it('bounds a body read even when the stream ignores cancellation', async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); } });
    const d: FetchDeps = { resolve: async () => ['93.184.216.34'], fetcher: async () => new Response(stream) };
    expect(await reason(guardedFetch('https://example.com/a', { ...policy, timeoutMs: 20 }, d))).toBe('timeout');
  });
  it('rejects special-purpose IPv6 and accepts normalized public IPv6', () => {
    for (const address of ['2001:2::1', '2001:10::1', '2001:db8::1', '3fff::1', '64:ff9b:1::1']) expect(isNonPublicAddress(address)).toBe(true);
    expect(isNonPublicAddress('2001:4860:4860::8888')).toBe(false);
    expect(isNonPublicAddress('2001:0002:0000:0000:0000:0000:0000:0001')).toBe(true);
  });
});
