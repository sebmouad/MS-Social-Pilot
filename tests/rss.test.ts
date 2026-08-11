import { describe, expect, it } from 'vitest';

import { parseFeed, renderTemplate, stripHtml } from '../src/lib/rss/parse';
import { selectNewEntries } from '../src/lib/rss/poll';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Blog</title>
    <item>
      <guid isPermaLink="false">post-1</guid>
      <title>First post</title>
      <link>https://example.com/1</link>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
      <pubDate>Tue, 01 Sep 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>post-2</guid>
      <title>Second &amp; last</title>
      <link>https://example.com/2</link>
      <pubDate>Wed, 02 Sep 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <entry>
    <id>urn:uuid:1</id>
    <title>Atom entry</title>
    <link rel="alternate" href="https://example.com/atom-1"/>
    <summary>A summary</summary>
    <published>2026-09-01T09:00:00Z</published>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('reads RSS 2.0 items', () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe('Example Blog');
    expect(feed.entries).toHaveLength(2);
    expect(feed.entries[0]).toMatchObject({
      guid: 'post-1',
      title: 'First post',
      link: 'https://example.com/1',
    });
  });

  it('reads Atom entries, taking href from the link attribute', () => {
    const feed = parseFeed(ATOM);
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]).toMatchObject({
      guid: 'urn:uuid:1',
      title: 'Atom entry',
      link: 'https://example.com/atom-1',
    });
  });

  it('unwraps CDATA and decodes entities', () => {
    const feed = parseFeed(RSS);
    expect(feed.entries[0]!.description).toContain('<p>Hello');
    expect(feed.entries[1]!.title).toBe('Second & last');
  });

  it('parses dates', () => {
    const feed = parseFeed(RSS);
    expect(feed.entries[0]!.publishedAt?.toISOString()).toBe('2026-09-01T09:00:00.000Z');
  });

  it('falls back to the link when there is no guid', () => {
    const feed = parseFeed(`<rss><channel><item>
      <title>No guid</title><link>https://example.com/x</link>
    </item></channel></rss>`);
    expect(feed.entries[0]!.guid).toBe('https://example.com/x');
  });

  it('does not throw on malformed XML', () => {
    expect(() => parseFeed('<rss><channel><item><title>Broken')).not.toThrow();
    expect(parseFeed('not xml at all').entries).toEqual([]);
  });

  it('skips an entry with no usable identity', () => {
    const feed = parseFeed('<rss><channel><item><description>orphan</description></item></channel></rss>');
    expect(feed.entries).toEqual([]);
  });

  it('does not mistake the channel title for an entry title', () => {
    expect(parseFeed(RSS).entries[0]!.title).toBe('First post');
  });
});

describe('renderTemplate', () => {
  const entry = {
    guid: 'g',
    title: 'Big news',
    link: 'https://example.com/news',
    description: '<p>Some <b>details</b> here</p>',
    publishedAt: null,
  };

  it('fills the placeholders', () => {
    expect(renderTemplate('{{title}}\n\n{{link}}', entry)).toBe('Big news\n\nhttps://example.com/news');
  });

  it('tolerates spacing inside the braces', () => {
    expect(renderTemplate('{{ title }}', entry)).toBe('Big news');
  });

  it('strips HTML out of the description', () => {
    expect(renderTemplate('{{description}}', entry)).toBe('Some details here');
  });

  it('leaves no gaps when a field is missing', () => {
    const bare = { ...entry, link: null, description: null };
    expect(renderTemplate('{{title}}\n\n{{link}}\n\n{{description}}', bare)).toBe('Big news');
  });
});

describe('stripHtml', () => {
  it('turns block tags into line breaks', () => {
    expect(stripHtml('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    expect(stripHtml('a<br>b')).toBe('a\nb');
  });

  it('decodes entities', () => {
    expect(stripHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
  });
});

describe('selectNewEntries', () => {
  const entry = (guid: string, iso: string | null) => ({
    guid,
    title: guid,
    link: `https://example.com/${guid}`,
    description: null,
    publishedAt: iso ? new Date(iso) : null,
  });

  const ingestFrom = new Date('2026-09-01T00:00:00Z');

  it('skips entries already seen', () => {
    const fresh = selectNewEntries({
      entries: [entry('a', '2026-09-02T00:00:00Z'), entry('b', '2026-09-03T00:00:00Z')],
      seenGuids: new Set(['a']),
      ingestFrom,
    });
    expect(fresh.map((item) => item.guid)).toEqual(['b']);
  });

  it('skips items published before the subscription', () => {
    // Adding a blog must not queue years of archive.
    const fresh = selectNewEntries({
      entries: [entry('old', '2020-01-01T00:00:00Z'), entry('new', '2026-09-05T00:00:00Z')],
      seenGuids: new Set(),
      ingestFrom,
    });
    expect(fresh.map((item) => item.guid)).toEqual(['new']);
  });

  it('keeps an entry with no date rather than dropping it', () => {
    const fresh = selectNewEntries({
      entries: [entry('undated', null)],
      seenGuids: new Set(),
      ingestFrom,
    });
    expect(fresh).toHaveLength(1);
  });

  it('returns oldest first, so a backlog posts in reading order', () => {
    const fresh = selectNewEntries({
      entries: [entry('c', '2026-09-05T00:00:00Z'), entry('a', '2026-09-02T00:00:00Z')],
      seenGuids: new Set(),
      ingestFrom,
    });
    expect(fresh.map((item) => item.guid)).toEqual(['a', 'c']);
  });

  it('caps how many one poll may take', () => {
    const entries = Array.from({ length: 50 }, (_, index) =>
      entry(`item-${index}`, `2026-09-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`),
    );
    expect(selectNewEntries({ entries, seenGuids: new Set(), ingestFrom, max: 10 })).toHaveLength(10);
  });
});

describe('which destinations a feed may have', () => {
  it('takes Facebook Pages and Groups', async () => {
    const { assertFeedDestinations } = await import('../src/lib/feeds');

    expect(() =>
      assertFeedDestinations([
        { name: 'Client Page', type: 'page' },
        { name: 'Client Group', type: 'group' },
      ]),
    ).not.toThrow();
  });

  it('refuses Instagram, naming the accounts', async () => {
    const { assertFeedDestinations } = await import('../src/lib/feeds');

    // Every item would have been created, sat in the calendar looking fine,
    // and failed when it came due: a feed entry is a headline and a link, and
    // Instagram has no post that is only those.
    expect(() =>
      assertFeedDestinations([
        { name: 'Client Page', type: 'page' },
        { name: '@client', type: 'instagram' },
      ]),
    ).toThrow(/@client/);
  });
})
