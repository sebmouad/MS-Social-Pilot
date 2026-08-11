import { describe, expect, it } from 'vitest';

import { safeHref } from '../src/components/ExternalLink';

/**
 * Every href built from data goes through this. Validation on the way in is
 * the real defence, but it only covers rows written since it was added.
 */
describe('safeHref', () => {
  it('passes ordinary web addresses through untouched', () => {
    for (const url of [
      'https://example.com/article?a=1#top',
      'http://example.com',
      'https://www.facebook.com/123/posts/456',
    ]) {
      expect(safeHref(url)).toBe(url);
    }
  });

  it('refuses schemes that execute or embed rather than navigate', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeHref(url)).toBeUndefined();
    }
  });

  it('refuses anything that is not an absolute URL', () => {
    // Every caller links somewhere external, so a relative path is as wrong
    // here as a bad scheme.
    for (const url of ['/posts', 'example.com', 'not a url', '']) {
      expect(safeHref(url)).toBeUndefined();
    }
  });

  it('handles a missing value', () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it('is not fooled by leading whitespace or control characters', () => {
    expect(safeHref('  javascript:alert(1)')).toBeUndefined();
    expect(safeHref('\njavascript:alert(1)')).toBeUndefined();
  });
});
