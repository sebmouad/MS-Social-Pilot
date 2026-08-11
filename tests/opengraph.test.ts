import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSafePreviewUrl,
  parseOpenGraphHtml,
  scrapeWithFetch,
} from '../src/lib/facebook/opengraph';

describe('parseOpenGraphHtml', () => {
  it('reads the standard og: tags', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="A great article" />
        <meta property="og:description" content="Why it matters." />
        <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
        <meta property="og:site_name" content="Example" />
      </head><body>ignored</body></html>`;

    const preview = parseOpenGraphHtml(html, 'https://example.com/post');
    expect(preview).toMatchObject({
      title: 'A great article',
      description: 'Why it matters.',
      imageUrl: 'https://cdn.example.com/cover.jpg',
      siteName: 'Example',
      source: 'html',
    });
  });

  it('falls back to twitter tags, then to <title>', () => {
    const twitter = parseOpenGraphHtml(
      '<head><meta name="twitter:title" content="From Twitter"><title>Doc title</title></head>',
      'https://example.com',
    );
    expect(twitter.title).toBe('From Twitter');

    const titleOnly = parseOpenGraphHtml('<head><title>Doc title</title></head>', 'https://example.com');
    expect(titleOnly.title).toBe('Doc title');
  });

  it('handles single quotes and reversed attribute order', () => {
    const preview = parseOpenGraphHtml(
      "<head><meta content='Quoted title' property='og:title'></head>",
      'https://example.com',
    );
    expect(preview.title).toBe('Quoted title');
  });

  it('decodes HTML entities', () => {
    const preview = parseOpenGraphHtml(
      '<head><meta property="og:title" content="Tom &amp; Jerry &#8212; best of"></head>',
      'https://example.com',
    );
    expect(preview.title).toBe('Tom & Jerry — best of');
  });

  it('resolves a relative image against the page URL', () => {
    const preview = parseOpenGraphHtml(
      '<head><meta property="og:image" content="/img/cover.png"></head>',
      'https://example.com/blog/post',
    );
    expect(preview.imageUrl).toBe('https://example.com/img/cover.png');
  });

  it('keeps the first og:image when several are declared', () => {
    const preview = parseOpenGraphHtml(
      `<head>
         <meta property="og:image" content="https://cdn.example.com/primary.jpg">
         <meta property="og:image" content="https://cdn.example.com/secondary.jpg">
       </head>`,
      'https://example.com',
    );
    expect(preview.imageUrl).toBe('https://cdn.example.com/primary.jpg');
  });

  it('ignores meta tags that appear after </head>', () => {
    const preview = parseOpenGraphHtml(
      '<head><title>Real</title></head><body><meta property="og:title" content="Injected"></body>',
      'https://example.com',
    );
    expect(preview.title).toBe('Real');
  });

  it('returns empty fields for HTML with no metadata', () => {
    const preview = parseOpenGraphHtml('<html><body>Nothing here</body></html>', 'https://example.com');
    expect(preview.title).toBeNull();
    expect(preview.imageUrl).toBeNull();
  });
});

describe('assertSafePreviewUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(assertSafePreviewUrl('https://example.com/x').hostname).toBe('example.com');
    expect(assertSafePreviewUrl('http://example.com').protocol).toBe('http:');
  });

  it('rejects non-http schemes', () => {
    expect(() => assertSafePreviewUrl('file:///etc/passwd')).toThrow(/http and https/i);
    expect(() => assertSafePreviewUrl('ftp://example.com')).toThrow(/http and https/i);
  });

  it('rejects loopback and private ranges', () => {
    // These are the SSRF cases: the server, not the browser, makes this fetch.
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1/admin',
      'http://10.1.2.3/',
      'http://192.168.0.1/',
      'http://172.16.5.4/',
      'http://169.254.169.254/latest/meta-data/',
      'http://db.internal/',
    ]) {
      expect(() => assertSafePreviewUrl(url), url).toThrow(/not reachable/i);
    }
  });

  it('allows a public address in a range adjacent to a private one', () => {
    expect(() => assertSafePreviewUrl('http://172.32.0.1/')).not.toThrow();
  });

  it('rejects a value that is not a URL at all', () => {
    expect(() => assertSafePreviewUrl('just some text')).toThrow(/valid URL/i);
  });
});

/**
 * The server fetches a link the user typed, so the address check belongs where
 * the fetch happens — not on one of the three routes that reach it.
 */
describe('address ranges that reach inwards', () => {
  const blocked = [
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://0.0.0.0/',
  ];

  for (const url of blocked) {
    it(`refuses ${url}`, () => {
      expect(() => assertSafePreviewUrl(url)).toThrow();
    });
  }

  it('still allows an ordinary public host', () => {
    expect(assertSafePreviewUrl('https://example.com/a').hostname).toBe('example.com');
  });
});

describe('scrapeWithFetch address checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function htmlResponse(body: string) {
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  function redirectTo(location: string) {
    return new Response(null, { status: 302, headers: { location } });
  }

  it('never opens a connection to a private address', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const preview = await scrapeWithFetch('http://169.254.169.254/latest/meta-data/');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(preview.title).toBeNull();
  });

  it('does not follow a public URL that redirects inwards', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data/'));

    // The page's own <title> would otherwise end up stored on the post and
    // rendered back to whoever asked for the preview.
    const preview = await scrapeWithFetch('https://example.com/redirector');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(preview.title).toBeNull();
  });

  it('still follows a redirect that stays public', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://example.com/final'))
      .mockResolvedValueOnce(htmlResponse('<html><head><title>Arrived</title></head></html>'));

    const preview = await scrapeWithFetch('https://example.com/start');
    expect(preview.title).toBe('Arrived');
  });

  it('gives up rather than chasing a redirect loop', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(redirectTo('https://example.com/round-and-round'));

    const preview = await scrapeWithFetch('https://example.com/round-and-round');

    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(4);
    expect(preview.title).toBeNull();
  });

  it('reads an ordinary page as before', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      htmlResponse('<html><head><meta property="og:title" content="Fine" /></head></html>'),
    );

    expect((await scrapeWithFetch('https://example.com/post')).title).toBe('Fine');
  });
});
