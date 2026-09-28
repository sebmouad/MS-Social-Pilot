import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UnsafeUrlError,
  fetchPublic,
  isBlockedHost,
  isPrivateAddress,
  readCapped,
  setResolverForTests,
} from '../src/lib/safe-fetch';

/**
 * The server fetching an address somebody typed.
 *
 * What is being defended is everything the server can reach and the person
 * typing cannot: the cloud metadata endpoint, the database, anything bound to
 * localhost. Link previews had most of this; the RSS poller had none of it.
 */

afterEach(() => {
  vi.restoreAllMocks();
  setResolverForTests(null);
});

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '0.1.2.3',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
  ])('refuses %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '93.184.215.14', '2606:4700::1111'])(
    'allows %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it('does not answer for a name', () => {
    expect(isPrivateAddress('example.com')).toBe(false);
  });
});

describe('isBlockedHost', () => {
  it('refuses internal names as well as addresses', () => {
    for (const host of ['localhost', 'api.localhost', 'printer.local', 'db.internal', 'localhost.', '[::1]']) {
      expect(isBlockedHost(host), host).toBe(true);
    }
    expect(isBlockedHost('example.com')).toBe(false);
  });
});

describe('fetchPublic', () => {
  it('refuses a name that resolves to a private address, without connecting', async () => {
    setResolverForTests(async () => ['169.254.169.254']);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(fetchPublic('https://metadata.example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when any one of several answers is private', async () => {
    setResolverForTests(async () => ['93.184.215.14', '10.0.0.5']);
    vi.spyOn(globalThis, 'fetch');

    await expect(fetchPublic('https://split.example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('lets an unresolvable name through to fail as a network error', async () => {
    setResolverForTests(async () => {
      throw new Error('ENOTFOUND');
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok'));

    await fetchPublic('https://nowhere.example.com/');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('checks the resolved address of every redirect hop', async () => {
    setResolverForTests(async (host) => (host === 'inside.example.com' ? ['127.0.0.1'] : ['93.184.215.14']));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://inside.example.com/admin'));

    await expect(fetchPublic('https://outside.example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect and hands back the destination', async () => {
    setResolverForTests(async () => ['93.184.215.14']);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('/moved', 301))
      .mockResolvedValueOnce(new Response('<rss/>', { status: 200 }));

    const response = await fetchPublic('https://blog.example.com/feed');
    expect(await response.text()).toBe('<rss/>');
  });

  it('returns a 304 as it is rather than treating it as a redirect', async () => {
    setResolverForTests(async () => ['93.184.215.14']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 304 }));

    expect((await fetchPublic('https://blog.example.com/feed')).status).toBe(304);
  });

  it('gives up on a redirect loop', async () => {
    setResolverForTests(async () => ['93.184.215.14']);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => redirectTo('https://loop.example.com/'));

    await expect(fetchPublic('https://loop.example.com/')).rejects.toThrow(/redirects/);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('refuses a non-http scheme', async () => {
    await expect(fetchPublic('file:///etc/passwd')).rejects.toThrow(/http and https/);
  });
});

describe('readCapped', () => {
  it('stops at the limit however much the body offers', async () => {
    const body = 'x'.repeat(10_000);
    expect((await readCapped(new Response(body), 100)).length).toBe(100);
  });

  it('reads a short body whole', async () => {
    expect(await readCapped(new Response('hello'), 100)).toBe('hello');
  });
});
