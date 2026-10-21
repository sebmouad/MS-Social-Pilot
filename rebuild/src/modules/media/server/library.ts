import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { MediaValidationError } from '@/modules/publishing/server/media/errors';
import { authorizeFeature, type ToolActor, type ToolAuthorization } from './access';
import { fsMediaStore, type MediaStore } from './store';
import { mediaError } from './messages';
import { checkUrlShape, defaultFetchDeps, guardedFetch, NetGuardError, type FetchDeps, type FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';
import {
  assetReferences, COMMITTED_STATUSES, deleteConfirmation, deleteInUseConfirmation, importConfirmation, isImageFileId,
  libraryQuerySchema, importSchema, deleteSchema, likeContains, safeAssetName, sniffMedia, type AssetHolder, type LibraryAsset, type LibraryUsage,
} from '../library';
import { MEDIA_BOUNDS } from '../config';

const FEATURE = 'publishing/media' as const;
type Tx = Prisma.TransactionClient;
export type MediaDeps = { store?: MediaStore; net?: FetchDeps };
type Limits = Awaited<ReturnType<typeof bounds>>;
type Row = { id: string; filename: string; mimeType: string; size: number; kind: string; url: string; storageKey: string | null; width: number | null; height: number | null; createdAt: Date };
type PostRow = { id: string; status: string; scheduledAt: Date | null; excerpt: string; media: string; keys: string[] | null };

const bad = (text = 'Choose valid media details and confirm the exact action.') => mediaError('invalid_request', text);
const unavailable = () => mediaError('unavailable', 'The media library is temporarily unavailable. Refresh and try again.');
const parse = async <S extends import('zod').ZodTypeAny>(schema: S, input: unknown): Promise<import('zod').output<S>> => { const r = schema.safeParse(input); if (!r.success) throw await bad(); return r.data; };
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= r.min && v <= r.max;

async function protect<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; } catch (error) {
    if (error instanceof OperationError) throw error;
    if (error instanceof MediaValidationError) throw await bad('This file is not an accepted image, or it is larger than the allowed size.');
    throw await mediaError('upstream_failure', 'The media operation could not be confirmed. Refresh the library before trying again.');
  }
}

export async function bounds() {
  try {
    const keys = ['media.libraryPageSize', 'media.workspaceQuotaBytes', 'media.videoMaxBytes', 'media.allowedVideoMimeTypes', 'media.importMaxBytes', 'media.importTimeoutMs', 'media.importMaxRedirects', 'media.importAllowHttp', 'media.importHostAllowlist', 'media.holderScanLimit', 'media.holderListLimit', 'media.imageListLimit', 'media.holderExcerptCharacters', 'media.identifierMaxCharacters', 'media.pageNumberMax', 'media.importUrlMaxCharacters', 'media.assetNameMaxCharacters', 'media.searchMaxCharacters', 'media.transactionTimeoutMs', 'media.transactionMaxWaitMs', 'data.workspaceOperationTimeoutMs'] as const;
    const [pageSize, quota, videoMax, videoMimes, importMax, importTimeout, redirects, allowHttp, allowlist, scan, listLimit, imageLimit, holderExcerpt, identifierMax, pageMax, urlMax, nameMax, search, timeout, maxWait, workspaceTimeout] = await Promise.all(keys.map(key => runtimeConfig(key)));
    const B = MEDIA_BOUNDS;
    if (!inRange(pageSize, B.pageSize) || !inRange(quota, B.workspaceQuotaBytes) || !inRange(videoMax, B.videoMaxBytes) || !inRange(importMax, B.importMaxBytes) || !inRange(importTimeout, B.importTimeoutMs) || !inRange(redirects, B.importMaxRedirects)
      || !inRange(scan, B.holderScanLimit) || !inRange(listLimit, B.holderListLimit) || !inRange(imageLimit, B.imageListLimit) || !inRange(holderExcerpt, B.holderExcerptCharacters) || !inRange(identifierMax, B.identifierMaxCharacters) || !inRange(pageMax, B.pageNumberMax) || !inRange(urlMax, B.importUrlMaxCharacters) || !inRange(nameMax, B.assetNameMaxCharacters) || !inRange(search, B.maxSearchCharacters) || !inRange(timeout, B.transactionTimeoutMs) || !inRange(maxWait, B.transactionMaxWaitMs) || !inRange(workspaceTimeout, B.workspaceTimeoutMs)
      || typeof allowHttp !== 'boolean' || !Array.isArray(allowlist) || !Array.isArray(videoMimes) || timeout + maxWait >= workspaceTimeout) throw await unavailable();
    return { pageSize, quota, videoMax, videoMimes: videoMimes as string[], importMax, importTimeout, redirects, allowHttp, allowlist: allowlist as string[], scan, listLimit, imageLimit, holderExcerpt, identifierMax, pageMax, urlMax, nameMax, search, timeout, maxWait };
  } catch (error) { if (error instanceof OperationError) throw error; throw await unavailable(); }
}
const policyOf = (l: Limits): FetchPolicy => ({ timeoutMs: l.importTimeout, maxBytes: l.importMax, maxRedirects: l.redirects, allowHttp: l.allowHttp, hostAllowlist: l.allowlist });

async function transact<T>(workspaceId: string, l: Limits, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: l.timeout, maxWait: l.maxWait }));
}
async function lockActor(tx: Tx, actor: ToolActor, write: boolean): Promise<ToolAuthorization> {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  if (!rows[0] || rows[0].disabledAt) throw await mediaError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  return authorizeFeature(actor, FEATURE, write ? 'write' : 'read');
}
async function audit(tx: Tx, actor: ToolActor, action: string, detail: object) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw await unavailable();
}

type Source = { id: string; source: LibraryAsset['source']; url?: string | null; storageKey?: string | null };
/** Which posts reference each asset. One scan per call, bounded by `scan`; `truncated` means more posts matched than were examined. */
async function attribute(db: Pick<Tx, '$queryRaw'>, workspaceId: string, assets: readonly Source[], scan: number, excerptCharacters: number): Promise<{ byAsset: Map<string, AssetHolder[]>; truncated: boolean }> {
  const byAsset = new Map<string, AssetHolder[]>();
  const refs = new Map(assets.map(a => [a.id, assetReferences(a)]));
  const all = [...new Set([...refs.values()].flat())];
  if (!all.length) return { byAsset, truncated: false };
  const patterns = all.map(likeContains);
  const rows = await db.$queryRaw<PostRow[]>`SELECT p.id, p.status::text AS status, p."scheduledAt", left(p.message, ${excerptCharacters}) AS excerpt, p.media::text AS media, p."mediaKeys" AS keys FROM posts p WHERE p."workspaceId" = ${workspaceId} AND (p."mediaKeys" && ${all}::text[] OR p.media::text LIKE ANY(${patterns}::text[])) ORDER BY p."createdAt" DESC, p.id ASC LIMIT ${scan + 1}`;
  for (const [id, list] of refs) {
    byAsset.set(id, rows.slice(0, scan).filter(r => list.some(ref => (r.keys ?? []).includes(ref) || r.media.includes(ref))).map(r => ({ postId: r.id, status: r.status, scheduledAt: r.scheduledAt, excerpt: r.excerpt })));
  }
  return { byAsset, truncated: rows.length > scan };
}

async function usageOf(db: Pick<Tx, '$queryRaw'>, workspaceId: string, store: MediaStore, quota: number, imageLimit: number): Promise<LibraryUsage> {
  const [totals, images] = await Promise.all([
    db.$queryRaw<Array<{ bytes: bigint | number; count: bigint | number }>>`SELECT COALESCE(SUM(size), 0)::bigint AS bytes, COUNT(*)::bigint AS count FROM media WHERE "workspaceId" = ${workspaceId}`,
    store.listImages(workspaceId, imageLimit),
  ]);
  const exact = images.totalFiles !== undefined && images.totalBytes !== undefined;
  const imageBytes = exact ? images.totalBytes! : images.items.reduce((sum, item) => sum + item.size, 0);
  return { usedBytes: Number(totals[0]?.bytes ?? 0) + imageBytes, quotaBytes: quota, assetCount: Number(totals[0]?.count ?? 0) + (exact ? images.totalFiles! : images.items.length), approximate: !exact && images.truncated };
}

const nameFor = (id: string) => `Uploaded image ${id.slice(0, 8)}`;

/** Videos and images for the workspace, usage/quota, and the posts that hold each asset. */
export async function readLibrary(actor: ToolActor, input: unknown = {}, deps: MediaDeps = {}) {
  const store = deps.store ?? fsMediaStore;
  const l = await bounds();
  const query = await parse(libraryQuerySchema(l.search, l.pageMax), input);
  if ((query.q?.length ?? 0) > l.search) throw await bad('Shorten the search.');
  const auth = await authorizeFeature(actor, FEATURE, 'read');
  const page = query.page ?? 1; const q = query.q ?? ''; const kind = query.kind ?? '';
  const window = page * l.pageSize + 1;
  return protect((async () => {
    const [rows, images, usage] = await Promise.all([
      prisma.$queryRaw<Row[]>`SELECT id, filename, "mimeType", size, kind::text AS kind, url, "storageKey", width, height, "createdAt" FROM media WHERE "workspaceId" = ${actor.workspaceId} AND "derivedFromId" IS NULL AND (${kind} = '' OR kind::text = ${kind}) AND (${q} = '' OR filename ILIKE ${likeContains(q)}) ORDER BY "createdAt" DESC, id ASC LIMIT ${window}`,
      kind === 'video' ? Promise.resolve({ items: [], truncated: false }) : store.listImages(actor.workspaceId, l.imageLimit),
      usageOf(prisma, actor.workspaceId, store, l.quota, l.imageLimit),
    ]);
    const known = new Set(rows.map(r => r.id.toLowerCase()));
    const candidates: Array<Source & { asset: Omit<LibraryAsset, 'inUse' | 'holderCount' | 'holders'> }> = [
      ...rows.map(r => ({ id: r.id, source: 'library' as const, url: r.url, storageKey: r.storageKey, asset: { id: r.id, kind: r.kind === 'video' ? 'video' as const : 'image' as const, mimeType: r.mimeType, name: r.filename, size: r.size, createdAt: r.createdAt, width: r.width, height: r.height, source: 'library' as const } })),
      ...images.items.filter(i => !known.has(i.id.toLowerCase()) && (q === '' || nameFor(i.id).toLowerCase().includes(q.toLowerCase()))).map(i => ({ id: i.id, source: 'stored-image' as const, asset: { id: i.id, kind: 'image' as const, mimeType: i.mimeType, name: nameFor(i.id), size: i.size, createdAt: i.createdAt, width: null, height: null, source: 'stored-image' as const } })),
    ].sort((a, b) => b.asset.createdAt.getTime() - a.asset.createdAt.getTime() || a.id.localeCompare(b.id));
    const scope = query.usage ? candidates : candidates.slice((page - 1) * l.pageSize, page * l.pageSize + 1);
    const { byAsset, truncated } = await attribute(prisma, actor.workspaceId, scope, l.scan, l.holderExcerpt);
    let items = scope.map(c => { const h = byAsset.get(c.id) ?? []; return { ...c.asset, inUse: h.length > 0, holderCount: h.length, holders: auth.workspaceWide ? h.slice(0, l.listLimit) : null } satisfies LibraryAsset; });
    if (query.usage) items = items.filter(i => query.usage === 'used' ? i.inUse : !i.inUse).slice((page - 1) * l.pageSize, page * l.pageSize + 1);
    return { items: items.slice(0, l.pageSize), page, pageSize: l.pageSize, hasMore: items.length > l.pageSize, usage, workspaceWide: auth.workspaceWide, usageMayBeIncomplete: truncated || usage.approximate, limits: { maxSearchCharacters: l.search } };
  })());
}

/** Import an image or video from a public web address. Re-checks quota, type and size under the workspace lock. */
export async function importFromUrl(actor: ToolActor, input: unknown, deps: MediaDeps = {}) {
  const store = deps.store ?? fsMediaStore; const net = deps.net ?? defaultFetchDeps();
  const l = await bounds();
  const data = await parse(importSchema(l.urlMax, l.nameMax), input);
  if (data.confirmation !== importConfirmation(data.url)) throw await bad();
  await authorizeFeature(actor, FEATURE, 'write');
  return protect((async () => {
    const policy = policyOf(l);
    checkUrlShape(data.url, policy);
    const fetched = await guardedFetch(data.url, policy, net);
    if (fetched.notModified) throw await bad('That address did not return a file.');
    const sniffed = sniffMedia(fetched.bytes);
    const declaredOk = fetched.contentType === '' || fetched.contentType === 'application/octet-stream' || fetched.contentType === 'binary/octet-stream' || (sniffed !== null && fetched.contentType.startsWith(`${sniffed.kind}/`));
    if (!sniffed || !declaredOk) throw await bad('That address does not return a supported image or video.');
    if (sniffed.kind === 'video' && (!l.videoMimes.includes(sniffed.mimeType) || fetched.bytes.length > l.videoMax)) throw await bad('That video is not an accepted type or is larger than the allowed size.');
    const name = safeAssetName(data.name, data.url, sniffed.kind === 'video' ? 'video' : 'image', l.nameMax);
    return transact(actor.workspaceId, l, async tx => {
      await lockActor(tx, actor, true);
      const usage = await usageOf(tx, actor.workspaceId, store, l.quota, l.imageLimit);
      if (usage.usedBytes + fetched.bytes.length > l.quota) throw await mediaError('conflict', 'This workspace has reached its media storage limit. Delete unused media and try again.');
      if (sniffed.kind === 'image') {
        const file = new File([new Uint8Array(fetched.bytes)], name, { type: sniffed.mimeType });
        const stored = await store.putImage({ userId: actor.userId, workspaceId: actor.workspaceId }, file);
        try {
          await audit(tx, actor, 'media.imported', { assetId: stored.id, kind: 'image', size: fetched.bytes.length, host: new URL(fetched.finalUrl).hostname });
          await lockActor(tx, actor, true);
        } catch (error) { await store.removeImage(actor.workspaceId, stored.id, true).catch(() => undefined); throw error; }
        return { id: stored.id, kind: 'image' as const, mimeType: stored.mimeType, name, size: fetched.bytes.length, source: 'stored-image' as const };
      }
      const fileId = randomUUID(); const rowId = `med_${fileId}`;
      const { storageKey } = await store.putVideo(actor.workspaceId, fileId, fetched.bytes);
      try {
        const inserted = await tx.$executeRaw`INSERT INTO media (id, "workspaceId", filename, "mimeType", size, kind, "storageProvider", "storageKey", url, "createdAt") VALUES (${rowId}, ${actor.workspaceId}, ${name}, ${sniffed.mimeType}, ${fetched.bytes.length}, 'video'::"MediaKind", 'local'::"StorageProvider", ${storageKey}, ${`media:${rowId}`}, NOW())`;
        if (inserted !== 1) throw await unavailable();
        await audit(tx, actor, 'media.imported', { assetId: rowId, kind: 'video', size: fetched.bytes.length, host: new URL(fetched.finalUrl).hostname });
        await lockActor(tx, actor, true);
      } catch (error) { await store.removeStored(actor.workspaceId, storageKey).catch(() => undefined); throw error; }
      return { id: rowId, kind: 'video' as const, mimeType: sniffed.mimeType, name, size: fetched.bytes.length, source: 'library' as const };
    });
  })());
}

/**
 * Delete an asset. A referenced asset is refused unless the caller passes
 * `allowInUse` with the stronger confirmation, and never while a post that uses
 * it is scheduled, publishing or awaiting approval.
 */
export async function deleteAsset(actor: ToolActor, input: unknown, deps: MediaDeps = {}) {
  const store = deps.store ?? fsMediaStore;
  const l = await bounds();
  const data = await parse(deleteSchema(l.identifierMax), input);
  const force = data.allowInUse === true;
  if (data.confirmation !== (force ? deleteInUseConfirmation(data.id) : deleteConfirmation(data.id))) throw await bad();
  const first = await authorizeFeature(actor, FEATURE, 'write');
  if (!first.workspaceWide) throw await mediaError('forbidden', 'Deleting media can affect posts on every channel. Ask a member with access to all channels.');
  return protect(transact(actor.workspaceId, l, async tx => {
    const auth = await lockActor(tx, actor, true);
    if (!auth.workspaceWide) throw await mediaError('forbidden', 'Deleting media can affect posts on every channel. Ask a member with access to all channels.');
    const isFile = isImageFileId(data.id);
    const rows = isFile ? [] : await tx.$queryRaw<Row[]>`SELECT id, filename, "mimeType", size, kind::text AS kind, url, "storageKey", width, height, "createdAt" FROM media WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = rows[0];
    if (!isFile && !row) throw await mediaError('not_found', 'This media is unavailable in the current workspace.');
    const target: Source = isFile ? { id: data.id, source: 'stored-image' } : { id: row!.id, source: 'library', url: row!.url, storageKey: row!.storageKey };
    const { byAsset, truncated } = await attribute(tx, actor.workspaceId, [target], l.scan, l.holderExcerpt);
    const holders = byAsset.get(target.id) ?? [];
    if (holders.length || truncated) {
      if (!force) throw await (holders.length === 1
        ? mediaError('conflict', 'This media is used by 1 post. Remove it from that post first, or confirm deleting it anyway.')
        : holders.length ? mediaError('conflict', 'This media is used by {0} posts. Remove it from those posts first, or confirm deleting it anyway.', holders.length)
          : mediaError('conflict', 'This media is used by many posts. Remove it from those posts first, or confirm deleting it anyway.'));
      if (truncated || holders.some(h => COMMITTED_STATUSES.has(h.status))) throw await mediaError('conflict', 'This media is used by posts that are scheduled, publishing or awaiting approval. Change those posts first.');
    }
    if (isFile) {
      await audit(tx, actor, 'media.deleted', { assetId: data.id, kind: 'image', affectedPosts: holders.map(h => h.postId), forced: force });
      const removal = await store.removeImage(actor.workspaceId, data.id, force);
      if (removal === 'missing') throw await mediaError('not_found', 'This media is unavailable in the current workspace.');
      if (removal === 'in_use') throw await mediaError('conflict', 'This media is now in use. Refresh and review before deleting.');
      return { id: data.id, deleted: true as const, fileRemoved: 'removed' as const, affectedPosts: holders.length };
    }
    const deleted = await tx.$executeRaw`DELETE FROM media WHERE id = ${row!.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (deleted !== 1) throw await mediaError('not_found', 'This media is unavailable in the current workspace.');
    await audit(tx, actor, 'media.deleted', { assetId: row!.id, kind: row!.kind, affectedPosts: holders.map(h => h.postId), forced: force });
    await lockActor(tx, actor, true);
    let fileRemoved: 'removed' | 'kept' | 'unconfirmed' = 'kept';
    if (row!.storageKey) {
      try { const r = await store.removeStored(actor.workspaceId, row!.storageKey); fileRemoved = r === 'not_managed' ? 'kept' : 'removed'; }
      catch { fileRemoved = 'unconfirmed'; }
    }
    return { id: row!.id, deleted: true as const, fileRemoved, affectedPosts: holders.length };
  }));
}
export { NetGuardError };
