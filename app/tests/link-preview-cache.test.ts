import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ linkUsed: 0, cache: null as null | { preview: unknown }, exec: [] as string[] }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
const mocks = vi.hoisted(() => ({ entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purge }));
vi.mock('@/server/config/store', async () => {
  const { AI_CONFIG } = await import('../src/modules/studio/config');
  const defaults: Record<string, unknown> = Object.fromEntries(AI_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => defaults[key] };
});

import { resolvePermissions } from '../src/server/permissions';
import { linkPreview, linkPreviewCache } from '../src/modules/studio/content-tools/server/checks';

const actor = { userId: 'u1', workspaceId: 'w1' };
const html = '<head><meta property="og:title" content="Hello"><meta property="og:image" content="https://cdn.example.com/a.png"></head>';
const fetcher = vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
const net = () => ({ resolve: async () => ['93.184.216.34'], fetcher });
const now = () => new Date('2026-10-22T10:00:00Z');
const cachedPreview = { url: 'https://example.com/', title: 'Cached', description: null, imageUrl: null, siteName: 'Example', fetchedAt: '2026-10-22T09:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  state.linkUsed = 0; state.cache = null; state.exec = [];
  mocks.entitlements.mockResolvedValue({ workspaceId: 'w1', features: { 'publishing/posts': true } });
  mocks.permissions.mockResolvedValue(resolvePermissions({ role: 'owner', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('memberships m JOIN users')) return [{ role: 'owner', suspendedAt: null }];
    if (sql.includes("action = 'linkPreview.fetched'")) return [{ count: BigInt(state.linkUsed) }];
    if (sql.includes('FROM link_preview_cache')) return state.cache ? [{ preview: state.cache.preview }] : [];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => { state.exec.push(strings.join('?')); return 1; });
});

describe('link preview cache', () => {
  it('serves a fresh cached preview without fetching or spending the hourly budget', async () => {
    state.cache = { preview: cachedPreview };
    const result = await linkPreview(actor, { url: 'https://example.com/' }, { net: net(), now });
    expect(result).toEqual({ preview: cachedPreview, cached: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.exec.some(sql => sql.includes(`action = 'linkPreview.fetched'`))).toBe(false);
    // TTL is enforced at read time: only rows newer than their expiry are served.
    const read = db.$queryRaw.mock.calls.map(call => (call[0] as TemplateStringsArray).join('?')).find(sql => sql.includes('FROM link_preview_cache'))!;
    expect(read).toContain('"expiresAt" >');
  });

  it('fetches on a miss and stores the usable preview for the Root TTL', async () => {
    const result = await linkPreview(actor, { url: 'https://example.com/' }, { net: net(), now });
    expect(result.preview).toMatchObject({ title: 'Hello', imageUrl: 'https://cdn.example.com/a.png' });
    expect(result.cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const upsert = state.exec.find(sql => sql.includes('INSERT INTO link_preview_cache'))!;
    expect(upsert).toContain('ON CONFLICT ("urlHash")');
  });

  it('never caches unusable previews and refetches after expiry', async () => {
    const empty = { resolve: async () => ['93.184.216.34'], fetcher: vi.fn(async () => new Response('<head></head>', { status: 200, headers: { 'content-type': 'text/html' } })) };
    expect((await linkPreview(actor, { url: 'https://example.com/empty' }, { net: empty, now })).preview).toBeNull();
    expect(state.exec.some(sql => sql.includes('INSERT INTO link_preview_cache'))).toBe(false);
    // An expired row is invisible: the mock models expiry by returning no row.
    state.cache = null;
    const refetched = await linkPreview(actor, { url: 'https://example.com/' }, { net: net(), now });
    expect(refetched.cached).toBe(false);
    expect(fetcher).toHaveBeenCalled();
  });

  it('serves cached reads only on GET semantics: never fetches, never claims', async () => {
    state.cache = { preview: cachedPreview };
    expect(await linkPreviewCache(actor, { url: 'https://example.com/' }, { now })).toEqual({ preview: cachedPreview, cached: true });
    state.cache = null;
    expect(await linkPreviewCache(actor, { url: 'https://example.com/missing' }, { now })).toEqual({ preview: null, cached: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.exec).toEqual([]);
  });

  it('treats an unreadable cache row as a miss and a missing table as disabled', async () => {
    state.cache = { preview: { nope: true } };
    const result = await linkPreview(actor, { url: 'https://example.com/' }, { net: net(), now });
    expect(result.cached).toBe(false);
    expect(result.preview).toMatchObject({ title: 'Hello' });
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('memberships m JOIN users')) return [{ role: 'owner', suspendedAt: null }];
      if (sql.includes("action = 'linkPreview.fetched'")) return [{ count: BigInt(0) }];
      if (sql.includes('FROM link_preview_cache')) throw new Error('relation "link_preview_cache" does not exist');
      return [];
    });
    const fallback = await linkPreview(actor, { url: 'https://example.com/' }, { net: net(), now });
    expect(fallback.preview).toMatchObject({ title: 'Hello' });
  });
});
