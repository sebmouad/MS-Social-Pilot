import { describe, expect, it } from 'vitest';

import { assertSafePreviewUrl, parseOpenGraphHtml } from '../src/lib/facebook/opengraph';

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
