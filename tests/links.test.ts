import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test';
  process.env.APP_URL = 'https://social.example.com';
});

const { applyUtm, extractUrls, isProbablyBot, shortLinkUrl } = await import('../src/lib/links');

describe('applyUtm', () => {
  const settings = {
    utmSource: 'facebook',
    utmMedium: 'social',
    utmCampaignTemplate: 'always-on',
  };

  it('appends the configured parameters', () => {
    const tagged = new URL(applyUtm('https://example.com/page', settings));
    expect(tagged.searchParams.get('utm_source')).toBe('facebook');
    expect(tagged.searchParams.get('utm_medium')).toBe('social');
    expect(tagged.searchParams.get('utm_campaign')).toBe('always-on');
  });

  it('keeps existing query parameters', () => {
    const tagged = new URL(applyUtm('https://example.com/page?id=42', settings));
    expect(tagged.searchParams.get('id')).toBe('42');
    expect(tagged.searchParams.get('utm_source')).toBe('facebook');
  });

  it('does not overwrite tags the URL already carries', () => {
    // Someone who hand-tagged a link meant it.
    const tagged = new URL(applyUtm('https://example.com?utm_source=newsletter', settings));
    expect(tagged.searchParams.get('utm_source')).toBe('newsletter');
    expect(tagged.searchParams.get('utm_medium')).toBe('social');
  });

  it('preserves the fragment', () => {
    expect(applyUtm('https://example.com/page#section', settings)).toContain('#section');
  });

  it('leaves a URL untouched when nothing is configured', () => {
    const settings = { utmSource: null, utmMedium: null, utmCampaignTemplate: null };
    expect(applyUtm('https://example.com/page', settings)).toBe('https://example.com/page');
  });

  it('returns a malformed URL unchanged rather than throwing', () => {
    expect(applyUtm('not a url', settings)).toBe('not a url');
  });

  it('expands date and target placeholders in the campaign', () => {
    const tagged = new URL(
      applyUtm(
        'https://example.com',
        { ...settings, utmCampaignTemplate: '{month}-{target}' },
        { targetName: 'Acme Store', date: new Date('2026-09-15T00:00:00Z') },
      ),
    );
    expect(tagged.searchParams.get('utm_campaign')).toBe('2026-09-acme-store');
  });
});

describe('extractUrls', () => {
  it('finds a URL in running text', () => {
    expect(extractUrls('Read more at https://example.com/post today')).toEqual([
      'https://example.com/post',
    ]);
  });

  it('finds several', () => {
    expect(extractUrls('http://a.com and https://b.com/x')).toEqual(['http://a.com', 'https://b.com/x']);
  });

  it('strips trailing sentence punctuation', () => {
    // "example.com/post." is a sentence ending, not a path.
    expect(extractUrls('See https://example.com/post.')).toEqual(['https://example.com/post']);
    expect(extractUrls('Try https://example.com/a, then more')).toEqual(['https://example.com/a']);
  });

  it('ignores bare domains without a scheme', () => {
    expect(extractUrls('visit example.com')).toEqual([]);
  });

  it('returns nothing for text with no links', () => {
    expect(extractUrls('Just a normal post')).toEqual([]);
  });
});

describe('shortLinkUrl', () => {
  it('builds a link under APP_URL when no shortener domain is set', () => {
    expect(shortLinkUrl('abc123')).toBe('https://social.example.com/l/abc123');
  });
});

describe('isProbablyBot', () => {
  it("treats Facebook's scraper as a bot", () => {
    // It fetches every shortened link at publish time; counting that would
    // give every post a click it did not earn.
    expect(isProbablyBot('facebookexternalhit/1.1')).toBe(true);
  });

  it('catches other common crawlers and preview fetchers', () => {
    for (const agent of [
      'Twitterbot/1.0',
      'Slackbot-LinkExpanding 1.0',
      'WhatsApp/2.21',
      'LinkedInBot/1.0',
      'curl/8.4.0',
      'Googlebot/2.1',
    ]) {
      expect(isProbablyBot(agent), agent).toBe(true);
    }
  });

  it('treats a real browser as a person', () => {
    expect(
      isProbablyBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
      ),
    ).toBe(false);
  });

  it('treats a missing user agent as a bot', () => {
    // Anything that declines to identify itself is not a click worth counting.
    expect(isProbablyBot(null)).toBe(true);
  });
});
