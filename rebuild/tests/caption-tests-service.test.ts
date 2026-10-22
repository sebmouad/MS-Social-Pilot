import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'owner', member: true, scope: { allPages: true, pageAccess: [] as Array<{ targetId: string }> }, exec: [] as Array<{ sql: string; values: unknown[] }>,
  tests: [] as unknown[], listPosts: [] as unknown[], testable: [] as unknown[], startPosts: [] as unknown[], startLocked: 2, learnTest: [] as unknown[], learnPosts: [] as unknown[], voice: null as string | null, locale: 'en',
  running: [] as unknown[], settlePosts: [] as unknown[], settleTargets: [] as unknown[], claimed: 1, updatedPosts: 1, overrides: {} as Record<string, unknown>,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
const mocks = vi.hoisted(() => ({ entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn(), draftBatch: vi.fn() }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ createPublishingDraftBatch: mocks.draftBatch }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: (e: { features: Record<string, boolean> }, f: string) => e.features[f] === true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purge, withWorkspaceOperation: (_id: string, fn: () => unknown) => fn() }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: vi.fn(async () => null) }));
vi.mock('@/server/config/store', async () => {
  const { CAPTION_TESTS_CONFIG } = await import('../src/modules/caption-tests/config');
  const defaults: Record<string, unknown> = Object.fromEntries(CAPTION_TESTS_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => state.overrides[key] ?? defaults[key] };
});

import { resolvePermissions } from '../src/server/permissions';
import { learnCaptionTest, listCaptionTests, listTestablePosts, settleCaptionTests, startCaptionTest, startCaptionVariants } from '../src/modules/caption-tests/server/service';
import { executeCaptionTestTool } from '../src/modules/caption-tests/mcp';
import { CAPTION_TESTS_DEFAULTS, captionTestsPolicySchema, captionTestsCopySchema } from '../src/modules/caption-tests/config';

const actor = { userId: 'u1', workspaceId: 'w1' };
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const now = () => new Date('2026-10-22T12:00:00Z');
const decided = { id: 't1', name: 'Spring', hours: 48, minViews: 500, status: 'decided', reason: null, winnerLabel: 'A', lift: 100, results: [{ label: 'A', views: 1000, engagements: 100, rate: 0.1 }, { label: 'B', views: 1000, engagements: 50, rate: 0.05 }], decidedAt: new Date('2026-10-20'), learnedAt: null, createdAt: new Date('2026-10-10') };
const channelsOf = (...ids: string[]) => ids.map(id => ({ id, name: `Channel ${id}`, publishedAt: '2026-10-12T09:00:00.000Z' }));
const listRows = (...ids: string[]) => [{ id: 'pa', testId: 't1', label: 'A', message: 'Win caption', channels: channelsOf(...ids) }, { id: 'pb', testId: 't1', label: 'B', message: 'Lose caption', channels: channelsOf(...ids) }];

beforeEach(() => {
  vi.clearAllMocks(); Object.assign(state, { role: 'owner', member: true, scope: { allPages: true, pageAccess: [] }, exec: [], tests: [decided], listPosts: listRows('c1'), testable: [], startLocked: 2, learnTest: [{ status: 'decided', winnerLabel: 'A', lift: 100, results: decided.results, learnedAt: null }], learnPosts: [{ label: 'A', message: ' Win caption ', targets: ['c1'] }, { label: 'B', message: 'Lose caption', targets: ['c1'] }], voice: 'Warm', locale: 'en', running: [], settlePosts: [], settleTargets: [], claimed: 1, updatedPosts: 1, overrides: {} });
  state.startPosts = [{ id: 'p1', message: 'First line\nmore', status: 'scheduled', testId: null, targets: ['c1'] }, { id: 'p2', message: 'Second', status: 'scheduled', testId: null, targets: ['c1'] }];
  mocks.entitlements.mockResolvedValue({ workspaceId: 'w1', features: { 'analytics/posts': true, 'publishing/posts': true, 'settings/workspace': true } });
  mocks.permissions.mockImplementation(async () => resolvePermissions({ role: state.role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], ...state.scope }));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return state.member && v.includes('w1') ? [{ id: 'u1', role: state.role, suspendedAt: null, disabledAt: null }] : [];
    if (q.sql.includes('"minViews", status, reason')) return state.tests;
    if (q.sql.includes("json_build_object('id', t.id")) return state.listPosts;
    if (q.sql.includes('"captionTestId" IS NULL AND p.status')) return state.testable;
    if (q.sql.includes('SELECT id FROM posts')) return Array.from({ length: state.startLocked }, (_, i) => ({ id: `p${i}` }));
    if (q.sql.includes('AS "testId", COALESCE(array_agg')) return state.startPosts;
    if (q.sql.includes('FROM caption_tests WHERE id =')) return state.learnTest;
    if (q.sql.includes('p."captionLabel" AS label, p.message, COALESCE(array_agg')) return state.learnPosts;
    if (q.sql.includes('"aiBrandVoice" AS voice')) return [{ voice: state.voice, locale: state.locale }];
    if (q.sql.includes("status = 'running'")) return state.running;
    if (q.sql.includes('"captionLabel" AS label, status::text AS status FROM posts')) return state.settlePosts;
    if (q.sql.includes('sa.provider')) return state.settleTargets;
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v); state.exec.push(q);
    if (q.sql.includes('UPDATE posts SET "captionTestId"')) return state.updatedPosts;
    if (q.sql.includes('UPDATE caption_tests SET status')) return state.claimed;
    return 1;
  });
});

describe('listing', () => {
  it('shows the workspace tests with per-caption figures and the winner', async () => {
    const result = await listCaptionTests(actor, { now });
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0]).toMatchObject({ id: 't1', status: 'decided', winnerLabel: 'A', dueAt: '2026-10-14T09:00:00.000Z' });
    expect(result.tests[0]!.posts.map(p => p.label)).toEqual(['A', 'B']);
    expect(result).toMatchObject({ canLearn: true, canStart: true });
  });
  it('lets a viewer read results but neither start nor learn', async () => {
    state.role = 'viewer';
    expect(await listCaptionTests(actor, { now })).toMatchObject({ canLearn: false, canStart: false, tests: [expect.objectContaining({ id: 't1' })] });
  });
  it('hides a test that ran on channels beyond a limited member’s grants', async () => {
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 'c2' }] };
    expect((await listCaptionTests(actor, { now })).tests).toEqual([]);
    state.scope = { allPages: false, pageAccess: [{ targetId: 'c1' }] };
    expect((await listCaptionTests(actor, { now })).tests).toHaveLength(1);
  });
  it('queries only the caller’s workspace and denies another workspace', async () => {
    await listCaptionTests(actor, { now });
    const reads = db.$queryRaw.mock.calls.filter(([s]) => (s as TemplateStringsArray).join('').includes('caption_tests'));
    expect(reads.every(call => call.slice(1).includes('w1'))).toBe(true);
    await expect(listCaptionTests({ userId: 'u1', workspaceId: 'foreign' }, { now })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('is switched off by Root policy and answers in French', async () => {
    state.overrides['captionTests.policy'] = { ...CAPTION_TESTS_DEFAULTS, enabled: false };
    await expect(listCaptionTests(actor, { now, locale: 'fr' })).rejects.toMatchObject({ code: 'unavailable', message: 'Cette fonction n’est pas disponible pour le moment.' });
  });
  it('lists only testable posts inside the member’s channel grants', async () => {
    state.testable = [{ id: 'a', message: 'one', status: 'scheduled', targets: ['c1'] }, { id: 'b', message: 'two', status: 'scheduled', targets: ['c2'] }, { id: 'c', message: 'none', status: 'draft', targets: [] }];
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 'c1' }] };
    expect((await listTestablePosts(actor)).map(p => p.id)).toEqual(['a']);
    state.role = 'viewer';
    await expect(listTestablePosts(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('starting a test', () => {
  const input = { postIds: ['p1', 'p2'], hours: 24, confirmation: 'START CAPTION TEST' };
  it('creates the test, labels the posts in order and audits it', async () => {
    const result = await startCaptionTest(actor, input, { now });
    expect(result.ok).toBe(true);
    const insert = state.exec.find(e => e.sql.includes('INSERT INTO caption_tests'))!;
    expect(insert.values).toEqual(expect.arrayContaining(['w1', 'First line', 24, 500, 'u1']));
    const labels = state.exec.filter(e => e.sql.includes('UPDATE posts SET "captionTestId"'));
    expect(labels.map(e => e.values[1])).toEqual(['A', 'B']); expect(labels.every(e => e.values.includes('w1'))).toBe(true);
    expect(state.exec.at(-1)!.values).toContain('captionTest.started');
  });
  it('rejects a wrong confirmation, duplicates, too few or too many posts and unknown fields without writing', async () => {
    for (const bad of [{ ...input, confirmation: 'yes' }, { ...input, postIds: ['p1', 'p1'] }, { ...input, postIds: ['p1'] }, { ...input, postIds: ['1', '2', '3', '4', '5'] }, { ...input, extra: 1 }, { ...input, hours: 0 }]) {
      await expect(startCaptionTest(actor, bad, { now })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(state.exec).toEqual([]);
  });
  it('refuses posts that are missing, already in a test, failed or channel-less', async () => {
    state.startPosts = [{ id: 'p1', message: 'x', status: 'scheduled', testId: 'other', targets: ['c1'] }, { id: 'p2', message: 'y', status: 'scheduled', testId: null, targets: ['c1'] }];
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'conflict' });
    state.startPosts = [{ id: 'p1', message: 'x', status: 'failed', testId: null, targets: ['c1'] }, { id: 'p2', message: 'y', status: 'scheduled', testId: null, targets: ['c1'] }];
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'conflict' });
    state.startPosts = [{ id: 'p1', message: 'x', status: 'scheduled', testId: null, targets: [] }, { id: 'p2', message: 'y', status: 'scheduled', testId: null, targets: ['c1'] }];
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'conflict' });
    state.startPosts = [state.startPosts[1]];
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.exec.some(e => e.sql.includes('INSERT INTO caption_tests') && state.exec.length > 0)).toBe(false);
  });
  it('refuses a post on a channel outside the member’s grants', async () => {
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 'c9' }] };
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.exec).toEqual([]);
  });
  it('rolls back when a post was claimed by another test meanwhile', async () => {
    state.updatedPosts = 0;
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.exec.some(e => e.values.includes('captionTest.started'))).toBe(false);
  });
  it('is denied to a viewer and to a foreign workspace', async () => {
    state.role = 'viewer';
    await expect(startCaptionTest(actor, input, { now })).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner';
    await expect(startCaptionTest({ userId: 'u1', workspaceId: 'foreign' }, input, { now })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.exec).toEqual([]);
  });
  it('shares the service with MCP, which carries the key ceiling', async () => {
    const viewer = { scope: 'workspace', userId: 'u1', workspaceId: 'w1', role: 'owner', workspace: { id: 'w1', name: 'W', timezone: 'UTC' }, entitlements: {}, permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }) } as never;
    await expect(executeCaptionTestTool(viewer, 'start_caption_test', input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeCaptionTestTool(viewer, 'list_caption_tests', { view: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('learning from a result', () => {
  const body = { id: 't1', confirmation: 'LEARN t1' };
  it('adds one sentence to the workspace voice, marks the test and audits it', async () => {
    expect(await learnCaptionTest(actor, body, { now })).toEqual({ saved: true, already: false });
    const voice = state.exec.find(e => e.sql.includes('UPDATE workspaces SET "aiBrandVoice"'))!;
    expect(voice.values[0]).toBe('Warm\nA caption test preferred “Win caption” over “Lose caption” (100% more engagement per view).');
    expect(state.exec.some(e => e.sql.includes('UPDATE caption_tests SET "learnedAt"') && e.values.includes('w1'))).toBe(true);
    expect(state.exec.at(-1)!.values).toContain('captionTest.learned');
  });
  it('uses the workspace language for the sentence', async () => {
    state.locale = 'fr';
    await learnCaptionTest(actor, body, { now });
    expect(String(state.exec.find(e => e.sql.includes('"aiBrandVoice"'))!.values[0])).toContain('a préféré « Win caption »');
  });
  it('does nothing twice', async () => {
    state.learnTest = [{ status: 'decided', winnerLabel: 'A', lift: 100, results: decided.results, learnedAt: new Date() }];
    expect(await learnCaptionTest(actor, body, { now })).toEqual({ saved: true, already: true });
    expect(state.exec).toEqual([]);
  });
  it('refuses an undecided or unknown test and a wrong confirmation', async () => {
    state.learnTest = [{ status: 'running', winnerLabel: null, lift: null, results: null, learnedAt: null }];
    await expect(learnCaptionTest(actor, body, { now })).rejects.toMatchObject({ code: 'conflict' });
    state.learnTest = [];
    await expect(learnCaptionTest(actor, body, { now })).rejects.toMatchObject({ code: 'not_found' });
    await expect(learnCaptionTest(actor, { id: 't1', confirmation: 'LEARN other' }, { now })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.exec).toEqual([]);
  });
  it('leaves a near-full voice as it is and says why, in the member’s language', async () => {
    state.voice = 'x'.repeat(1990);
    await expect(learnCaptionTest(actor, body, { now, locale: 'fr' })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('trop longue') });
    expect(state.exec.some(e => e.sql.includes('UPDATE workspaces'))).toBe(false);
  });
  it('needs workspace settings access: members and viewers are denied, as is another workspace', async () => {
    for (const role of ['editor', 'viewer']) {
      state.role = role;
      await expect(learnCaptionTest(actor, body, { now })).rejects.toMatchObject({ code: 'forbidden' });
    }
    state.role = 'owner';
    await expect(learnCaptionTest({ userId: 'u1', workspaceId: 'foreign' }, body, { now })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.exec).toEqual([]);
  });
  it('keeps owners and admins workspace-wide, so learning never depends on a channel subset', async () => {
    state.role = 'admin'; state.scope = { allPages: false, pageAccess: [{ targetId: 'c9' }] };
    expect(await learnCaptionTest(actor, body, { now })).toEqual({ saved: true, already: false });
  });
});

describe('settling due tests', () => {
  const due = { id: 't1', workspaceId: 'w1', hours: 48, minViews: 500 };
  const posts = [{ id: 'pa', label: 'A', status: 'published' }, { id: 'pb', label: 'B', status: 'published' }];
  const targets = [{ postId: 'pa', targetId: 'c1', status: 'published', publishedAt: new Date('2026-10-10T09:00:00Z'), provider: 'facebook' }, { postId: 'pb', targetId: 'c2', status: 'published', publishedAt: new Date('2026-10-10T09:00:00Z'), provider: 'facebook' }];
  const measured = (postId: string, views: number, engagements: number, at = '2026-10-15T00:00:00Z') => ({ postId, text: '', publishedAt: new Date('2026-10-10T09:00:00Z'), url: null, measures: [{ key: 'impressions', label: '', value: views }, { key: 'reactions', label: '', value: engagements }], rankValue: null, rankLabel: '', measuredAt: new Date(at) });
  const reader = (rows: Record<string, unknown[]>) => vi.fn(async (_provider: string, request: { targetId: string }) => (rows[request.targetId] ?? []) as never);
  beforeEach(() => { state.running = [due]; state.settlePosts = posts; state.settleTargets = targets; });

  it('decides a due test from fresh stored figures and records one verdict', async () => {
    const performance = reader({ c1: [measured('pa', 1000, 100)], c2: [measured('pb', 1000, 50)] });
    expect(await settleCaptionTests({ now, performance })).toBe(1);
    const update = state.exec.find(e => e.sql.includes('UPDATE caption_tests SET status'))!;
    expect(update.values[0]).toBe('decided'); expect(update.values).toContain('A'); expect(update.values).toContain('w1');
    expect(state.exec.at(-1)!.values).toEqual(expect.arrayContaining(['captionTest.decided', null]));
  });
  it('waits when the test is not due or the figures are older than the due time', async () => {
    expect(await settleCaptionTests({ now: () => new Date('2026-10-11T00:00:00Z'), performance: reader({}) })).toBe(0);
    const stale = reader({ c1: [measured('pa', 1000, 100, '2026-10-11T00:00:00Z')], c2: [measured('pb', 1000, 50, '2026-10-11T00:00:00Z')] });
    expect(await settleCaptionTests({ now: () => new Date('2026-10-13T00:00:00Z'), performance: stale })).toBe(0);
    expect(state.exec).toEqual([]);
  });
  it('gives up with no figures after the Root grace period', async () => {
    expect(await settleCaptionTests({ now: () => new Date('2026-10-20T00:00:00Z'), performance: reader({}) })).toBe(1);
    expect(state.exec.find(e => e.sql.includes('UPDATE caption_tests SET status'))!.values).toEqual(expect.arrayContaining(['inconclusive', 'no_insights']));
  });
  it('ends a test whose post failed or was cancelled as not published', async () => {
    state.settleTargets = [{ ...targets[0]!, status: 'failed' }, targets[1]!];
    await settleCaptionTests({ now, performance: reader({}) });
    expect(state.exec.find(e => e.sql.includes('UPDATE caption_tests SET status'))!.values).toEqual(expect.arrayContaining(['inconclusive', 'not_published']));
  });
  it('is inconclusive for too few views and writes no audit when another worker already settled it', async () => {
    state.claimed = 0;
    const performance = reader({ c1: [measured('pa', 10, 1)], c2: [measured('pb', 10, 1)] });
    expect(await settleCaptionTests({ now, performance })).toBe(0);
    expect(state.exec.some(e => e.values.includes('captionTest.decided'))).toBe(false);
  });
  it('reads only the requested workspace when one is given', async () => {
    state.running = [];
    await settleCaptionTests({ workspaceId: 'w1', now, performance: reader({}) });
    const call = db.$queryRaw.mock.calls.find(([s]) => (s as TemplateStringsArray).join('').includes("status = 'running'"))!;
    expect(call.slice(1)).toContain('w1');
  });
});


describe('raw caption variants', () => {
  const input = { captions: ['Thoughtful caption', 'Brighter caption'], targetIds: ['c1'], confirmation: 'CREATE CAPTION TEST DRAFTS' };
  beforeEach(() => { mocks.draftBatch.mockImplementation(async (_actor, _inputs, complete) => complete(db, ['new-a', 'new-b'])); });
  it('uses Publishing drafts and writes the test, labels and audit in its transaction', async () => {
    expect(await startCaptionVariants(actor, input)).toMatchObject({ ok: true, postIds: ['new-a', 'new-b'] });
    expect(mocks.draftBatch).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1' }), input.captions.map(message => expect.objectContaining({ message, targetIds: ['c1'], firstComment: '' })), expect.any(Function));
    expect(state.exec.filter(e => e.sql.includes('UPDATE posts SET "captionTestId"')).map(e => e.values[1])).toEqual(['A', 'B']);
    expect(state.exec.at(-1)?.values).toContain('captionTest.started');
  });
  it('rejects wrong consent, duplicate captions and blank destinations before drafts', async () => {
    for (const bad of [{ ...input, confirmation: 'yes' }, { ...input, captions: ['same', 'same'] }, { ...input, captions: [' ', 'other'] }, { ...input, targetIds: [] }]) await expect(startCaptionVariants(actor, bad)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.draftBatch).not.toHaveBeenCalled();
  });
  it('denies viewers, foreign workspaces and channels outside member scope before drafts', async () => {
    state.role = 'viewer'; await expect(startCaptionVariants(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; await expect(startCaptionVariants({ ...actor, workspaceId: 'foreign' }, input)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 'c2' }] };
    await expect(startCaptionVariants(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.draftBatch).not.toHaveBeenCalled();
  });
  it('MCP raw mode uses service authorization and the credential permission ceiling', async () => {
    const viewer = { userId: 'u1', workspaceId: 'w1', permissions: resolvePermissions({ role: 'viewer', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }) } as never;
    await expect(executeCaptionTestTool(viewer, 'start_caption_test', input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.draftBatch).not.toHaveBeenCalled();
  });
  it('Root limits raw caption length and returns a French validation message', async () => {
    state.overrides['captionTests.policy'] = { ...CAPTION_TESTS_DEFAULTS, captionMaxCharacters: 8 };
    await expect(startCaptionVariants(actor, input, { locale: 'fr' })).rejects.toMatchObject({ code: 'invalid_request', message: 'Vérifiez les informations et réessayez.' });
    expect(mocks.draftBatch).not.toHaveBeenCalled();
  });
  it('accepts an authorized editor and rechecks role under the transaction', async () => {
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 'c1' }] };
    await expect(startCaptionVariants(actor, input)).resolves.toMatchObject({ ok: true });
    mocks.draftBatch.mockImplementation(async (_actor, _inputs, complete) => { state.member = false; return complete(db, ['new-a','new-b']); });
    await expect(startCaptionVariants(actor, input)).rejects.toMatchObject({ code: 'forbidden' });
  });
});


describe('caption setting compatibility', () => {
  it('fills new variant policy fields without losing existing Root overrides', () => {
    const { captionMaxCharacters, targetLimit, requestMaxBytes, ...legacy } = CAPTION_TESTS_DEFAULTS;
    expect(captionTestsPolicySchema.parse({ ...legacy, defaultHours: 72 })).toMatchObject({ captionMaxCharacters, targetLimit, requestMaxBytes, defaultHours: 72 });
  });
  it('fills new localized copy while preserving saved customized labels', async () => {
    const { CAPTION_TESTS_COPY } = await import('../src/modules/caption-tests/copy');
    const oldEn: Record<string, string> = { ...CAPTION_TESTS_COPY.en, title: 'Our caption lab' };
    const oldFr: Record<string, string> = { ...CAPTION_TESTS_COPY.fr, title: 'Notre atelier' };
    delete oldEn.rawHint; delete oldFr.rawHint;
    expect(captionTestsCopySchema.parse({ en: oldEn, fr: oldFr })).toMatchObject({ en: { title: 'Our caption lab', rawHint: CAPTION_TESTS_COPY.en.rawHint }, fr: { title: 'Notre atelier', rawHint: CAPTION_TESTS_COPY.fr.rawHint } });
  });
});
