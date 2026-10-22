export type LinkPreview = { url: string; title: string | null; description: string | null; imageUrl: string | null; siteName: string | null; source: 'html' | 'platform'; fetchedAt: string };

const META_TAG = /<meta\s+([^>]*?)\/?>/gi;
const ATTRIBUTE = /([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (NAMED[key]) return NAMED[key];
    const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : key.startsWith('#') ? Number.parseInt(key.slice(1), 10) : NaN;
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

const absolutize = (candidate: string, base: string) => { try { return new URL(candidate, base).toString(); } catch { return candidate; } };
const clip = (value: string | null, max: number) => value === null ? null : value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * Open Graph metadata from raw HTML: a small regex parser over the page head, so no HTML parser is
 * needed for six well-known tags. The first tag of a kind wins. Text is bounded by the caller's limits.
 */
export function parseOpenGraphHtml(html: string, url: string, limits: { title: number; description: number; headFallbackBytes: number }, now: Date = new Date()): LinkPreview {
  const tags = new Map<string, string>();
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html.slice(0, limits.headFallbackBytes) : html.slice(0, headEnd);
  for (const match of head.matchAll(META_TAG)) {
    const attrs = new Map<string, string>();
    for (const attr of (match[1] ?? '').matchAll(ATTRIBUTE)) attrs.set((attr[1] ?? '').toLowerCase(), attr[3] ?? attr[4] ?? attr[5] ?? '');
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    const content = attrs.get('content');
    if (key && content && !tags.has(key)) tags.set(key, decodeEntities(content));
  }
  const titleMatch = TITLE_TAG.exec(head);
  const documentTitle = titleMatch?.[1] ? decodeEntities(titleMatch[1].trim()) : null;
  const pick = (...keys: string[]) => { for (const key of keys) { const value = tags.get(key); if (value) return value; } return null; };
  const image = pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image');
  return {
    url, title: clip(pick('og:title', 'twitter:title') ?? documentTitle, limits.title), description: clip(pick('og:description', 'twitter:description', 'description'), limits.description),
    imageUrl: image ? absolutize(image, url) : null, siteName: pick('og:site_name'), source: 'html', fetchedAt: now.toISOString(),
  };
}

export const emptyPreview = (url: string, now: Date = new Date()): LinkPreview => ({ url, title: null, description: null, imageUrl: null, siteName: null, source: 'html', fetchedAt: now.toISOString() });
export const isUsablePreview = (preview: LinkPreview) => Boolean(preview.title || preview.description || preview.imageUrl);
