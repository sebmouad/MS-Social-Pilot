import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: vi.fn(), workspace: vi.fn(), alloc: vi.fn(), exec: [] as Array<{ sql: string; values: unknown[] }>, feedRows: [] as unknown[], knownGuids: [] as string[], failAudit: false,
  overrides: {} as Record<string, unknown>, inserts: [] as string[], count: 0, requiresApproval: false, autoApprove: false, spread: 0, lockedTargets: ['t1'] as string[], bookedTimes: [] as Date[],
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { FEEDS_CONFIG } = await import('../src/modules/feeds/config');
  const defaults = Object.fromEntries(FEEDS_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => state.overrides[key] ?? ({ ...defaults, 'data.workspaceOperationTimeoutMs': 30000 } as Record<string, unknown>)[key] };
});
vi.mock('../src/modules/feeds/server/access', async () => {
  const AUTHOR_ROLES = new Set(['owner', 'admin', 'editor', 'contributor']);
  const { OperationError } = await import('../src/lib/operation-error');
  return {
    AUTHOR_ROLES, authorizeFeeds: state.auth,
    authorizeFeedWrite: async (actor: unknown) => { const r = await state.auth(actor, 'write'); if (!AUTHOR_ROLES.has(r.role)) throw new OperationError('forbidden', 'You do not have permission to manage feeds.'); return r; },
  };
});
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));
vi.mock('@/modules/publishing/collaboration/server/executors', () => ({ allocateQueueTime: state.alloc }));
vi.mock('@/modules/publishing/collaboration/server/versions', () => ({ loadVersionRetention: async () => 10, recordPostVersion: async () => true }));

import { checkFeed, createFeed, deleteFeed, readFeeds, updateFeed } from '../src/modules/feeds/server/feeds';

const actor = { userId: 'u1', workspaceId: 'w1' };
const NOW = new Date('2026-06-01T12:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({ id: 'feed_1', name: 'Blog', url: 'https://example.com/feed', kind: 'rss', enabled: true, messageTemplate: '{title}\n{link}', hashtags: '#x', targetIds: ['t1'], autoApprove: false, spreadMinutes: 0, pollErrorCount: 0, lastPolledAt: null, lastError: null, lastEtag: null, lastModified: null, ingestFrom: new Date('2026-01-01T00:00:00Z'), createdAt: NOW, updatedAt: NOW, ...over });
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const xml = (items: string[]) => `<rss><channel>${items.map((t, i) => `<item><title>${t}</title><link>https://example.com/${i}</link><guid>g${i}</guid><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const net = (text: string, status = 200, extra: Record<string, string> = {}) => ({ resolve: vi.fn(async () => ['93.184.216.34']), fetcher: vi.fn(async (_r: { url: string; headers: Record<string, string> }) => new Response(text, { status, headers: { 'content-type': 'application/xml', ...extra } })) });
const targets = vi.fn(async (_a: unknown, ids: string[], _max: number, _link: string | null, _scheduled: boolean) => ids.map(id => ({ id, socialAccount: { provider: 'p' } })));
const formats = vi.fn(async (list: Array<{ id: string }>) => Object.fromEntries(list.map(t => [t.id, 'post'])));
const deps = { validateTargets: targets, resolveFormats: formats };

beforeEach(() => {
  vi.clearAllMocks(); state.exec = []; state.feedRows = [row()]; state.knownGuids = []; state.failAudit = false; state.overrides = {}; state.inserts = []; state.count = 0;
  state.requiresApproval = false; state.autoApprove = false; state.spread = 0; state.lockedTargets = ['t1']; state.bookedTimes = [];
  state.auth.mockResolvedValue({ role: 'owner', actor, permissions: {}, entitlements: {}, workspaceWide: true });
  state.workspace.mockImplementation((_id: string, cb: () => Promise<unknown>) => cb());
  state.alloc.mockResolvedValue(new Date('2026-06-02T09:00:00Z'));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRawUnsafe.mockImplementation(async () => state.feedRows);
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (q.sql.includes('COUNT(*)')) return [{ count: BigInt(state.count) }];
    if (q.sql.includes('SELECT guid FROM feed_items')) return state.knownGuids.map(guid => ({ guid }));
    if (q.sql.includes('SELECT enabled, "targetIds", "autoApprove"')) return [{ enabled: true, targetIds: state.lockedTargets, autoApprove: state.autoApprove, spreadMinutes: state.spread }];
    if (q.sql.includes('FROM workspaces')) return [{ timezone: 'UTC', requiresApproval: state.requiresApproval }];
    if (q.sql.includes('SELECT DISTINCT p."scheduledAt"')) return state.bookedTimes.map(scheduledAt => ({ scheduledAt }));
    if (q.sql.includes('SELECT id, name, "targetIds" FROM feed_sources')) return state.feedRows.length ? [{ id: 'feed_1', name: 'Blog', targetIds: ['t1'] }] : [];
    if (q.sql.includes('RETURNING enabled')) { state.exec.push(q); return [{ enabled: true }]; }
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
const DRAFTS = { mode: 'drafts', confirmation: 'CREATE FEED DRAFTS feed_1' };
const POSTS = { mode: 'posts', confirmation: 'CREATE FEED POSTS feed_1' };

describe('feed management', () => {
  it('uses configured list scan margin when reading feed rows', async () => {
    state.overrides = { 'feeds.listScanMargin': 17 };
    await readFeeds(actor);
    expect(db.$queryRawUnsafe.mock.calls[0]?.[2]).toBe(42);
  });
  it('accepts configured feed page, URL, name and hashtag ceilings', async () => {
    state.overrides = { 'feeds.pageNumberMax': 200000, 'feeds.nameMaxCharacters': 200, 'feeds.urlMaxCharacters': 4096, 'feeds.hashtagsMaxCharacters': 2000 };
    await expect(readFeeds(actor, { page: 100001 })).resolves.toMatchObject({ page: 100001 });
    const name = 'n'.repeat(150), url = `https://example.com/${'x'.repeat(2100)}`;
    await createFeed(actor, { ...draft, name, url, hashtags: 'h'.repeat(1200), confirmation: `CREATE FEED ${name}` }, deps);
    expect(executed('INSERT INTO feed_sources')[0]!.values).toContain(name);
    expect(executed('INSERT INTO feed_sources')[0]!.values).toContain(url);
    expect(executed('INSERT INTO feed_sources')[0]!.values).toContain('h'.repeat(1200));
  });
  it('requires exact confirmations and strict input before any database access', async () => {
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED other' }, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateFeed(actor, { ...draft, id: 'feed_1', extra: 1, confirmation: 'UPDATE FEED feed_1' }, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED x' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.$queryRaw).not.toHaveBeenCalled(); expect(state.auth).not.toHaveBeenCalled();
  });
  it('refuses private, plain-http and credentialed addresses on save', async () => {
    for (const url of ['https://127.0.0.1/feed', 'http://example.com/feed', 'https://u:p@example.com/feed', 'https://169.254.169.254/x']) {
      await expect(createFeed(actor, { ...draft, url, confirmation: 'CREATE FEED Blog' }, deps)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('creates a feed with channel validation, handling, a count limit and an audit record', async () => {
    const created = await createFeed(actor, { ...draft, handling: 'schedule', spreadMinutes: 15, confirmation: 'CREATE FEED Blog' }, deps);
    expect(created).toMatchObject({ id: 'feed_1', targetIds: ['t1'] });
    expect(targets).toHaveBeenCalledWith(expect.anything(), ['t1'], 50, null, false);
    const insert = executed('INSERT INTO feed_sources')[0]!;
    expect(insert.values).toContain('w1'); expect(insert.values).toContain(true); expect(insert.values).toContain(15);
    expect(executed('activity_logs')[0]!.values).toContain('feeds.created');
  });
  it('defaults new feeds to approval review and bounds the spread by the Root setting', async () => {
    await createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, deps);
    expect(executed('INSERT INTO feed_sources')[0]!.values).toContain(false);
    state.overrides['feeds.maxSpreadMinutes'] = 30;
    await expect(createFeed(actor, { ...draft, spreadMinutes: 31, confirmation: 'CREATE FEED Blog' }, deps)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('enforces the Root feed limit and rolls back when the audit write fails', async () => {
    state.count = 25;
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, deps)).rejects.toMatchObject({ code: 'conflict' });
    state.count = 0; state.failAudit = true;
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, deps)).rejects.toMatchObject({ code: 'upstream_failure' });
  });
  it('denies roles that cannot author and unauthenticated access', async () => {
    state.auth.mockResolvedValue({ role: 'viewer', actor, workspaceWide: true });
    await expect(createFeed(actor, { ...draft, confirmation: 'CREATE FEED Blog' }, deps)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(checkFeed(actor, { id: 'feed_1' }, { net: net(xml(['A'])) })).rejects.toMatchObject({ code: 'forbidden' });
    state.auth.mockRejectedValue(Object.assign(new Error('x'), { code: 'unauthorized' }));
    await expect(readFeeds(actor)).rejects.toBeTruthy();
  });
  it('hides and protects feeds that name channels outside a scoped member grant, including feeds naming none', async () => {
    state.auth.mockResolvedValue({ role: 'editor', actor: { ...actor, allowedTargetIds: ['t2'] }, workspaceWide: false });
    expect((await readFeeds(actor)).feeds).toHaveLength(0);
    state.feedRows = [row({ id: 'feed_1', targetIds: ['t1'] })];
    await expect(updateFeed(actor, { ...draft, targetIds: ['t2'], id: 'feed_1', confirmation: 'UPDATE FEED feed_1' }, deps)).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED feed_1' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(checkFeed(actor, { id: 'feed_1' }, { net: net(xml(['A'])) })).rejects.toMatchObject({ code: 'not_found' });
    state.feedRows = [row({ targetIds: [] })];
    expect((await readFeeds(actor)).feeds).toHaveLength(0);
    await expect(createFeed(actor, { ...draft, targetIds: [], confirmation: 'CREATE FEED Blog' }, deps)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('scopes every statement to the workspace and deletes with an audit trail', async () => {
    expect(await deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED feed_1' })).toEqual({ id: 'feed_1', deleted: true });
    expect(executed('DELETE FROM feed_sources')[0]!.values).toEqual(['feed_1', 'w1']);
    expect(executed('activity_logs').length).toBeGreaterThan(0);
    state.feedRows = [];
    await expect(deleteFeed(actor, { id: 'feed_1', confirmation: 'DELETE FEED feed_1' })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('resets failure history when a feed turns back on or its address changes', async () => {
    state.feedRows = [row({ enabled: false, pollErrorCount: 10, lastError: 'x' })];
    await updateFeed(actor, { ...draft, id: 'feed_1', enabled: true, confirmation: 'UPDATE FEED feed_1' }, deps);
    const update = executed('UPDATE feed_sources SET name')[0]!;
    expect(update.values).toContain(0); expect(update.values).not.toContain(10);
  });
});

describe('feed checks and draft creation', () => {
  it('previews new items without creating anything, sending validators or keeping them', async () => {
    state.knownGuids = ['g1']; state.feedRows = [row({ lastEtag: '"old"' })];
    const n = net(xml(['One', 'Two']), 200, { etag: '"new"' });
    const result = await checkFeed(actor, { id: 'feed_1' }, { net: n, now: () => NOW });
    expect(result.entries.map(e => [e.guid, e.isNew, e.eligible])).toEqual([['g0', true, true], ['g1', false, false]]);
    expect(result.entries[0]!.message).toBe('One\nhttps://example.com/0');
    expect(executed('INSERT INTO posts')).toHaveLength(0);
    expect(n.fetcher.mock.calls[0]![0].url).toBe('https://example.com/feed');
    expect(n.fetcher.mock.calls[0]![0].headers['if-none-match']).toBeUndefined();
    expect(executed('"lastEtag"')).toHaveLength(0);
  });
  it('requires the draft confirmation and creates one draft per new item with destinations and formats', async () => {
    await expect(checkFeed(actor, { id: 'feed_1', mode: 'drafts', confirmation: 'nope' }, { net: net(xml(['A'])), ...deps })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(checkFeed(actor, { id: 'feed_1', mode: 'drafts', createDrafts: false, confirmation: 'CREATE FEED DRAFTS feed_1' }, { net: net(xml(['A'])), ...deps })).rejects.toMatchObject({ code: 'invalid_request' });
    const result = await checkFeed(actor, { id: 'feed_1', createDrafts: true, confirmation: 'CREATE FEED DRAFTS feed_1' }, { net: net(xml(['A', 'B'])), ...deps, now: () => NOW });
    expect(result.draftsCreated).toBe(2);
    expect(executed('INSERT INTO posts')).toHaveLength(2);
    expect(executed('INSERT INTO posts')[0]!.sql).toContain("'draft'");
    expect(executed('INSERT INTO post_targets')).toHaveLength(2);
    expect(executed('INSERT INTO post_targets')[0]!.values).toContain('post');
    expect(executed('activity_logs').some(e => e.values.includes('feeds.drafts_created'))).toBe(true);
    expect(state.alloc).not.toHaveBeenCalled();
  });
  it('does not duplicate items the de-duplication guard already holds', async () => {
    db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { const q = sql(s, v); state.exec.push(q); return q.sql.includes('INSERT INTO feed_items') ? 0 : 1; });
    const result = await checkFeed(actor, { id: 'feed_1', ...DRAFTS }, { net: net(xml(['A'])), ...deps, now: () => NOW });
    expect(result.draftsCreated).toBe(0); expect(executed('INSERT INTO posts')).toHaveLength(0);
  });
  it('ignores items older than the subscription start', async () => {
    state.feedRows = [row({ ingestFrom: new Date('2026-07-01T00:00:00Z') })];
    const result = await checkFeed(actor, { id: 'feed_1', ...DRAFTS }, { net: net(xml(['A'])), ...deps, now: () => NOW });
    expect(result.entries[0]).toMatchObject({ isNew: true, eligible: false }); expect(result.draftsCreated).toBe(0);
  });
  it('rolls drafts back when the audit write fails and records a safe error', async () => {
    state.failAudit = true;
    await expect(checkFeed(actor, { id: 'feed_1', ...DRAFTS }, { net: net(xml(['A'])), ...deps, now: () => NOW })).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(executed('RETURNING enabled').some(e => e.values.includes('Posts could not be created from this feed. Check its channels and try again.'))).toBe(true);
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
  it('uses the WordPress endpoint', async () => {
    state.feedRows = [row({ kind: 'wordpress', url: 'https://example.com/blog', lastEtag: '"abc"' })];
    const n = net('[]');
    await checkFeed(actor, { id: 'feed_1' }, { net: n, now: () => NOW });
    expect(n.fetcher.mock.calls[0]![0].url).toContain('/wp-json/wp/v2/posts');
  });
  it('uses configured WordPress page size and item title and identifier ceilings', async () => {
    state.feedRows = [row({ kind: 'wordpress', url: 'https://example.com/blog' })];
    state.overrides = { 'feeds.wordpressPageSize': 31, 'feeds.entryTitleMaxCharacters': 550, 'feeds.entryGuidMaxCharacters': 560 };
    const body = JSON.stringify([{ link: 'https://example.com/post', guid: { rendered: 'g'.repeat(600) }, title: { rendered: 'T'.repeat(600) }, excerpt: { rendered: 'd'.repeat(21000) } }]);
    const n = net(body);
    const result = await checkFeed(actor, { id: 'feed_1' }, { net: n, now: () => NOW });
    expect(n.fetcher.mock.calls[0]![0].url).toContain('per_page=31');
    expect(result.entries[0]!.guid).toHaveLength(560);
    expect(result.entries[0]!.title).toHaveLength(550);
  });
});

describe('creating posts from a feed', () => {
  const run = (over: Record<string, unknown> = {}, count = 2) => checkFeed(actor, { id: 'feed_1', ...POSTS, ...over }, { net: net(xml(Array.from({ length: count }, (_, i) => `Item ${i}`)), 200, { etag: '"e1"' }), ...deps, now: () => NOW });
  const posts = () => executed('INSERT INTO posts');

  it('needs the exact posts confirmation and at least one channel', async () => {
    await expect(run({ confirmation: 'CREATE FEED DRAFTS feed_1' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.feedRows = [row({ targetIds: [] })];
    await expect(run()).rejects.toMatchObject({ code: 'conflict' });
    expect(posts()).toHaveLength(0);
  });
  it('sends items to approvals when the feed is set to review: pending, never scheduled for publishing', async () => {
    const result = await run();
    expect(result).toMatchObject({ postsCreated: 2, held: 2 });
    for (const insert of posts()) {
      expect(insert.values).toContain('pending_approval');
      expect(insert.values).toContain('pending');
      expect(insert.values).toContain('u1'); // submitted by the acting author
    }
    expect(state.alloc).toHaveBeenCalledTimes(2);
    expect(targets).toHaveBeenCalledWith(expect.anything(), ['t1'], 50, expect.stringContaining('example.com'), true);
    expect(executed('activity_logs').find(e => e.values.includes('feeds.posts_created'))!.values.join()).toContain('"held":2');
  });
  it('schedules in the next queue time when the feed schedules and the workspace has no approval rule', async () => {
    state.autoApprove = true; state.feedRows = [row({ autoApprove: true })];
    const result = await run({}, 1);
    expect(result).toMatchObject({ postsCreated: 1, held: 0 });
    const insert = posts()[0]!;
    expect(insert.values).toContain('not_required');
    expect(insert.values).toContain('scheduled');
    expect(insert.values.some(v => v instanceof Date && v.toISOString() === '2026-06-02T09:00:00.000Z')).toBe(true);
    expect(insert.values).toContain('UTC');
  });
  it('never bypasses a workspace approval rule, even for an owner and a scheduling feed', async () => {
    state.autoApprove = true; state.requiresApproval = true; state.feedRows = [row({ autoApprove: true })];
    const result = await run({}, 1);
    expect(result).toMatchObject({ postsCreated: 1, held: 1 });
    expect(posts()[0]!.values).toContain('pending_approval');
    expect(posts()[0]!.values).not.toContain('scheduled');
  });
  it('spreads one post per channel by the configured gap', async () => {
    state.autoApprove = true; state.spread = 20; state.lockedTargets = ['t1', 't2'];
    state.feedRows = [row({ autoApprove: true, spreadMinutes: 20, targetIds: ['t1', 't2'] })];
    const result = await run({}, 1);
    expect(result.postsCreated).toBe(2);
    const times = posts().map(p => (p.values.find(v => v instanceof Date && v.getUTCFullYear() === 2026 && v.getUTCMonth() === 5 && v.getUTCDate() === 2) as Date).toISOString());
    expect(times).toEqual(['2026-06-02T09:00:00.000Z', '2026-06-02T09:20:00.000Z']);
    expect(executed('INSERT INTO post_targets')).toHaveLength(2);
  });
  it('falls back to a delayed time, stepping past booked posts, when the queue has no free time', async () => {
    state.autoApprove = true; state.feedRows = [row({ autoApprove: true })];
    state.alloc.mockResolvedValue(null);
    state.bookedTimes = [new Date(NOW.getTime() + 60 * 60_000)];
    await run({}, 1);
    const at = posts()[0]!.values.find(v => v instanceof Date && v.getTime() > NOW.getTime()) as Date;
    expect(at.toISOString()).toBe('2026-06-01T13:30:00.000Z');
  });
  it('takes at most the Root per-read cap and keeps no validators while a backlog remains', async () => {
    state.overrides['feeds.autoCheck.maxItemsPerFeed'] = 1;
    const result = await run({}, 3);
    expect(result.postsCreated).toBe(1); expect(result.backlog).toBe(true);
    expect(executed('"lastEtag" = NULL').length).toBe(1);
  });
  it('stores validators once nothing is left over', async () => {
    const result = await run({}, 1);
    expect(result.backlog).toBe(false);
    const stored = executed('SET "lastPolledAt" = NOW(), "lastEtag" =')[0]!;
    expect(stored.values).toContain('"e1"');
  });
  it('is idempotent on retry: items already recorded create nothing', async () => {
    state.knownGuids = ['g0', 'g1'];
    const result = await run();
    expect(result.postsCreated).toBe(0); expect(posts()).toHaveLength(0); expect(executed('INSERT INTO feed_items')).toHaveLength(0);
  });
  it('creates nothing and reports a safe error when the whole batch fails', async () => {
    state.failAudit = true;
    await expect(run()).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(executed('RETURNING enabled').length).toBe(1);
  });
  it('stops when the channels changed after they were validated', async () => {
    state.lockedTargets = ['t9'];
    await expect(run()).rejects.toMatchObject({ code: 'conflict' });
    expect(posts()).toHaveLength(0);
  });
  it('refuses channels outside the acting scope through the shared destination rules', async () => {
    targets.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'forbidden', name: 'OperationError' }));
    await expect(run()).rejects.toBeTruthy();
    expect(posts()).toHaveLength(0);
  });
});
