import type { LinkPreview } from '../json';
import { env } from '../env';
import { GraphError, graphRequest } from './graph';

/**
 * Open Graph link previews.
 *
 * Two sources, in order of preference:
 *
 *   1. Facebook's own scraper (`POST /?id=<url>&scrape=true`). This is the
 *      authoritative answer, because it returns exactly the card Facebook will
 *      render — and, as a side effect, refreshes Facebook's cache of the URL.
 *      That side effect is the real value: publishing a link that Facebook
 *      scraped *before* the page's og: tags were finished shows a stale or
 *      empty card, and re-scraping is the documented fix.
 *
 *   2. Fetching the URL ourselves and parsing og:/twitter:/<title> tags, for
 *      when the app has no credentials configured or Facebook cannot reach the
 *      URL (staging hosts, IP allowlists).
 */

export interface ScrapeResult extends LinkPreview {}

interface GraphScrapeResponse {
  id?: string;
  title?: string;
  description?: string;
  site_name?: string;
  image?: Array<{ url?: string; width?: number; height?: number }>;
  og_object?: {
    id?: string;
    title?: string;
    description?: string;
    type?: string;
    image?: string;
  };
}

/**
 * Ask Facebook to (re-)scrape a URL and return what it found.
 * Uses an app access token — no user context is required to scrape.
 */
export async function scrapeWithFacebook(url: string): Promise<ScrapeResult> {
  const appToken = `${env.facebookAppId}|${env.facebookAppSecret}`;

  const { data } = await graphRequest<GraphScrapeResponse>('', {
    method: 'POST',
    accessToken: appToken,
    body: { id: url, scrape: true },
  });

  const image = data.image?.find((entry) => entry.url)?.url ?? data.og_object?.image ?? null;

  return {
    url,
    title: data.title ?? data.og_object?.title ?? null,
    description: data.description ?? data.og_object?.description ?? null,
    imageUrl: image,
    siteName: data.site_name ?? null,
    source: 'graph',
    fetchedAt: new Date().toISOString(),
  };
}

const META_TAG = /<meta\s+([^>]*?)\/?>/gi;
const ATTRIBUTE = /([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
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

/**
 * Extract Open Graph metadata from raw HTML.
 *
 * A regex parser rather than a DOM library: we only need six well-known meta
 * tags from the <head>, and this keeps a heavyweight HTML parser out of the
 * dependency tree. Exported for direct testing.
 */
export function parseOpenGraphHtml(html: string, url: string): LinkPreview {
  const tags = new Map<string, string>();

  // Only the head matters, and stopping there avoids scanning huge documents.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html.slice(0, 100_000) : html.slice(0, headEnd);

  for (const match of head.matchAll(META_TAG)) {
    const attrs = new Map<string, string>();
    for (const attr of (match[1] ?? '').matchAll(ATTRIBUTE)) {
      const name = (attr[1] ?? '').toLowerCase();
      const value = attr[3] ?? attr[4] ?? attr[5] ?? '';
      attrs.set(name, value);
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    // First tag wins: pages that repeat og:image list the primary one first.
    if (key && content && !tags.has(key)) tags.set(key, decodeEntities(content));
  }

  const titleMatch = TITLE_TAG.exec(head);
  const documentTitle = titleMatch?.[1] ? decodeEntities(titleMatch[1].trim()) : null;

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = tags.get(key);
      if (value) return value;
    }
    return null;
  };

  const imageUrl = pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image');

  return {
    url,
    title: pick('og:title', 'twitter:title') ?? documentTitle,
    description: pick('og:description', 'twitter:description', 'description'),
    imageUrl: imageUrl ? absolutize(imageUrl, url) : null,
    siteName: pick('og:site_name'),
    source: 'html',
    fetchedAt: new Date().toISOString(),
  };
}

function absolutize(candidate: string, base: string): string {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return candidate;
  }
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Fetch a URL, checking every hop rather than only the one we were handed.
 *
 * `redirect: 'follow'` would let a perfectly public URL bounce us to
 * 169.254.169.254 — checking the first address and then handing the rest to
 * fetch is a guard that any redirect walks straight past. Following manually
 * costs a loop and closes that.
 */
async function fetchChecked(raw: string, signal: AbortSignal): Promise<Response | null> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = assertSafePreviewUrl(current);
    const response = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        // Sites commonly serve og: tags only to recognised crawlers.
        'user-agent': 'facebookexternalhit/1.1 (+MS-Social-Pilot link preview)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) return null;
    current = new URL(location, url).toString();
  }

  return null;
}

/**
 * Fetch and parse a URL ourselves. Never throws for ordinary HTTP failures.
 *
 * The address check lives here rather than at the callers because this is the
 * only place the server itself fetches a user-supplied URL. It used to sit on
 * the preview endpoint alone, which left the two paths that matter more —
 * creating and editing a post, either of which can arrive a few hundred rows at
 * a time from a CSV — fetching whatever they were given.
 */
export async function scrapeWithFetch(url: string): Promise<LinkPreview> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchChecked(url, controller.signal);

    if (!response || !response.ok || !response.body) return emptyPreview(url);

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return emptyPreview(url);

    // Read at most MAX_HTML_BYTES: the <head> is at the top, and a malicious
    // or misconfigured URL should not be able to stream gigabytes at us.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    await reader.cancel().catch(() => undefined);

    const html = new TextDecoder('utf-8').decode(concat(chunks, total));
    return parseOpenGraphHtml(html, response.url || url);
  } catch {
    return emptyPreview(url);
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function emptyPreview(url: string): LinkPreview {
  return {
    url,
    title: null,
    description: null,
    imageUrl: null,
    siteName: null,
    source: 'html',
    fetchedAt: new Date().toISOString(),
  };
}

function isUsable(preview: LinkPreview): boolean {
  return Boolean(preview.title || preview.description || preview.imageUrl);
}

/**
 * Resolve a link preview, preferring Facebook's scraper and falling back to
 * our own fetch when it is unavailable or returns nothing useful.
 */
export async function resolveLinkPreview(url: string): Promise<LinkPreview> {
  try {
    const graphPreview = await scrapeWithFacebook(url);
    if (isUsable(graphPreview)) return graphPreview;
  } catch (error) {
    // Missing credentials, a private URL, or code 1609005 ("error scraping the
    // shared link") all land here — the local fetch may still succeed.
    if (!(error instanceof GraphError) && !(error instanceof Error)) throw error;
  }
  return scrapeWithFetch(url);
}

/**
 * Reject anything that is not a public http(s) URL.
 *
 * This is an SSRF guard: the preview endpoint fetches a user-supplied URL from
 * our server, so loopback, link-local and private ranges must be refused.
 * Hostname-based checks cannot catch a domain that resolves to a private
 * address, which is why the deployment notes recommend an egress proxy for
 * hostile input.
 */
export function assertSafePreviewUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid URL, including http:// or https://.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be previewed.');
  }

  // `URL` strips the brackets from an IPv6 host, so these compare bare.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // IPv6: unique-local (fc00::/7), link-local (fe80::/10), and the
    // IPv4-mapped form that smuggles 127.0.0.1 past a v4-only check.
    /^f[cd]/.test(host) ||
    /^fe[89ab]/.test(host) ||
    host.startsWith('::ffff:');

  if (blocked) {
    throw new Error('That host is not reachable for link previews.');
  }
  return url;
}
