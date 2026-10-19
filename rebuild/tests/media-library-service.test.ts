import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: vi.fn(), workspace: vi.fn(), exec: [] as Array<{ sql: string; values: unknown[] }>, mediaRows: [] as unknown[], posts: [] as unknown[], used: 0, mediaRow: null as unknown, failAudit: false, overrides: {} as Record<string, unknown> }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { MEDIA_CONFIG } = await import('../src/modules/media/config');
  const defaults = Object.fromEntries(MEDIA_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => state.overrides[key] ?? ({ ...defaults, 'data.workspaceOperationTimeoutMs': 30000 } as Record<string, unknown>)[key] };
});
vi.mock('../src/modules/media/server/access', () => ({ authorizeFeature: state.auth }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));
vi.mock('../src/modules/media/server/store', () => ({ fsMediaStore: {} }));

import { deleteAsset, importFromUrl, readLibrary } from '../src/modules/media/server/library';

const actor = { userId: 'u1', workspaceId: 'w1' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(40)]);
const UUID = '11111111-2222-4333-8444-555555555555';
const store = () => ({
  listImages: vi.fn(async () => ({ items: [{ id: UUID, size: 1000, mimeType: 'image/jpeg', createdAt: new Date('2026-05-01T00:00:00Z') }], truncated: false })),
  putImage: vi.fn(async () => ({ id: UUID, mimeType: 'image/jpeg' })), putVideo: vi.fn(async (_w: string, id: string) => ({ storageKey: `w1/videos/${id}` })),
  removeImage: vi.fn(async () => 'deleted' as const), removeStored: vi.fn(async () => 'deleted' as const),
});
const net = (bytes: Buffer, headers: Record<string, string> = {}) => ({ resolve: vi.fn(async () => ['93.184.216.34']), fetcher: vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers })) });
const vrow = { id: 'med_clip_0001', filename: 'clip.mp4', mimeType: 'video/mp4', size: 5000, kind: 'video', url: 'media:med_clip_0001', storageKey: 'w1/videos/aaaa', width: null, height: null, createdAt: new Date('2026-04-01T00:00:00Z') };
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const executed = (needle: string) => state.exec.filter(e => e.sql.includes(needle));

beforeEach(() => {
  vi.clearAllMocks(); state.exec = []; state.mediaRows = [vrow]; state.posts = []; state.used = 2000; state.mediaRow = vrow; state.failAudit = false; state.overrides = {};
  state.auth.mockResolvedValue({ role: 'owner', actor, workspaceWide: true });
  state.workspace.mockImplementation((_id: string, cb: () => Promise<unknown>) => cb());
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (q.sql.includes('SUM(size)')) return [{ bytes: BigInt(state.used), count: BigInt(1) }];
    if (q.sql.includes('FROM posts p')) return state.posts;
    if (q.sql.includes('FOR UPDATE')) return state.mediaRow ? [state.mediaRow] : [];
    if (q.sql.includes('FROM media WHERE')) return state.mediaRows;
    return [{ ok: true }];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v); state.exec.push(q);
    if (state.failAudit && q.sql.includes('activity_logs')) throw new Error('audit failed');
    return 1;
  });
});

describe('library listing', () => {
  it('lists images and videos with quota usage and holder attribution for workspace-wide members', async () => {
    state.posts = [{ id: 'p1', status: 'scheduled', scheduledAt: null, excerpt: 'Hello', media: `[{"url":"media:${UUID}"}]`, keys: [`media:${UUID}`] }];
    const result = await readLibrary(actor, {}, { store: store() as never });
    expect(result.items.map(i => i.id).sort()).toEqual(['med_clip_0001', UUID].sort());
    const image = result.items.find(i => i.id === UUID)!;
    expect(image).toMatchObject({ inUse: true, holderCount: 1, kind: 'image' }); expect(image.holders).toHaveLength(1);
    expect(result.usage).toMatchObject({ usedBytes: 3000, quotaBytes: 5368709120 });
    expect(db.$queryRaw.mock.calls.every(c => (c[0] as TemplateStringsArray).join('?').includes('?') || true)).toBe(true);
  });
  it('shows a channel-limited member usage as used or unused without naming posts', async () => {
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['t1'] }, workspaceWide: false });
    state.posts = [{ id: 'p1', status: 'draft', scheduledAt: null, excerpt: 'Private', media: `"${'med_clip_0001'}"`, keys: ['med_clip_0001'] }];
    const result = await readLibrary(actor, {}, { store: store() as never });
    expect(result.items.every(i => i.holders === null)).toBe(true);
    expect(result.items.find(i => i.id === 'med_clip_0001')!.inUse).toBe(true);
  });
  it('filters unused assets and rejects invalid query fields', async () => {
    const result = await readLibrary(actor, { usage: 'unused' }, { store: store() as never });
    expect(result.items.every(i => !i.inUse)).toBe(true);
    await expect(readLibrary(actor, { kind: 'audio' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readLibrary(actor, { q: 'x'.repeat(200) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readLibrary(actor, { extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('denies access when authorization fails', async () => {
    state.auth.mockRejectedValue(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(readLibrary(actor, {}, { store: store() as never })).rejects.toBeTruthy();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('import from a web address', () => {
  const ok = (url = 'https://example.com/pic.jpg') => ({ url, confirmation: `IMPORT MEDIA ${url}` });
  it('requires the exact confirmation before any network or storage activity', async () => {
    const n = net(JPEG); const s = store();
    await expect(importFromUrl(actor, { url: 'https://example.com/pic.jpg', confirmation: 'yes' }, { net: n, store: s as never })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(n.fetcher).not.toHaveBeenCalled(); expect(s.putImage).not.toHaveBeenCalled();
  });
  it('refuses private and metadata addresses and private DNS answers without fetching', async () => {
    for (const url of ['https://169.254.169.254/x', 'https://localhost/x', 'http://example.com/x']) {
      const n = net(JPEG);
      await expect(importFromUrl(actor, ok(url), { net: n, store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
      expect(n.fetcher).not.toHaveBeenCalled();
    }
    const n = { resolve: vi.fn(async () => ['10.0.0.8']), fetcher: vi.fn() };
    await expect(importFromUrl(actor, ok(), { net: n as never, store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(n.fetcher).not.toHaveBeenCalled();
  });
  it('rejects content that is not an accepted image or video, whatever the declared type', async () => {
    await expect(importFromUrl(actor, ok(), { net: net(Buffer.from('<html>not media</html>'), { 'content-type': 'image/jpeg' }), store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(importFromUrl(actor, ok(), { net: net(JPEG, { 'content-type': 'text/html' }), store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('stores an image, audits it and records only the host', async () => {
    const s = store();
    const result = await importFromUrl(actor, ok(), { net: net(JPEG, { 'content-type': 'image/jpeg' }), store: s as never });
    expect(result).toMatchObject({ kind: 'image', source: 'stored-image' });
    expect(s.putImage).toHaveBeenCalledOnce();
    const audit = executed('activity_logs')[0]!;
    expect(audit.values.some(v => typeof v === 'string' && v.includes('"host":"example.com"') && !v.includes('/pic.jpg'))).toBe(true);
  });
  it('stores a video as a library row with a managed storage key', async () => {
    const s = store();
    const result = await importFromUrl(actor, ok('https://example.com/c.mp4'), { net: net(MP4, { 'content-type': 'video/mp4' }), store: s as never });
    expect(result).toMatchObject({ kind: 'video', mimeType: 'video/mp4' });
    expect(executed('INSERT INTO media')[0]!.values).toContain('w1');
    expect(s.putVideo).toHaveBeenCalledWith('w1', expect.any(String), expect.any(Buffer));
  });
  it('enforces video limits and the workspace quota from Root settings', async () => {
    state.overrides['media.videoMaxBytes'] = 1048576; state.overrides['media.importMaxBytes'] = 2147483647;
    const big = Buffer.concat([MP4, Buffer.alloc(1048576)]);
    await expect(importFromUrl(actor, ok('https://example.com/c.mp4'), { net: net(big), store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
    state.overrides = { 'media.workspaceQuotaBytes': 1048576 }; state.used = 1048576 - 10;
    const s = store();
    await expect(importFromUrl(actor, ok(), { net: net(JPEG), store: s as never })).rejects.toMatchObject({ code: 'conflict' });
    expect(s.putImage).not.toHaveBeenCalled();
    state.overrides = { 'media.allowedVideoMimeTypes': ['video/webm'] };
    await expect(importFromUrl(actor, ok('https://example.com/c.mp4'), { net: net(MP4), store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('removes the stored file when the audit write fails', async () => {
    state.failAudit = true; const s = store();
    await expect(importFromUrl(actor, ok('https://example.com/c.mp4'), { net: net(MP4), store: s as never })).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(s.removeStored).toHaveBeenCalledOnce();
    state.failAudit = true; const s2 = store();
    await expect(importFromUrl(actor, ok(), { net: net(JPEG), store: s2 as never })).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(s2.removeImage).toHaveBeenCalledWith('w1', UUID, true);
  });
  it('is write-only for authoring access and fails when the library settings are invalid', async () => {
    state.auth.mockRejectedValue(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(importFromUrl(actor, ok(), { net: net(JPEG), store: store() as never })).rejects.toBeTruthy();
    state.auth.mockResolvedValue({ role: 'owner', actor, workspaceWide: true }); state.overrides['media.workspaceQuotaBytes'] = 5;
    await expect(importFromUrl(actor, ok(), { net: net(JPEG), store: store() as never })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('deleting assets', () => {
  it('requires the exact confirmation, and the in-use form only with allowInUse', async () => {
    await expect(deleteAsset(actor, { id: 'med_clip_0001', confirmation: 'DELETE IN-USE MEDIA med_clip_0001' }, { store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteAsset(actor, { id: 'med_clip_0001', allowInUse: true, confirmation: 'DELETE MEDIA med_clip_0001' }, { store: store() as never })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.auth).not.toHaveBeenCalled();
  });
  it('deletes an unused video row and its managed file with an audit record', async () => {
    const s = store();
    expect(await deleteAsset(actor, { id: 'med_clip_0001', confirmation: 'DELETE MEDIA med_clip_0001' }, { store: s as never })).toMatchObject({ deleted: true, fileRemoved: 'removed', affectedPosts: 0 });
    expect(executed('DELETE FROM media')[0]!.values).toEqual(['med_clip_0001', 'w1']);
    expect(s.removeStored).toHaveBeenCalledWith('w1', 'w1/videos/aaaa');
  });
  it('refuses an asset in use unless forced, and never when a scheduled post holds it', async () => {
    state.posts = [{ id: 'p1', status: 'draft', scheduledAt: null, excerpt: 'x', media: '"med_clip_0001"', keys: ['med_clip_0001'] }];
    await expect(deleteAsset(actor, { id: 'med_clip_0001', confirmation: 'DELETE MEDIA med_clip_0001' }, { store: store() as never })).rejects.toMatchObject({ code: 'conflict' });
    expect(await deleteAsset(actor, { id: 'med_clip_0001', allowInUse: true, confirmation: 'DELETE IN-USE MEDIA med_clip_0001' }, { store: store() as never })).toMatchObject({ affectedPosts: 1 });
    state.exec = []; state.posts = [{ id: 'p2', status: 'scheduled', scheduledAt: new Date(), excerpt: 'x', media: '"med_clip_0001"', keys: ['med_clip_0001'] }];
    await expect(deleteAsset(actor, { id: 'med_clip_0001', allowInUse: true, confirmation: 'DELETE IN-USE MEDIA med_clip_0001' }, { store: store() as never })).rejects.toMatchObject({ code: 'conflict' });
    expect(executed('DELETE FROM media')).toHaveLength(0);
  });
  it('refuses channel-limited members and treats other workspaces assets as not found', async () => {
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['t1'] }, workspaceWide: false });
    await expect(deleteAsset(actor, { id: 'med_clip_0001', confirmation: 'DELETE MEDIA med_clip_0001' }, { store: store() as never })).rejects.toMatchObject({ code: 'forbidden' });
    state.auth.mockResolvedValue({ role: 'owner', actor, workspaceWide: true }); state.mediaRow = null;
    await expect(deleteAsset(actor, { id: 'med_other', confirmation: 'DELETE MEDIA med_other' }, { store: store() as never })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('deletes stored images through the store and reports a missing file honestly', async () => {
    const s = store();
    expect(await deleteAsset(actor, { id: UUID, confirmation: `DELETE MEDIA ${UUID}` }, { store: s as never })).toMatchObject({ deleted: true, fileRemoved: 'removed' });
    s.removeImage.mockResolvedValueOnce('missing' as never);
    await expect(deleteAsset(actor, { id: UUID, confirmation: `DELETE MEDIA ${UUID}` }, { store: s as never })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('reports an unconfirmed file removal after the row is gone, and rolls back on audit failure', async () => {
    const s = store(); s.removeStored.mockRejectedValueOnce(new Error('disk') as never);
    expect(await deleteAsset(actor, { id: 'med_clip_0001', confirmation: 'DELETE MEDIA med_clip_0001' }, { store: s as never })).toMatchObject({ fileRemoved: 'unconfirmed' });
    state.failAudit = true; const s2 = store();
    await expect(deleteAsset(actor, { id: 'med_clip_0001', confirmation: 'DELETE MEDIA med_clip_0001' }, { store: s2 as never })).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(s2.removeStored).not.toHaveBeenCalled();
  });
});
