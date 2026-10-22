import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: vi.fn(), workspace: vi.fn(), exec: [] as Array<{ sql: string; values: unknown[] }>, feedRows: [] as unknown[], knownGuids: [] as string[], failAudit: false, insertedItems: 0, overrides: {} as Record<string, unknown>, inserts: [] as string[], count: 0 }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { FEEDS_CONFIG } = await import('../src/modules/feeds/config');
  const defaults = Object.fromEntries(FEEDS_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => state.overrides[key] ?? ({ ...defaults, 'data.workspaceOperationTimeoutMs': 30000 } as Record<string, unknown>)[key] };
});
vi.mock('@/modules/media/server/access', () => ({ authorizeFeature: state.auth }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));

import { checkFeed, createFeed, deleteFeed, readFeeds, updateFeed } from '../src/modules/feeds/server/feeds';

const actor = { userId: 'u1', workspaceId: 'w1' };
const NOW = new Date('2026-06-01T12:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({ id: 'feed_1', name: 'Blog', url: 'https://example.com/feed', kind: 'rss', enabled: true, messageTemplate: '{title}\n{link}', hashtags: '#x', targetIds: ['t1'], lastPolledAt: null, lastError: null, lastEtag: null, lastModified: null, ingestFrom: new Date('2026-01-01T00:00:00Z'), createdAt: NOW, updatedAt: NOW, ...over });
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const xml = (items: string[]) => `<rss><channel>${items.map((t, i) => `<item><title>${t}</title><link>https://example.com/${i}</link><guid>g${i}</guid><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const net = (text: string, status = 200) => ({ resolve: vi.fn(async () => ['93.184.216.34']), fetcher: vi.fn(async (_r: { url: string; headers: Record<string, string> }) => new Response(text, { status, headers: { 'content-type': 'application/xml' } })) });
const targets = vi.fn(async (_a: unknown, ids: string[]) => ids.map(id => ({ id })));

beforeEach(() => {
  vi.clearAllMocks(); state.exec = []; state.feedRows = [row()]; state.knownGuids = []; state.failAudit = false; state.overrides = {}; state.inserts = []; state.count = 0;
  state.auth.mockResolvedValue({ role: 'owner', actor, permissions: {}, entitlements: {}, workspaceWide: true });
  state.workspace.mockImplementation((_id: string, cb: () => Promise<unknown>) => cb());
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRawUnsafe.mockImplementation(async () => state.feedRows);
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(state.count) }];
    if (q.sql.includes('SELECT guid FROM feed_items')) return state.knownGuids.map(guid => ({ guid }));
    if (q.sql.includes('SELECT enabled FROM feed_sources')) return [{ enabled: true }];
    if (q.sql.includes('SELECT id, name, "targetIds" FROM feed_sources')) return state.feedRows.length ? [{ id: 'feed_1', name: 'Blog', targetIds: ['t1'] }] : [];
    if (q.sql.includes('url = ')) return [];
    return [{ ok: true }];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v); state.exec.push(q);
    if (state.failAudit && q.sql.includes('activity_logs')) throw new Error('audit failed');
    if (q.sql.includes('INSERT INTO feed_items')) { state.inserts.push(String(v[2])); return state.knownGuids.includes(String(v[2])) ? 0 : 1; }
    return 1;
  });
});
const executed = (needle: string) => state.exec.filter(e => e.sql.includes(needle));
const draft = { name: 'Blog', url: 'https://example.com/feed', targetIds: ['t1'] };

describe('feed management', () => {
  it('requires exact confirmations and strict input before any database access', async () => {
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED other' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateFeed(actor, { ...draft, id: 'feed_1', extra: 1, confirmation: 'UPDATE FEED feed_1' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED x' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled(); expect(state.auth).not.toHaveBeenCalled();
  });
  it('refuses private, plain-http and credentialed addresses on save', async () => {
    for (const url of ['https://127.0.0.1/feed', 'http://example.com/feed', 'https://u:p@example.com/feed', 'https://169.254.169.254/x']) {
      await expect(createFeed(actor, { ...draft, url, confirmation: 'CREATE FEED Blog' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('creates a feed with channel validation, a count limit and an audit record', async () => {
    const created = await createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, { validateTargets: targets });
    expect(created).toMatchObject({ id: 'feed_1', targetIds: ['t1'] });
    expect(targets).toHaveBeenCalledWith(expect.anything(), ['t1'], 50);
    expect(executed('INSERT INTO feed_sources')[0]!.values).toContain('w1');
    expect(executed('activity_logs')[0]!.values).toContain('feeds.created');
  });
  it('enforces the Root feed limit and rolls back when the audit write fails', async () => {
    state.count = 25;
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'conflict' });
    state.count = 0; state.failAudit = true;
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('denies roles that cannot author and unauthenticated access', async () => {
    state.auth.mockResolvedValue({ role: 'viewer', actor, workspaceWide: true });
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(checkFeed(actor, { id: 'feed_1' }, { net: net(xml(['A'])) })).rejects.toMatchObject({ code: 'forbidden' });
    state.auth.mockRejectedValue(Object.assign(new Error('x'), { code: 'unauthorized' }));
    await expect(readFeeds(actor)).rejects.toBeTruthy();
  });
  it('hides and protects feeds that name channels outside a scoped member grant', async () => {
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['t2'] }, workspaceWide: false });
    expect((await readFeeds(actor)).feeds).toHaveLength(0);
    state.feedRows = [row({ id: 'feed_1', targetIds: ['t1'] })];
    await expect(updateFeed(actor, { ...draft, targetIds: ['t2'], id: 'feed_1', confirmation: 'UPDATE FEED feed_1' }, { validateTargets: targets })).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED feed_1' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(checkFeed(actor, { id: 'feed_1' }, { net: net(xml(['A'])) })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('scopes every statement to the workspace and deletes with an audit trail', async () => {
    expect(await deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED feed_1' })).toEqual({ id: 'feed_1', deleted: true });
    expect(executed('DELETE FROM feed_sources')[0]!.values).toEqual(['feed_1', 'w1']);
    expect(executed('feeds.deleted').length + executed('activity_logs').length).toBeGreaterThan(0);
    state.feedRows = [];
    await expect(deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED feed_1' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('feed checks and draft creation', () => {
  it('previews new items without creating anything', async () => {
    state.knownGuids = ['g1'];
    const n = net(xml(['One', 'Two']));
    const result = await checkFeed(actor, { id: 'feed_1' }, { net: n, now: () => NOW });
    expect(result.entries.map(e => [e.guid, e.isNew, e.eligible])).toEqual([['g0', true, true], ['g1', false, false]]);
    expect(result.entries[0]!.message).toBe('One\nhttps://example.com/0');
    expect(executed('INSERT INTO posts')).toHaveLength(0);
    expect(executed('UPDATE feed_sources')).toHaveLength(1);
    expect(n.fetcher.mock.calls[0]![0].url).toBe('https://example.com/feed');
  });
  it('requires the draft confirmation and creates one draft per new item with destinations', async () => {
    await expect(checkFeed(actor, { id: 'feed_1', createDrafts: true, confirmation: 'nope' }, { net: net(xml(['A'])), validateTargets: targets })).rejects.toMatchObject({ code: 'invalid_request' });
    const result = await checkFeed(actor, { id: 'feed_1', createDrafts: true, confirmation: 'CREATE FEED DRAFTS feed_1' }, { net: net(xml(['A', 'B'])), validateTargets: targets, now: () => NOW });
    expect(result.draftsCreated).toBe(2);
    expect(executed('INSERT INTO posts')).toHaveLength(2);
    expect(executed('INSERT INTO posts')[0]!.sql).toContain("'draft'");
    expect(executed('INSERT INTO post_targets')).toHaveLength(2);
    expect(executed('activity_logs').some(e => e.values.includes('feeds.drafts_created'))).toBe(true);
  });
  it('does not duplicate items the de-duplication guard already holds', async () => {
    state.knownGuids = [];
    db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { const q = sql(s, v); state.exec.push(q); return q.sql.includes('INSERT INTO feed_items') ? 0 : 1; });
    const result = await checkFeed(actor, { id: 'feed_1', createDrafts: true, confirmation: 'CREATE FEED DRAFTS feed_1' }, { net: net(xml(['A'])), validateTargets: targets, now: () => NOW });
    expect(result.draftsCreated).toBe(0); expect(executed('INSERT INTO posts')).toHaveLength(0);
  });
  it('ignores items older than the subscription start', async () => {
    state.feedRows = [row({ ingestFrom: new Date('2026-07-01T00:00:00Z') })];
    const result = await checkFeed(actor, { id: 'feed_1', createDrafts: true, confirmation: 'CREATE FEED DRAFTS feed_1' }, { net: net(xml(['A'])), validateTargets: targets, now: () => NOW });
    expect(result.entries[0]).toMatchObject({ isNew: true, eligible: false }); expect(result.draftsCreated).toBe(0);
  });
  it('rolls drafts back when the audit write fails', async () => {
    state.failAudit = true;
    await expect(checkFeed(actor, { id: 'feed_1', createDrafts: true, confirmation: 'CREATE FEED DRAFTS feed_1' }, { net: net(xml(['A'])), validateTargets: targets, now: () => NOW })).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('blocks an SSRF target saved earlier, with a safe message and a recorded error', async () => {
    state.feedRows = [row({ url: 'https://169.254.169.254/latest' })];
    const n = net('secret');
    const error = await checkFeed(actor, { id: 'feed_1' }, { net: n, now: () => NOW }).catch(e => e);
    expect(error.message).toBe('This feed address cannot be read.');
    expect(n.fetcher).not.toHaveBeenCalled();
    expect(executed('"lastError"')[0]!.values).toContain('This feed address cannot be read.');
  });
  it('maps upstream failures without leaking text and throttles repeat checks', async () => {
    const error = await checkFeed(actor, { id: 'feed_1' }, { net: net('Internal stack trace', 500), now: () => NOW }).catch(e => e);
    expect(error).toMatchObject({ code: 'upstream_failure' }); expect(error.message).not.toMatch(/stack/);
    state.feedRows = [row({ lastPolledAt: new Date(NOW.getTime() - 5000) })];
    await expect(checkFeed(actor, { id: 'feed_1' }, { net: net(xml(['A'])), now: () => NOW })).rejects.toMatchObject({ code: 'conflict' });
    state.feedRows = [row({ enabled: false })];
    await expect(checkFeed(actor, { id: 'feed_1' }, { net: net(xml(['A'])), now: () => NOW })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('uses the WordPress endpoint and conditional headers', async () => {
    state.feedRows = [row({ kind: 'wordpress', url: 'https://example.com/blog', lastEtag: '"abc"' })];
    const n = { resolve: vi.fn(async () => ['93.184.216.34']), fetcher: vi.fn(async (_r: { url: string; headers: Record<string, string> }) => new Response('[]', { status: 200 })) };
    await checkFeed(actor, { id: 'feed_1' }, { net: n, now: () => NOW });
    const call = n.fetcher.mock.calls[0]![0];
    expect(call.url).toContain('/wp-json/wp/v2/posts'); expect(call.headers['if-none-match']).toBe('"abc"');
  });
});
