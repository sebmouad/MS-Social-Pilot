/**
 * A minimal RSS 2.0 and Atom reader, and the same entries read from a
 * WordPress site's REST API.
 *
 * Hand-written rather than a dependency because the requirement is narrow: pull
 * id, title, link and date out of each entry. Feeds in the wild are messy —
 * CDATA, HTML entities, namespaced tags, both formats — so the parsing is
 * tolerant and never throws on a malformed document; it returns whatever it
 * could read.
 */

export interface FeedEntry {
  /** Stable identity: guid/id, falling back to the link, then the title. */
  guid: string;
  title: string | null;
  link: string | null;
  description: string | null;
  publishedAt: Date | null;
  /** The article's featured image, when the feed names one. */
  imageUrl?: string | null;
}

export interface ParsedFeed {
  title: string | null;
  entries: FeedEntry[];
}

function stripCdata(value: string): string {
  return value.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

/** Read the text of the first matching tag, ignoring any namespace prefix. */
export function tagText(xml: string, ...names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i');
    const match = pattern.exec(xml);
    if (match?.[1] !== undefined) {
      const value = decodeEntities(stripCdata(match[1])).trim();
      if (value) return value;
    }
  }
  return null;
}

/**
 * Atom puts the URL in an attribute, not the element body, and lists several
 * links per entry. The alternate/self link is the one a reader should follow.
 */
function atomLink(xml: string): string | null {
  const links = [...xml.matchAll(/<(?:\w+:)?link\b([^>]*)\/?>/gi)];

  const attributesOf = (raw: string) => {
    const attributes = new Map<string, string>();
    for (const match of raw.matchAll(/([a-z:_-]+)\s*=\s*"([^"]*)"/gi)) {
      attributes.set((match[1] ?? '').toLowerCase(), match[2] ?? '');
    }
    return attributes;
  };

  for (const link of links) {
    const attributes = attributesOf(link[1] ?? '');
    const rel = attributes.get('rel');
    if ((!rel || rel === 'alternate') && attributes.get('href')) {
      return attributes.get('href') ?? null;
    }
  }
  return null;
}

/**
 * The featured image: an image enclosure, `media:content` or
 * `media:thumbnail`, the forms RSS and WordPress feeds use.
 */
function imageOf(xml: string): string | null {
  for (const match of xml.matchAll(/<(?:enclosure|media:content|media:thumbnail)\b([^>]*)\/?>/gi)) {
    const raw = match[1] ?? '';
    const url = /\burl\s*=\s*"([^"]+)"/i.exec(raw)?.[1];
    if (!url) continue;
    const type = /\btype\s*=\s*"([^"]+)"/i.exec(raw)?.[1];
    const medium = /\bmedium\s*=\s*"([^"]+)"/i.exec(raw)?.[1];
    if (!type && !medium) return decodeEntities(url);
    if (type?.startsWith('image/') || medium === 'image') return decodeEntities(url);
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseFeed(xml: string): ParsedFeed {
  const itemPattern = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const entries: FeedEntry[] = [];

  for (const match of xml.matchAll(itemPattern)) {
    const block = match[0];

    const link = tagText(block, 'link') ?? atomLink(block);
    const title = tagText(block, 'title');
    // guid/id first, so a publisher that rewrites URLs does not re-post its
    // archive; then link; then title as a last resort.
    const guid = tagText(block, 'guid', 'id') ?? link ?? title;
    if (!guid) continue;

    entries.push({
      guid,
      title,
      link,
      description: tagText(block, 'description', 'summary', 'content'),
      publishedAt: parseDate(tagText(block, 'pubDate', 'published', 'updated', 'date')),
      imageUrl: imageOf(block),
    });
  }

  // Channel title: the first <title> outside any item.
  const channel = xml.replace(itemPattern, '');

  return { title: tagText(channel, 'title'), entries };
}

/** Where a WordPress site lists its latest posts, featured images included. */
export function wordpressApiUrl(site: string): string {
  const url = new URL(site);
  const base = url.pathname.replace(/\/wp-json.*$/, '').replace(/\/+$/, '');
  return `${url.origin}${base}/wp-json/wp/v2/posts?_embed=wp:featuredmedia&per_page=20&orderby=date&order=desc`;
}

interface WordPressPost {
  id?: number;
  link?: string;
  date_gmt?: string;
  guid?: { rendered?: string };
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> };
}

/** Entries from `/wp-json/wp/v2/posts`. Anything unreadable gives no entries, never a throw. */
export function parseWordPressPosts(body: string): ParsedFeed {
  let posts: unknown;
  try {
    posts = JSON.parse(body);
  } catch {
    return { title: null, entries: [] };
  }
  if (!Array.isArray(posts)) return { title: null, entries: [] };

  const entries: FeedEntry[] = [];
  for (const post of posts as WordPressPost[]) {
    const link = post.link ?? null;
    const guid = post.guid?.rendered ?? link ?? (post.id !== undefined ? `wp:${post.id}` : null);
    if (!guid) continue;
    entries.push({
      guid,
      title: post.title?.rendered ? stripHtml(post.title.rendered) || null : null,
      link,
      description: post.excerpt?.rendered ?? null,
      // WordPress gives the GMT time without a zone marker.
      publishedAt: post.date_gmt ? parseDate(`${post.date_gmt}Z`) : null,
      imageUrl: post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null,
    });
  }
  return { title: null, entries };
}

/** Longest excerpt put into a post: a teaser, not the article. */
const EXCERPT_CHARS = 280;

/** The start of the article as plain text, cut at a word. */
export function excerptOf(description: string | null): string {
  const text = stripHtml(description ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

/**
 * Fill a post template from a feed entry. `{title}`, `{excerpt}`, `{link}` and
 * `{hashtags}`; the older double-brace forms, and `{{description}}` for the
 * whole summary, keep working.
 */
export function renderTemplate(template: string, entry: FeedEntry, options: { hashtags?: string } = {}): string {
  return template
    .replace(/\{\{?\s*title\s*\}?\}/gi, entry.title ?? '')
    .replace(/\{\{?\s*link\s*\}?\}/gi, entry.link ?? '')
    .replace(/\{\{?\s*excerpt\s*\}?\}/gi, excerptOf(entry.description))
    .replace(/\{\{?\s*description\s*\}?\}/gi, stripHtml(entry.description ?? ''))
    .replace(/\{\{?\s*hashtags\s*\}?\}/gi, (options.hashtags ?? '').trim())
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Feed descriptions are usually HTML; posts are plain text. */
export function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
