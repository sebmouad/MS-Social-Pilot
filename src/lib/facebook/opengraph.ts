import type { LinkPreview } from '../json';
import { env } from '../env';
import { GraphError, graphRequest } from './graph';
import { errors } from '../errors';
import { fetchPublic, isBlockedHost, readCapped } from '../safe-fetch';

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

/**
 * Fetch and parse a URL ourselves. Never throws for ordinary HTTP failures.
 *
 * The address checks live in `fetchPublic` rather than at the callers because
 * this is one of only two places the server itself fetches a user-supplied URL.
 * They used to sit on the preview endpoint alone, which left the two paths that
 * matter more — creating and editing a post, either of which can arrive a few
 * hundred rows at a time from a CSV — fetching whatever they were given.
 */
export async function scrapeWithFetch(url: string): Promise<LinkPreview> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // The translated refusal, for a caller that wants to say why; the fetch
    // below checks again, hop by hop and by resolved address.
    assertSafePreviewUrl(url);

    const response = await fetchPublic(url, {
      signal: controller.signal,
      headers: {
        // Sites commonly serve og: tags only to recognised crawlers.
        'user-agent': 'facebookexternalhit/1.1 (+MS-Social-Pilot link preview)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok || !response.body) return emptyPreview(url);

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return emptyPreview(url);

    // The <head> is at the top, and a malicious or misconfigured URL should
    // not be able to stream gigabytes at us.
    const html = await readCapped(response, MAX_HTML_BYTES);
    return parseOpenGraphHtml(html, response.url || url);
  } catch {
    return emptyPreview(url);
  } finally {
    clearTimeout(timer);
  }
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
 * our server, so loopback, link-local and private ranges must be refused. This
 * is the check on the address as written, with translated errors for the
 * screen; `fetchPublic` repeats it on every hop and on the resolved address.
 */
export function assertSafePreviewUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw errors.previewUrlInvalid();
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw errors.previewSchemeUnsupported();
  }

  const blocked = isBlockedHost(url.hostname);

  if (blocked) {
    throw errors.previewHostBlocked();
  }
  return url;
}
