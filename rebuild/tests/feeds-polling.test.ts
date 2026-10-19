import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: vi.fn(), workspace: vi.fn(), alloc: vi.fn(), exec: [] as Array<{ sql: string; values: unknown[] }>, due: [] as Array<{ id: string; workspaceId: string }>, claim: new Map<string, unknown>(),
  overrides: {} as Record<string, unknown>, failAudit: false, known: [] as string[], unsafe: [] as string[], requiresApproval: false,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', async () => {
  const { FEEDS_CONFIG } = await import('../src/modules/feeds/config');
  const defaults = Object.fromEntries(FEEDS_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => state.overrides[key] ?? ({ ...defaults, 'data.workspaceOperationTimeoutMs': 30000 } as Record<string, unknown>)[key] };
});
vi.mock('../src/modules/feeds/server/access', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/feeds/server/access')>('../src/modules/feeds/server/access');
  return { ...actual, authorizeFeeds: state.auth, authorizeFeedWrite: async (a: unknown) => state.auth(a, 'write') };
});
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: state.workspace }));
vi.mock('@/modules/publishing/collaboration/server/executors', () => ({ allocateQueueTime: state.alloc }));
vi.mock('@/modules/publishing/collaboration/server/versions', () => ({ loadVersionRetention: async () => 10, recordPostVersion: async () => true }));

import { automaticCheckingStatus, pollSettings, runFeedPolling } from '../src/modules/feeds/server/polling';

const NOW = new Date('2026-06-01T12:00:00Z');
const owner = { userId: 'owner1', workspaceId: 'w1' };
const feedRow = (over: Record<string, unknown> = {}) => ({ id: 'feed_1', name: 'Blog', url: 'https://example.com/feed', kind: 'rss', enabled: true, messageTemplate: '{title}\n{link}', hashtags: '', targetIds: ['t1'], autoApprove: true, spreadMinutes: 0, pollErrorCount: 0, lastPolledAt: null, lastError: null, lastEtag: null, lastModified: null, ingestFrom: new Date('2026-01-01T00:00:00Z'), createdAt: NOW, updatedAt: NOW, ...over });
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const xml = (n: number) => `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>T${i}</title><link>https://example.com/${i}</link><guid>g${i}</guid><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const net = (text: string, status = 200) => ({ resolve: vi.fn(async () => ['93.184.216.34']), fetcher: vi.fn(async (_r: { url: string; headers: Record<string, string> }) => new Response(text, { status, headers: { 'content-type': 'application/xml', etag: '"v1"' } })) });
const validate = vi.fn(async (_a: unknown, ids: string[], _m: number, _l: string | null, _s: boolean) => ids.map(id => ({ id })));
const formats = vi.fn(async () => ({ t1: 'post' }));
const qualify = vi.fn(async (_w: string, accept: (a: typeof owner) => Promise<void>) => { await accept(owner); return { actor: owner, role: 'owner', permissions: {}, entitlements: {}, workspaceWide: true } as never; });
const executed = (needle: string) => state.exec.filter(e => e.sql.includes(needle));

beforeEach(() => {
  vi.clearAllMocks(); state.exec = []; state.due = [{ id: 'feed_1', workspaceId: 'w1' }]; state.claim = new Map([['feed_1', feedRow()]]); state.overrides = { 'feeds.autoCheck.enabled': true }; state.failAudit = false; state.known = []; state.requiresApproval = false;
  state.auth.mockResolvedValue({ role: 'owner', actor: owner, permissions: {}, entitlements: {}, workspaceWide: true });
  state.workspace.mockImplementation((_id: string, cb: () => Promise<unknown>) => cb());
  state.alloc.mockResolvedValue(new Date('2026-06-02T09:00:00Z'));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRawUnsafe.mockImplementation(async (query: string, ...values: unknown[]) => {
    if (query.startsWith('SELECT id, "workspaceId" FROM feed_sources')) return state.due;
    if (query.startsWith('UPDATE feed_sources SET "lastPolledAt"')) { state.exec.push({ sql: query, values }); const row = state.claim.get(String(values[2])); state.claim.delete(String(values[2])); return row ? [row] : []; }
    return [];
  });
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return [{ role: 'owner', disabledAt: null }];
    if (q.sql.includes('SELECT guid FROM feed_items')) return state.known.map(guid => ({ guid }));
    if (q.sql.includes('SELECT enabled, "targetIds", "autoApprove"')) return [{ enabled: true, targetIds: ['t1'], autoApprove: true, spreadMinutes: 0 }];
    if (q.sql.includes('FROM workspaces')) return [{ timezone: 'UTC', requiresApproval: state.requiresApproval }];
    if (q.sql.includes('RETURNING enabled')) { state.exec.push(q); return [{ enabled: q.values.includes(1) ? false : true }]; }
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v); state.exec.push(q);
    if (state.failAudit && q.sql.includes('activity_logs')) throw new Error('audit failed');
    return 1;
  });
});
const run = (over: Record<string, unknown> = {}, items = 2) => runFeedPolling({ net: net(xml(items)), validateTargets: validate, resolveFormats: formats, qualify, now: () => NOW, ...over });

describe('automatic feed reading', () => {
  it('does nothing unless Root turns it on, and refuses invalid Root values', async () => {
    state.overrides = {};
    expect(await run()).toMatchObject({ reason: 'disabled', examined: 0 });
    state.overrides = { 'feeds.autoCheck.enabled': true, 'feeds.autoCheck.intervalSeconds': 5 };
    expect(await pollSettings()).toBeNull();
    expect(await run()).toMatchObject({ reason: 'misconfigured' });
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    state.overrides = { 'feeds.autoCheck.enabled': true, 'feeds.autoCheck.intervalSeconds': 900 };
    expect(await automaticCheckingStatus()).toEqual({ available: true, intervalMinutes: 15 });
  });

  it('claims a due feed once, qualifies an owner for the destinations and queues posts', async () => {
    const summary = await run();
    expect(summary).toMatchObject({ examined: 1, claimed: 1, postsCreated: 2, held: 0, failed: 0, outcomes: [{ feedId: 'feed_1', outcome: 'created' }] });
    expect(executed('UPDATE feed_sources SET "lastPolledAt"')[0]!.sql).toContain('enabled = true');
    expect(qualify).toHaveBeenCalledWith('w1', expect.any(Function));
    expect(validate).toHaveBeenCalledWith(owner, ['t1'], 50, null, true);
    const inserts = executed('INSERT INTO posts');
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.values).toContain('owner1');
    expect(inserts[0]!.values).toContain('scheduled');
    // A system run records no person in the audit trail.
    const auditRow = executed('activity_logs').find(e => e.values.includes('feeds.posts_created'))!;
    expect(auditRow.values).toContain(null);
    expect(auditRow.values.join()).toContain('"automatic":true');
  });

  it('holds items for approval when the workspace requires it, even for a scheduling feed', async () => {
    state.requiresApproval = true;
    const summary = await run();
    expect(summary).toMatchObject({ postsCreated: 2, held: 2 });
    expect(executed('INSERT INTO posts')[0]!.values).toContain('pending_approval');
  });

  it('loses the claim to a competing worker and creates nothing twice', async () => {
    state.claim = new Map();
    const summary = await run();
    expect(summary).toMatchObject({ claimed: 0, skipped: 1, outcomes: [{ feedId: 'feed_1', outcome: 'lost_claim' }] });
    expect(executed('INSERT INTO posts')).toHaveLength(0);
  });

  it('skips a feed without channels or without a qualifying owner and does not count either as a failure', async () => {
    state.claim = new Map([['feed_1', feedRow({ targetIds: [] })]]);
    expect((await run()).outcomes).toEqual([{ feedId: 'feed_1', outcome: 'no_destinations' }]);
    state.claim = new Map([['feed_1', feedRow()]]); state.exec = [];
    const none = vi.fn(async () => null);
    expect((await run({ qualify: none })).outcomes).toEqual([{ feedId: 'feed_1', outcome: 'no_qualifying_owner' }]);
    expect(executed('INSERT INTO posts')).toHaveLength(0);
    expect(executed('RETURNING enabled')).toHaveLength(0);
  });

  it('counts a failed read and turns the feed off at the Root failure limit, with a system audit row', async () => {
    state.overrides['feeds.autoCheck.disableAfterFailures'] = 3;
    state.claim = new Map([['feed_1', feedRow({ pollErrorCount: 2 })]]);
    const summary = await run({ net: net('boom', 500) });
    expect(summary).toMatchObject({ failed: 1, outcomes: [{ feedId: 'feed_1', outcome: 'failed' }] });
    const mark = executed('RETURNING enabled')[0]!;
    expect(mark.values).toContain(3);
    expect(mark.values).toContain('The feed did not return a usable response.');
  });

  it('asks the owner policy for a qualified owner covering every destination and stops on purge/suspension', async () => {
    const refusing = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'forbidden' }); });
    const summary = await run({ qualify: refusing });
    expect(summary.failed + summary.skipped).toBe(1);
    expect(executed('INSERT INTO posts')).toHaveLength(0);
  });

  it('reads conditionally and keeps validators only after taking everything', async () => {
    state.claim = new Map([['feed_1', feedRow({ lastEtag: '"v0"' })]]);
    const n = net(xml(1));
    await run({ net: n }, 1);
    expect(n.fetcher.mock.calls[0]![0].headers['if-none-match']).toBe('"v0"');
    expect(executed('"lastEtag" =')[0]!.values).toContain('"v1"');
  });

  it('bounds the work of one run by the Root feed count and honours a stop request', async () => {
    state.overrides['feeds.autoCheck.maxFeedsPerRun'] = 1;
    await run();
    expect(db.$queryRawUnsafe.mock.calls[0]![3]).toBe(1);
    state.due = [{ id: 'feed_1', workspaceId: 'w1' }]; state.claim = new Map([['feed_1', feedRow()]]);
    expect((await run({ shouldStop: () => true })).claimed).toBe(0);
  });
});
