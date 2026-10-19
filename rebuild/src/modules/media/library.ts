import { z } from 'zod';
import { MEDIA_BOUNDS } from './config';

/** Library asset ids: rebuild image files use UUIDs; migrated/video rows use legacy cuid-style ids. */
export const ASSET_ID_SCHEMA = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const IMAGE_FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isImageFileId = (id: string) => IMAGE_FILE_ID.test(id);

export const LIBRARY_QUERY_SCHEMA = z.object({
  kind: z.enum(['image', 'video']).optional(),
  q: z.string().trim().max(MEDIA_BOUNDS.maxSearchCharacters.max).refine(v => !/[\u0000-\u001f\u007f]/.test(v)).optional(),
  page: z.number().int().safe().min(1).max(1000).optional(),
  usage: z.enum(['used', 'unused']).optional(),
}).strict();
export const IMPORT_SCHEMA = z.object({ url: z.string().trim().min(1).max(2048), name: z.string().trim().max(180).optional(), confirmation: z.string() }).strict();
export const DELETE_SCHEMA = z.object({ id: ASSET_ID_SCHEMA, allowInUse: z.boolean().optional(), confirmation: z.string() }).strict();

export const importConfirmation = (url: string) => `IMPORT MEDIA ${url}`;
export const deleteConfirmation = (id: string) => `DELETE MEDIA ${id}`;
export const deleteInUseConfirmation = (id: string) => `DELETE IN-USE MEDIA ${id}`;

export type AssetKind = 'image' | 'video';
export type AssetHolder = { postId: string; status: string; scheduledAt: Date | null; excerpt: string };
export type LibraryAsset = {
  id: string; kind: AssetKind; mimeType: string; name: string; size: number; createdAt: Date; width: number | null; height: number | null;
  source: 'stored-image' | 'library';
  inUse: boolean; holderCount: number;
  /** null when the member cannot see all channels: usage is shown only as inUse. */
  holders: AssetHolder[] | null;
};
export type LibraryUsage = { usedBytes: number; quotaBytes: number; assetCount: number; approximate: boolean };

/** Statuses where deleting a referenced file would break work already committed to go out. */
export const COMMITTED_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'publishing', 'pending_approval']);

export type Sniffed = { kind: AssetKind; mimeType: string };
/** Content sniffing: the bytes decide, never the declared type or file name. */
export function sniffMedia(bytes: Uint8Array): Sniffed | null {
  const b = Buffer.from(bytes.subarray(0, 16));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mimeType: 'image/jpeg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { kind: 'image', mimeType: 'image/png' };
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) return { kind: 'image', mimeType: 'image/gif' };
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return { kind: 'video', mimeType: b.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mimeType: 'video/webm' };
  return null;
}

/** A readable file name from a URL path or a supplied name; never a path. */
export function safeAssetName(preferred: string | undefined, url: string, fallback: string): string {
  let candidate = preferred ?? '';
  if (!candidate) { try { candidate = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''); } catch { candidate = ''; } }
  const cleaned = candidate.replace(/[\u0000-\u001f\u007f\\/]/g, '').replace(/^\.+/, '').trim().slice(0, 180);
  return cleaned || fallback;
}

/** LIKE pattern for a literal fragment. */
export const likeContains = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** Asset references as they appear in posts.media / posts.mediaKeys. */
export function assetReferences(asset: { id: string; source: 'stored-image' | 'library'; url?: string | null; storageKey?: string | null }): string[] {
  if (asset.source === 'stored-image') return [`media:${asset.id}`];
  return [asset.id, asset.url, asset.storageKey].filter((v): v is string => typeof v === 'string' && v.length >= 8);
}
