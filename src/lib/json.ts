import { Prisma } from '@prisma/client';

/**
 * Shapes stored in the `Json` columns, and narrowing helpers for reading them.
 *
 * Postgres validates that these columns contain JSON, but not *which* JSON, so
 * reads still narrow defensively: a row written by an older version of the app
 * must never crash a page render. Writes go in as plain objects — no manual
 * stringify.
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
  /** Present for stored uploads; absent for external URLs. */
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

/** What Prisma hands back for a Json column. */
type JsonValue = Prisma.JsonValue | null | undefined;

export function parseMedia(value: JsonValue): PostMedia[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is PostMedia & Prisma.JsonObject =>
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).url === 'string' &&
      ((item as Record<string, unknown>).kind === 'image' ||
        (item as Record<string, unknown>).kind === 'video'),
  ) as unknown as PostMedia[];
}

export function parseLinkPreview(value: JsonValue): LinkPreview | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.url === 'string' ? (candidate as unknown as LinkPreview) : null;
}

export function parseInsights(value: JsonValue): PostInsights | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as unknown as PostInsights;
}

/** Evergreen text variants. */
export function parseVariants(value: JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Target ids stored on a feed source. */
export function parseTargetIds(value: JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Cast a plain object for a Json column write. */
export function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

/**
 * Write a value that may be absent to a nullable Json column.
 *
 * Prisma distinguishes SQL NULL (`Prisma.DbNull`) from the JSON value `null`
 * (`Prisma.JsonNull`), and rejects a bare `null`. We always mean "no value",
 * which is SQL NULL.
 */
export function toJsonOrNull<T>(value: T | null | undefined): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value === null || value === undefined
    ? (Prisma.DbNull as unknown as Prisma.NullTypes.DbNull)
    : toJson(value);
}
