import { describe, expect, it } from 'vitest';
import { parseFeedDocument, parseWordPressDocument, renderMessage, stripHtml, wordpressApiUrl, FEED_INPUT_SCHEMA, excerptOf } from '../src/modules/feeds/feeds';

const rss = `<?xml version="1.0"?><rss><channel><title>Blog</title>
<item><title><![CDATA[Hello &amp; welcome]]></title><link>https://example.com/a</link><guid>g-1</guid><pubDate>Wed, 01 Jan 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>First <b>post</b> text</p>]]></description></item>
<item><title>Unsafe</title><link>javascript:alert(1)</link></item>
<item><title>Two</title><link>https://example.com/b</link></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Site</title><entry><title>Atom one</title><id>tag:x,1</id><link rel="alternate" href="https://example.com/atom-1"/><updated>2026-02-01T00:00:00Z</updated><summary>Sum</summary></entry></feed>`;

describe('feed parsing', () => {
  it('reads RSS entries, identity fallbacks and drops non-http links', () => {
    const entries = parseFeedDocument(rss, 10);
    expect(entries.map(e => e.guid)).toEqual(['g-1', 'Unsafe', 'https://example.com/b']);
    expect(entries[0]).toMatchObject({ title: 'Hello & welcome', link: 'https://example.com/a' });
    expect(entries[1]!.link).toBeNull();
    expect(entries[0]!.publishedAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });
  it('reads Atom links from attributes', () => {
    expect(parseFeedDocument(atom, 10)).toMatchObject([{ guid: 'tag:x,1', link: 'https://example.com/atom-1', title: 'Atom one' }]);
  });
  it('bounds the number of entries and tolerates garbage', () => {
    expect(parseFeedDocument(rss, 1)).toHaveLength(1);
    expect(parseFeedDocument('not xml at all <<<', 5)).toEqual([]);
    expect(parseFeedDocument('', 5)).toEqual([]);
  });
  it('reads WordPress posts and ignores malformed bodies', () => {
    const body = JSON.stringify([{ id: 7, link: 'https://example.com/p', date_gmt: '2026-03-01T00:00:00', title: { rendered: 'A &amp; B' }, excerpt: { rendered: '<p>Hi</p>' } }, 'bad', { nothing: true }]);
    expect(parseWordPressDocument(body, 10)).toMatchObject([{ guid: 'https://example.com/p', title: 'A & B' }]);
    expect(parseWordPressDocument('{', 10)).toEqual([]);
    expect(parseWordPressDocument('{"a":1}', 10)).toEqual([]);
    expect(wordpressApiUrl('https://example.com/blog/')).toBe('https://example.com/blog/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc');
  });
});

describe('message rendering', () => {
  const entry = { guid: 'g', title: 'T {link}', link: 'https://example.com/a', description: '<p>One two three four five six</p>', publishedAt: null };
  it('fills placeholders literally without re-expanding substituted text', () => {
    const text = renderMessage('{title}\n\n{{link}} {hashtags} {excerpt}', entry, { hashtags: ' #a ', excerptChars: 280, maxChars: 500 });
    expect(text).toBe('T {link}\n\nhttps://example.com/a #a One two three four five six');
  });
  it('caps the final length and strips markup', () => {
    expect(renderMessage('{description}', { ...entry, description: 'x'.repeat(900) }, { hashtags: '', excerptChars: 50, maxChars: 100 })).toHaveLength(100);
    expect(stripHtml('<script>bad()</script><p>ok</p>')).toBe('ok');
    expect(excerptOf('a '.repeat(200), 40).endsWith('…')).toBe(true);
  });
});

describe('feed input schema', () => {
  it('is strict and applies safe defaults', () => {
    expect(FEED_INPUT_SCHEMA.safeParse({ name: 'x', url: 'https://example.com/feed', extra: 1 }).success).toBe(false);
    expect(FEED_INPUT_SCHEMA.parse({ name: 'x', url: 'https://example.com/feed' })).toMatchObject({ kind: 'rss', enabled: true, targetIds: [] });
    expect(FEED_INPUT_SCHEMA.safeParse({ name: 'x', url: 'https://example.com/feed', targetIds: ['a b'] }).success).toBe(false);
  });
});

describe('feed scheduling helpers', () => {
  const entry = (guid: string, at: string | null) => ({ guid, title: guid, link: null, description: null, publishedAt: at ? new Date(at) : null });
  it('takes unseen, in-subscription entries oldest first and reports a backlog', async () => {
    const { selectNewEntries } = await import('../src/modules/feeds/feeds');
    const result = selectNewEntries({
      entries: [entry('c', '2026-03-03T00:00:00Z'), entry('seen', '2026-03-02T00:00:00Z'), entry('old', '2025-01-01T00:00:00Z'), entry('a', '2026-03-01T00:00:00Z'), entry('undated', null)],
      seen: new Set(['seen']), ingestFrom: new Date('2026-01-01T00:00:00Z'), max: 2,
    });
    expect(result.selected.map(e => e.guid)).toEqual(['undated', 'a']);
    expect(result.backlog).toBe(true);
  });
  it('steps a fallback time past booked posts and spreads channels only when asked', async () => {
    const { fallbackTime, spreadGroups, backoffMultiplier } = await import('../src/modules/feeds/feeds');
    const now = new Date('2026-06-01T12:00:00Z');
    expect(fallbackTime(now, [], 60, 30).toISOString()).toBe('2026-06-01T13:00:00.000Z');
    expect(fallbackTime(now, [new Date('2026-06-01T13:10:00Z')], 60, 30).toISOString()).toBe('2026-06-01T14:00:00.000Z');
    expect(spreadGroups(['a', 'b'], 0)).toEqual([['a', 'b']]);
    expect(spreadGroups(['a', 'b'], 5)).toEqual([['a'], ['b']]);
    expect([0, 1, 2, 3, 9].map(n => backoffMultiplier(n, 8))).toEqual([1, 2, 4, 8, 8]);
  });
  it('defaults new feeds to approval review with no spread', () => {
    expect(FEED_INPUT_SCHEMA.parse({ name: 'Blog', url: 'https://example.com/feed' })).toMatchObject({ handling: 'review', spreadMinutes: 0, enabled: true });
    expect(FEED_INPUT_SCHEMA.safeParse({ name: 'Blog', url: 'https://example.com/feed', handling: 'publish' }).success).toBe(false);
  });
});
