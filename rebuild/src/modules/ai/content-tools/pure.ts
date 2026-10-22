/**
 * Pure logic of the composer checks: Open Graph parsing, engagement outlook and spam risk.
 * No database, network or configuration reads; every threshold arrives as an argument from Root policy.
 */

// ---------------------------------------------------------------- link preview

export type LinkPreview = { url: string; title: string | null; description: string | null; imageUrl: string | null; siteName: string | null; fetchedAt: string };

const META_TAG = /<meta\s+([^>]*?)\/?>/gi;
const ATTRIBUTE = /([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (NAMED[key]) return NAMED[key];
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : key.startsWith('#') ? Number.parseInt(key.slice(1), 10) : Number.NaN;
    if (!Number.isInteger(code) || code < 0x20 && code !== 0x09 && code !== 0x0a || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) return match;
    return String.fromCodePoint(code);
  });
}
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (value: string | null | undefined, max: number): string | null => {
  const text = (value ?? '').replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || null;
};
function absolutize(candidate: string, base: string): string | null {
  try { const url = new URL(candidate, base); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null; } catch { return null; }
}

/** Title, description, picture and site name from the head of an HTML document; first tag of a kind wins. */
export function parseOpenGraphHtml(html: string, url: string, limits: { headScanBytes: number; fieldMaxCharacters: number }, now: Date = new Date()): LinkPreview {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html.slice(0, limits.headScanBytes) : html.slice(0, Math.min(headEnd, limits.headScanBytes));
  const tags = new Map<string, string>();
  for (const match of head.matchAll(META_TAG)) {
    const attrs = new Map<string, string>();
    for (const attr of (match[1] ?? '').matchAll(ATTRIBUTE)) attrs.set((attr[1] ?? '').toLowerCase(), attr[3] ?? attr[4] ?? attr[5] ?? '');
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key && content && !tags.has(key)) tags.set(key, decodeEntities(content));
  }
  const documentTitle = TITLE_TAG.exec(head)?.[1];
  const pick = (...keys: string[]) => { for (const key of keys) { const value = tags.get(key); if (value) return value; } return null; };
  const image = pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image');
  return {
    url,
    title: clean(pick('og:title', 'twitter:title') ?? (documentTitle ? decodeEntities(documentTitle) : null), limits.fieldMaxCharacters),
    description: clean(pick('og:description', 'twitter:description', 'description'), limits.fieldMaxCharacters),
    imageUrl: image ? absolutize(image, url) : null,
    siteName: clean(pick('og:site_name'), limits.fieldMaxCharacters),
    fetchedAt: now.toISOString(),
  };
}
export const previewIsUsable = (p: LinkPreview) => Boolean(p.title || p.description || p.imageUrl);

// ---------------------------------------------------------------- engagement outlook

export const POST_FORMATS = ['photo', 'video', 'link', 'text', 'other'] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export type LengthBucket = 'short' | 'medium' | 'long';
export type HourBucket = 'night' | 'morning' | 'afternoon' | 'evening';
export type Factor = 'format' | 'length' | 'time' | 'weekday';
export type OutlookVerdict = 'above' | 'around' | 'below' | 'unknown';
export type OutlookRules = { minHistory: number; minShared: number; aboveRatio: number; belowRatio: number; ratioFloor: number; shortMaxLength: number; mediumMaxLength: number; nightEndsHour: number; morningEndsHour: number; afternoonEndsHour: number };
/** `format` is null when the post's kind is not known (a post made outside this application). */
export type PastPost = { format: PostFormat | null; length: number; hour: number; weekday: number; interactions: number };
export type OutlookDraft = { format: PostFormat; length: number; hour: number | null; weekday: number | null };
export type OutlookReason = { factor: Factor; value: string; ratio: number; posts: number };
export type Outlook = { outlook: OutlookVerdict; basis: number; reasons: OutlookReason[] };

export const lengthBucket = (length: number, r: Pick<OutlookRules, 'shortMaxLength' | 'mediumMaxLength'>): LengthBucket => length < r.shortMaxLength ? 'short' : length < r.mediumMaxLength ? 'medium' : 'long';
export const hourBucket = (hour: number, r: Pick<OutlookRules, 'nightEndsHour' | 'morningEndsHour' | 'afternoonEndsHour'>): HourBucket => hour < r.nightEndsHour ? 'night' : hour < r.morningEndsHour ? 'morning' : hour < r.afternoonEndsHour ? 'afternoon' : 'evening';

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * How a draft compares with the channel's own history: above, around or below its usual, with the reasons.
 * Never a number: a channel's history is too small and noisy for one to be honest.
 */
export function predictEngagement(history: PastPost[], draft: OutlookDraft, r: OutlookRules): Outlook {
  if (history.length < r.minHistory) return { outlook: 'unknown', basis: history.length, reasons: [] };
  const base = Math.max(median(history.map(p => p.interactions)) ?? 0, 1);
  const factors: Array<{ factor: Factor; value: string; same: (p: PastPost) => boolean }> = [
    { factor: 'format', value: draft.format, same: p => p.format === draft.format },
    { factor: 'length', value: lengthBucket(draft.length, r), same: p => lengthBucket(p.length, r) === lengthBucket(draft.length, r) },
  ];
  if (draft.hour !== null) { const bucket = hourBucket(draft.hour, r); factors.push({ factor: 'time', value: bucket, same: p => hourBucket(p.hour, r) === bucket }); }
  if (draft.weekday !== null) { const day = draft.weekday; factors.push({ factor: 'weekday', value: String(day), same: p => p.weekday === day }); }
  const reasons: OutlookReason[] = [];
  for (const { factor, value, same } of factors) {
    const shared = history.filter(same);
    if (shared.length < r.minShared) continue;
    reasons.push({ factor, value, ratio: Math.round(((median(shared.map(p => p.interactions)) ?? 0) / base) * 100) / 100, posts: shared.length });
  }
  if (!reasons.length) return { outlook: 'unknown', basis: history.length, reasons };
  const weight = (ratio: number) => Math.log(Math.max(ratio, r.ratioFloor));
  const combined = Math.exp(reasons.reduce((sum, reason) => sum + weight(reason.ratio), 0) / reasons.length);
  const outlook: OutlookVerdict = combined >= r.aboveRatio ? 'above' : combined <= r.belowRatio ? 'below' : 'around';
  reasons.sort((a, b) => Math.abs(weight(b.ratio)) - Math.abs(weight(a.ratio)));
  return { outlook, basis: history.length, reasons };
}

/** A post written here: what it carries decides what it is. */
export function formatOfAppPost(media: ReadonlyArray<{ kind?: unknown }>, link: string | null): PostFormat {
  if (media.some(item => item.kind === 'video')) return 'video';
  if (media.some(item => item.kind === 'image')) return 'photo';
  return link ? 'link' : 'text';
}

// ---------------------------------------------------------------- spam risk

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;
/** A link without query, fragment or trailing slash: tracking tags do not make it different. */
export function linkKey(url: string): string | null {
  try { const u = new URL(url); return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return null; }
}
export function linksOf(message: string, link: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const url of [link ?? '', ...(message.match(URL_PATTERN) ?? [])]) { const key = url ? linkKey(url) : null; if (key) keys.add(key); }
  return keys;
}
export function wordsOf(message: string): Set<string> {
  return new Set(message.replace(URL_PATTERN, ' ').toLowerCase().split(/[^\p{L}\p{N}#]+/u).filter(word => word.length > 1));
}
/** Near-identical text: most words shared (Jaccard), both long enough to judge. */
export function similarText(a: Set<string>, b: Set<string>, minWords: number, similarity: number): boolean {
  if (a.size < minWords || b.size < minWords) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared) >= similarity;
}

export type SpamChannel = { id: string; network: string };
export type NearbyPost = { message: string; link: string | null; channels: SpamChannel[] };
export type SpamRisk = { pages: number; network: string; ownPages: number; otherPosts: number; gapMinutes: number };

/**
 * Whether this post, with what is already planned around it, would send the same content to too many
 * channels of one network. Null when it would not. The caller supplies the neighbouring posts.
 */
export function assessSpamRisk(input: { message: string; link: string | null; own: SpamChannel[]; nearby: NearbyPost[]; gapMinutes: number }, r: { pagesThreshold: number; similarity: number; minWords: number }): SpamRisk | null {
  if (input.gapMinutes <= 0 || !input.own.length) return null;
  const links = linksOf(input.message, input.link); const words = wordsOf(input.message);
  if (!links.size && words.size < r.minWords) return null;
  const matching = input.nearby.filter(post => {
    for (const key of linksOf(post.message, post.link)) if (links.has(key)) return true;
    return similarText(words, wordsOf(post.message), r.minWords, r.similarity);
  });
  const byNetwork = new Map<string, { all: Set<string>; own: Set<string> }>();
  const add = (channel: SpamChannel, mine: boolean) => {
    const entry = byNetwork.get(channel.network) ?? { all: new Set<string>(), own: new Set<string>() };
    entry.all.add(channel.id); if (mine) entry.own.add(channel.id); byNetwork.set(channel.network, entry);
  };
  for (const channel of input.own) add(channel, true);
  for (const post of matching) for (const channel of post.channels) add(channel, false);
  let busiest: [string, { all: Set<string>; own: Set<string> }] | null = null;
  for (const entry of byNetwork) if (!busiest || entry[1].all.size > busiest[1].all.size) busiest = entry;
  if (!busiest || busiest[1].all.size < r.pagesThreshold) return null;
  return { pages: busiest[1].all.size, network: busiest[0], ownPages: busiest[1].own.size, otherPosts: matching.length, gapMinutes: input.gapMinutes };
}
