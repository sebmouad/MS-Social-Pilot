/**
 * Typed access to the JSON-in-TEXT columns (see the note at the top of
 * prisma/schema.prisma). Parsing is always tolerant: a row written by an older
 * version of the app must never crash a page render, so bad JSON degrades to a
 * fallback instead of throwing.
 */

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  /** "graph" when Facebook's scraper produced it, "html" for our own parser. */
  source: 'graph' | 'html';
  fetchedAt: string;
}

export interface PostMedia {
  id: string;
  kind: 'image' | 'video';
  url: string;
  /** Present for locally stored uploads; absent for external URLs. */
  storageKey?: string;
  mimeType?: string;
  altText?: string;
}

export interface PostInsights {
  impressions: number | null;
  reach: number | null;
  engagedUsers: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseMedia(raw: string | null | undefined): PostMedia[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is PostMedia =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as PostMedia).url === 'string' &&
      ((item as PostMedia).kind === 'image' || (item as PostMedia).kind === 'video'),
  );
}

export function parseLinkPreview(raw: string | null | undefined): LinkPreview | null {
  const parsed = parseJson<LinkPreview | null>(raw, null);
  if (!parsed || typeof parsed.url !== 'string') return null;
  return parsed;
}

export function parseInsights(raw: string | null | undefined): PostInsights | null {
  return parseJson<PostInsights | null>(raw, null);
}
