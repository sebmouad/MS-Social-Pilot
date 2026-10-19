import { z } from 'zod';
import { FEEDS_BOUNDS } from './config';

/** Feed entry parsing and message rendering: pure, bounded, never throws on malformed documents. */
export const FEED_ID_SCHEMA = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const clean = (max: number) => z.string().trim().max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), 'Control characters are not allowed.');
export const FEED_KINDS = ['rss', 'wordpress'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
/** `review`: new items wait in Approvals. `schedule`: new items are queued (still held for review when the workspace requires approval). */
export const FEED_HANDLING = ['review', 'schedule'] as const;
export type FeedHandling = (typeof FEED_HANDLING)[number];
export const DEFAULT_MESSAGE_TEMPLATE = '{title}\n\n{link}';

export const FEED_INPUT_SCHEMA = z.object({
  name: clean(240).refine(v => v.length > 0, 'Enter a name.'),
  url: z.string().trim().min(1).max(2048),
  kind: z.enum(FEED_KINDS).default('rss'),
  enabled: z.boolean().default(true),
  messageTemplate: clean(FEEDS_BOUNDS.messageMaxCharacters.max).refine(v => v.length > 0, 'Enter a message template.').default(DEFAULT_MESSAGE_TEMPLATE),
  hashtags: clean(1000).default(''),
  handling: z.enum(FEED_HANDLING).default('review'),
  spreadMinutes: z.number().int().min(0).max(FEEDS_BOUNDS.maxSpreadMinutes.max).default(0),
  targetIds: z.array(z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)).max(FEEDS_BOUNDS.maxTargets.max).default([]),
}).strict();
export type FeedInput = z.infer<typeof FEED_INPUT_SCHEMA>;
export const FEED_CREATE_SCHEMA = FEED_INPUT_SCHEMA.extend({ confirmation: z.string() }).strict();
export const FEED_UPDATE_SCHEMA = FEED_INPUT_SCHEMA.extend({ id: FEED_ID_SCHEMA, confirmation: z.string() }).strict();
export const FEED_DELETE_SCHEMA = z.object({ id: FEED_ID_SCHEMA, confirmation: z.string() }).strict();
export const FEED_CHECK_MODES = ['preview', 'drafts', 'posts'] as const;
export type FeedCheckMode = (typeof FEED_CHECK_MODES)[number];
/** `createDrafts: true` is the older spelling of `mode: 'drafts'`. */
export const FEED_CHECK_SCHEMA = z.object({ id: FEED_ID_SCHEMA, mode: z.enum(FEED_CHECK_MODES).optional(), createDrafts: z.boolean().optional(), confirmation: z.string().optional() }).strict();
export const FEED_LIST_SCHEMA = z.object({ page: z.number().int().min(1).max(100000).optional() }).strict();

export const createFeedConfirmation = (name: string) => `CREATE FEED ${name}`;
export const updateFeedConfirmation = (id: string) => `UPDATE FEED ${id}`;
export const deleteFeedConfirmation = (id: string) => `DELETE FEED ${id}`;
export const draftFeedConfirmation = (id: string) => `CREATE FEED DRAFTS ${id}`;
export const postFeedConfirmation = (id: string) => `CREATE FEED POSTS ${id}`;

export type FeedEntry = { guid: string; title: string | null; link: string | null; description: string | null; publishedAt: Date | null };

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (NAMED[key]) return NAMED[key]!;
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : key.startsWith('#') ? Number.parseInt(key.slice(1), 10) : NaN;
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  });
}
export function stripHtml(value: string): string {
  return decode(value.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, ''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
const cap = (value: string | null, max: number) => (value === null ? null : value.slice(0, max));
function tagText(xml: string, ...names: string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`, 'i').exec(xml);
    if (match?.[1] !== undefined) {
      const raw = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
      const value = decode(raw).trim();
      if (value) return value;
    }
  }
  return null;
}
function atomLink(xml: string): string | null {
  for (const link of xml.matchAll(/<(?:[A-Za-z0-9]+:)?link\b([^>]*)>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of (link[1] ?? '').matchAll(/([A-Za-z:_-]+)\s*=\s*"([^"]*)"/g)) attrs.set(a[1]!.toLowerCase(), a[2]!);
    const rel = attrs.get('rel');
    if ((!rel || rel === 'alternate') && attrs.get('href')) return decode(attrs.get('href')!);
  }
  return null;
}
const dateOf = (value: string | null) => { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
/** A link is only kept when it is an http(s) address. */
const safeLink = (value: string | null) => { if (!value) return null; try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; } };

/** RSS 2.0 and Atom. Returns at most `maxItems` entries, newest-document-order first. */
export function parseFeedDocument(xml: string, maxItems: number): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const match of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    if (entries.length >= maxItems) break;
    const block = match[0];
    const link = safeLink(tagText(block, 'link') ?? atomLink(block));
    const title = cap(tagText(block, 'title'), 500);
    const guid = cap(tagText(block, 'guid', 'id') ?? link ?? title, 500);
    if (!guid) continue;
    entries.push({ guid, title: title === null ? null : stripHtml(title) || null, link, description: cap(tagText(block, 'description', 'summary', 'content'), 20000), publishedAt: dateOf(tagText(block, 'pubDate', 'published', 'updated', 'date')) });
  }
  return entries;
}

/** The site's WordPress REST posts endpoint. */
export function wordpressApiUrl(site: string): string {
  const url = new URL(site);
  const base = url.pathname.replace(/\/wp-json.*$/, '').replace(/\/+$/, '');
  return `${url.origin}${base}/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc`;
}
export function parseWordPressDocument(body: string, maxItems: number): FeedEntry[] {
  let posts: unknown;
  try { posts = JSON.parse(body); } catch { return []; }
  if (!Array.isArray(posts)) return [];
  const entries: FeedEntry[] = [];
  for (const raw of posts) {
    if (entries.length >= maxItems) break;
    if (!raw || typeof raw !== 'object') continue;
    const post = raw as { id?: unknown; link?: unknown; date_gmt?: unknown; guid?: { rendered?: unknown }; title?: { rendered?: unknown }; excerpt?: { rendered?: unknown } };
    const link = safeLink(typeof post.link === 'string' ? post.link : null);
    const guid = cap(typeof post.guid?.rendered === 'string' ? post.guid.rendered : link ?? (typeof post.id === 'number' ? `wp:${post.id}` : null), 500);
    if (!guid) continue;
    const title = typeof post.title?.rendered === 'string' ? cap(stripHtml(post.title.rendered), 500) || null : null;
    entries.push({ guid, title, link, description: typeof post.excerpt?.rendered === 'string' ? post.excerpt.rendered.slice(0, 20000) : null, publishedAt: typeof post.date_gmt === 'string' ? dateOf(`${post.date_gmt}Z`) : null });
  }
  return entries;
}

export function excerptOf(description: string | null, chars: number): string {
  const text = stripHtml(description ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars); const space = cut.lastIndexOf(' ');
  return `${(space > chars / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}
/** Fills {title}, {link}, {excerpt}, {hashtags} and the older {{...}} forms. Values are inserted literally, never re-expanded. */
export function renderMessage(template: string, entry: FeedEntry, options: { hashtags: string; excerptChars: number; maxChars: number }): string {
  const values: Record<string, string> = { title: entry.title ?? '', link: entry.link ?? '', excerpt: excerptOf(entry.description, options.excerptChars), description: stripHtml(entry.description ?? ''), hashtags: options.hashtags.trim() };
  return template.replace(/\{\{?\s*(title|link|excerpt|description|hashtags)\s*\}?\}/gi, (_m, key: string) => values[key.toLowerCase()] ?? '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, options.maxChars);
}

export type FeedRecord = {
  id: string; name: string; url: string; kind: FeedKind; enabled: boolean; messageTemplate: string; hashtags: string; targetIds: string[]; handling: FeedHandling; spreadMinutes: number; failureCount: number;
  lastPolledAt: Date | null; lastError: string | null; createdAt: Date; updatedAt: Date;
};
export type CheckedEntry = { guid: string; title: string | null; link: string | null; publishedAt: Date | null; message: string; isNew: boolean; eligible: boolean };

/**
 * Entries worth turning into posts: unseen, not older than the subscription, oldest first, bounded.
 * Items without a date count as current (better posted once than never). `backlog` reports entries left
 * over so the caller does not store conditional-request validators and hide them on the next read.
 */
export function selectNewEntries(options: { entries: readonly FeedEntry[]; seen: ReadonlySet<string>; ingestFrom: Date; max: number }): { selected: FeedEntry[]; backlog: boolean } {
  const fresh = options.entries
    .filter(entry => !options.seen.has(entry.guid) && (entry.publishedAt === null || entry.publishedAt.getTime() >= options.ingestFrom.getTime()))
    .sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0));
  return { selected: fresh.slice(0, options.max), backlog: fresh.length > options.max };
}

/**
 * When a post goes out if the workspace queue has no free time: a fixed delay (a person can still step in)
 * stepped past anything already booked nearby, so a poll of several items does not land them in one minute.
 */
export function fallbackTime(now: Date, booked: readonly Date[], delayMinutes: number, spacingMinutes: number): Date {
  const times = booked.map(date => date.getTime());
  const spacing = spacingMinutes * 60_000;
  let candidate = now.getTime() + delayMinutes * 60_000;
  // Terminates: each step passes at least one booked time, and there are finitely many.
  while (times.some(time => Math.abs(time - candidate) < spacing)) candidate += spacing;
  return new Date(candidate);
}

/** One post to every channel, or (with a spread) one post per channel `spreadMinutes` apart. */
export function spreadGroups(targetIds: readonly string[], spreadMinutes: number): string[][] {
  return spreadMinutes > 0 ? targetIds.map(id => [id]) : [[...targetIds]];
}

/** Backoff multiplier after consecutive failures: 1, 2, 4 ... capped. */
export const backoffMultiplier = (failures: number, ceiling: number) => Math.min(2 ** Math.min(Math.max(failures, 0), 30), ceiling);
