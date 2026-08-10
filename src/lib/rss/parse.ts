/**
 * A minimal RSS 2.0 and Atom reader.
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
function tagText(xml: string, ...names: string[]): string | null {
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
    });
  }

  // Channel title: the first <title> outside any item.
  const channel = xml.replace(itemPattern, '');

  return { title: tagText(channel, 'title'), entries };
}

/** Fill a post template from a feed entry. */
export function renderTemplate(template: string, entry: FeedEntry): string {
  return template
    .replace(/\{\{\s*title\s*\}\}/gi, entry.title ?? '')
    .replace(/\{\{\s*link\s*\}\}/gi, entry.link ?? '')
    .replace(/\{\{\s*description\s*\}\}/gi, stripHtml(entry.description ?? ''))
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
