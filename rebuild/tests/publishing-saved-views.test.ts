import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ authorize: vi.fn(), queries: [] as Array<{ sql: string; values: unknown[] }>, count: 0, owned: [] as Array<{ screen: string }>, deleted: 1 }));
const sql = (strings: TemplateStringsArray, values: unknown[]) => ({ sql: strings.join('?'), values });
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(strings, values); h.queries.push(q);
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(h.count) }];
    if (q.sql.startsWith('INSERT')) return [{ id: values[0], name: values[3], screen: values[4], query: values[5], createdAt: new Date('2026-10-19T00:00:00Z') }];
    return [];
  }),
};
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.authorize }));

import { normalizeSavedViewQuery, savedViewCopy, SAVED_VIEW_COPY } from '../src/modules/publishing/saved-views';
import { createSavedView, deleteSavedView, listSavedViews } from '../src/modules/publishing/server/saved-views';
import { executeSavedViewTool, savedViewToolDefinitions, savedViewWriteTools } from '../src/modules/publishing/saved-views-mcp';

const actor = { userId: 'u1', workspaceId: 'w1' };
beforeEach(() => {
  h.queries = []; h.count = 0; h.owned = [{ screen: 'posts' }]; h.deleted = 1;
  h.authorize.mockReset().mockImplementation(async (a: typeof actor) => ({ actor: a, role: 'viewer' }));
  db.$transaction.mockReset().mockImplementation(async (work: (t: typeof tx) => Promise<unknown>) => work(tx));
  db.$queryRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(strings, values); h.queries.push(q);
    if (q.sql.startsWith('SELECT screen')) return h.owned;
    return [{ id: 'v1', name: 'Failed', screen: 'posts', query: 'status=failed&evil=1', createdAt: new Date('2026-10-19T00:00:00Z') }];
  });
  db.$executeRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { h.queries.push(sql(strings, values)); return h.deleted; });
});

describe('saved view query normalization', () => {
  it('keeps only whitelisted, valid filters in stable order', () => {
    expect(normalizeSavedViewQuery('posts', '?status=failed&page=3&view=cards&channel=ch_1&q=promo')).toBe('channel=ch_1&q=promo&status=failed&view=cards');
    expect(normalizeSavedViewQuery('calendar', 'view=week&date=2026-10-01&status=scheduled')).toBe('status=scheduled&view=week');
    expect(normalizeSavedViewQuery('posts', '')).toBe('');
  });
  it('refuses invalid or repeated values', () => {
    expect(normalizeSavedViewQuery('posts', 'status=bogus')).toBeNull();
    expect(normalizeSavedViewQuery('posts', 'status=draft&status=failed')).toBeNull();
    expect(normalizeSavedViewQuery('calendar', 'view=cards')).toBeNull();
    expect(normalizeSavedViewQuery('posts', 'channel=../x')).toBeNull();
  });
  it('provides matching English and French copy', () => {
    expect(Object.keys(SAVED_VIEW_COPY.fr).sort()).toEqual(Object.keys(SAVED_VIEW_COPY.en).sort());
    expect(savedViewCopy('fr-FR').heading).toBe('Vues enregistrées');
    expect(savedViewCopy(undefined).heading).toBe('Saved views');
  });
});

describe('saved view service', () => {
  it('lists only the actor\'s own views and re-normalizes stored queries', async () => {
    const result = await listSavedViews(actor, { screen: 'posts' });
    expect(h.authorize).toHaveBeenCalledWith(actor, 'publishing/posts', 'read');
    expect(h.queries[0].values).toEqual(expect.arrayContaining(['w1', 'u1', 'posts']));
    expect(result.views[0]).toMatchObject({ query: 'status=failed', href: '/publishing/posts?status=failed' });
  });
  it('uses the Calendar feature for calendar views', async () => {
    await listSavedViews(actor, { screen: 'calendar' });
    expect(h.authorize).toHaveBeenCalledWith(actor, 'publishing/calendar', 'read');
  });
  it('creates a normalized view scoped to workspace and user', async () => {
    const { view } = await createSavedView(actor, { screen: 'posts', name: ' Failed ', query: 'status=failed&page=2' });
    expect(view).toMatchObject({ name: 'Failed', query: 'status=failed', href: '/publishing/posts?status=failed' });
    const insert = h.queries.find(q => q.sql.startsWith('INSERT'))!;
    expect(insert.values.slice(1)).toEqual(['w1', 'u1', 'Failed', 'posts', 'status=failed']);
  });
  it('refuses invalid filters before authorization or writes', async () => {
    await expect(createSavedView(actor, { screen: 'posts', name: 'x', query: 'status=nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createSavedView(actor, { screen: 'posts', name: '', query: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(createSavedView(actor, { screen: 'other', name: 'x', query: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.authorize).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('enforces the per-screen limit', async () => {
    h.count = 50;
    await expect(createSavedView(actor, { screen: 'posts', name: 'x', query: '' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.queries.some(q => q.sql.startsWith('INSERT'))).toBe(false);
  });
  it('propagates authorization failure without writing', async () => {
    h.authorize.mockRejectedValue(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(createSavedView(actor, { screen: 'posts', name: 'x', query: '' })).rejects.toBeTruthy();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('deletes only an owned view with the exact confirmation', async () => {
    await expect(deleteSavedView(actor, { id: 'v1', confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    h.owned = [];
    await expect(deleteSavedView(actor, { id: 'v1', confirmation: 'DELETE SAVED VIEW v1' })).rejects.toMatchObject({ code: 'not_found' });
    expect(db.$executeRaw).not.toHaveBeenCalled();
    h.owned = [{ screen: 'calendar' }];
    await expect(deleteSavedView(actor, { id: 'v1', confirmation: 'DELETE SAVED VIEW v1' })).resolves.toEqual({ deleted: true, id: 'v1' });
    expect(h.authorize).toHaveBeenCalledWith(actor, 'publishing/calendar', 'read');
    expect(h.queries.at(-1)!.values).toEqual(['v1', 'w1', 'u1']);
  });
});

describe('saved view MCP tools', () => {
  it('exposes list/create/delete through the same service', async () => {
    expect(savedViewToolDefinitions.map(t => t.name)).toEqual(['list_saved_views', 'create_saved_view', 'delete_saved_view']);
    expect([...savedViewWriteTools]).toEqual(['create_saved_view', 'delete_saved_view']);
    await expect(executeSavedViewTool(actor, 'list_saved_views', { screen: 'posts' })).resolves.toHaveProperty('views');
    await expect(executeSavedViewTool(actor, 'unknown', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
