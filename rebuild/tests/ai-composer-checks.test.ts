import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>, role: 'owner', member: true, linkUsed: 0, gap: 20, exec: [] as Array<{ sql: string; values: unknown[] }>,
  scope: { allPages: true, pageAccess: [] as Array<{ targetId: string }> }, nearby: [] as unknown[], local: [] as unknown[],
  targets: [{ id: 't1', name: 'Alpha', socialAccount: { provider: 'facebook' } }] as Array<{ id: string; name: string; socialAccount: { provider: string } }>,
  perf: [] as unknown[], host: true,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), target: { findFirst: vi.fn(), findMany: vi.fn() } }));
const mocks = vi.hoisted(() => ({ entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn(), host: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: (e: { features: Record<string, boolean> }, f: string) => e.features[f] === true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purge }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: mocks.host }));
vi.mock('@/server/config/store', async () => {
  const { AI_CONFIG } = await import('../src/modules/studio/config');
  const defaults: Record<string, unknown> = Object.fromEntries(AI_CONFIG.map(e => [e.key, e.defaultValue]));
  return { runtimeConfig: async (key: string) => state.overrides[key] ?? defaults[key] };
});

import { resolvePermissions } from '../src/server/permissions';
import { engagementOutlook, linkPreview, spamCheck } from '../src/modules/studio/content-tools/server/checks';
import { AI_CONTENT_TOOLS_DEFAULTS } from '../src/modules/studio/config';

const actor = { userId: 'u1', workspaceId: 'w1' };
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const html = '<head><meta property="og:title" content="Hello"><meta property="og:image" content="https://cdn.example.com/a.png"></head>';
const net = (body = html, type = 'text/html', address = '93.184.216.34') => ({ resolve: async () => [address], fetcher: vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': type } })) });
const perfRow = (i: number, interactions: number) => ({ postId: `p${i}`, text: 'x'.repeat(50), publishedAt: new Date(Date.UTC(2026, 8, 1 + i, 9)), url: null, measures: [], rankValue: interactions, rankLabel: 'Engagement', measuredAt: new Date('2026-10-01') });
const now = () => new Date('2026-10-22T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks(); state.overrides = {}; state.role = 'owner'; state.member = true; state.linkUsed = 0; state.gap = 20; state.exec = [];
  state.scope = { allPages: true, pageAccess: [] }; state.nearby = []; state.local = []; state.perf = []; state.host = true;
  state.targets = [{ id: 't1', name: 'Alpha', socialAccount: { provider: 'facebook' } }];
  mocks.entitlements.mockResolvedValue({ workspaceId: 'w1', features: { 'publishing/posts': true } });
  mocks.permissions.mockImplementation(async () => resolvePermissions({ role: state.role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], ...state.scope }));
  mocks.host.mockImplementation(async () => state.host ? { postPerformance: vi.fn(async () => state.perf) } : null);
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.target.findFirst.mockImplementation(async (args: { where: { id: string } }) => state.targets.find(t => t.id === args.where.id) ?? null);
  db.target.findMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => state.targets.filter(t => args.where.id.in.includes(t.id)));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return state.member && v.includes('w1') ? [{ role: state.role, suspendedAt: null }] : [];
    if (q.sql.includes('SELECT timezone')) return [{ timezone: 'UTC', spamGapMinutes: state.gap }];
    if (q.sql.includes("action = 'linkPreview.fetched'")) return [{ count: BigInt(state.linkUsed) }];
    if (q.sql.includes('FROM posts p LEFT JOIN post_targets')) return state.nearby;
    if (q.sql.includes('FROM posts WHERE')) return state.local;
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { state.exec.push(sql(s, v)); return 1; });
});

describe('link preview', () => {
  it('fetches a public address and returns its card; the audit stores the host only', async () => {
    const result = await linkPreview(actor, { url: 'https://example.com/secret/path?token=abc' }, { net: net(), now });
    expect(result.preview).toMatchObject({ title: 'Hello', imageUrl: 'https://cdn.example.com/a.png' });
    expect(state.exec[0]!.sql).toContain("'linkPreview.fetched'");
    const detail = JSON.stringify(state.exec[0]!.values);
    expect(detail).toContain('example.com'); expect(detail).not.toContain('token=abc'); expect(detail).not.toContain('secret/path');
  });
  it('refuses private and loopback addresses and sends the member a safe message', async () => {
    const deps = net();
    await expect(linkPreview(actor, { url: 'http://127.0.0.1/admin' }, { net: deps })).rejects.toMatchObject({ code: 'invalid_request', message: 'That address cannot be previewed.' });
    expect((await linkPreview(actor, { url: 'https://internal.example.com/' }, { net: net(html, 'text/html', '10.0.0.5'), now })).preview).toBeNull();
    expect(deps.fetcher).not.toHaveBeenCalled();
  });
  it('answers no preview for non-HTML or card-less pages', async () => {
    expect((await linkPreview(actor, { url: 'https://example.com/a.pdf' }, { net: net('%PDF', 'application/pdf'), now })).preview).toBeNull();
    expect((await linkPreview(actor, { url: 'https://example.com/' }, { net: net('<head></head>'), now })).preview).toBeNull();
  });
  it('enforces the Root hourly limit before fetching', async () => {
    state.linkUsed = 120; const deps = net();
    await expect(linkPreview(actor, { url: 'https://example.com/' }, { net: deps, now })).rejects.toMatchObject({ code: 'conflict' });
    expect(deps.fetcher).not.toHaveBeenCalled();
  });
  it('is switched off by Root policy and validates input', async () => {
    state.overrides['ai.linkPreviewPolicy'] = { ...AI_CONTENT_TOOLS_DEFAULTS.linkPreview, enabled: false };
    await expect(linkPreview(actor, { url: 'https://example.com/' }, { net: net() })).rejects.toMatchObject({ code: 'unavailable' });
    state.overrides = {};
    await expect(linkPreview(actor, { url: '' }, { net: net() })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(linkPreview(actor, { url: 'https://example.com/', extra: 1 }, { net: net() })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('is denied to a viewer and to another workspace, with nothing fetched', async () => {
    const deps = net(); state.role = 'viewer';
    await expect(linkPreview(actor, { url: 'https://example.com/' }, { net: deps })).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner';
    await expect(linkPreview({ userId: 'u1', workspaceId: 'foreign' }, { url: 'https://example.com/' }, { net: deps })).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.fetcher).not.toHaveBeenCalled(); expect(state.exec).toEqual([]);
  });
  it('answers in French', async () => {
    await expect(linkPreview(actor, { url: 'http://localhost/' }, { net: net(), locale: 'fr' })).rejects.toMatchObject({ message: 'Cette adresse ne peut pas être prévisualisée.' });
  });
});

describe('engagement outlook', () => {
  const draft = { targetId: 't1', format: 'text', length: 50 };
  it('compares a draft with the channel history from the platform module', async () => {
    state.perf = [...Array.from({ length: 6 }, (_, i) => perfRow(i, 50)), ...Array.from({ length: 6 }, (_, i) => perfRow(i + 6, 5))];
    state.local = state.perf.slice(0, 12).map((row, i) => ({ id: `p${i}`, link: null, media: [] }));
    const result = await engagementOutlook(actor, { ...draft, scheduledAtLocal: '2026-10-25T09:00' }, { now });
    expect(result.channel).toBe('Alpha'); expect(result.basis).toBe(12);
    expect(['above', 'around', 'below']).toContain(result.outlook);
  });
  it('says unknown without history or without a platform analytics host', async () => {
    expect(await engagementOutlook(actor, draft, { now })).toMatchObject({ outlook: 'unknown', basis: 0 });
    state.host = false;
    expect(await engagementOutlook(actor, draft, { now })).toMatchObject({ outlook: 'unknown', basis: 0, channel: 'Alpha' });
  });
  it('ignores posts without stored figures: missing is unknown, not zero', async () => {
    state.perf = Array.from({ length: 12 }, (_, i) => ({ ...perfRow(i, 0), rankValue: null }));
    expect(await engagementOutlook(actor, draft, { now })).toMatchObject({ outlook: 'unknown', basis: 0 });
  });
  it('rejects bad input and unknown channels', async () => {
    await expect(engagementOutlook(actor, { ...draft, format: 'gif' }, { now })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(engagementOutlook(actor, { ...draft, scheduledAtLocal: 'tomorrow' }, { now })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(engagementOutlook(actor, { ...draft, targetId: 'nope' }, { now })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('denies a channel outside the member’s grants, a viewer and another workspace', async () => {
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 't2' }] };
    await expect(engagementOutlook(actor, draft, { now })).rejects.toMatchObject({ code: 'forbidden' });
    state.scope = { allPages: true, pageAccess: [] }; state.role = 'viewer';
    await expect(engagementOutlook(actor, draft, { now })).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner';
    await expect(engagementOutlook({ userId: 'u1', workspaceId: 'foreign' }, draft, { now })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('applies a key ceiling that excludes the channel', async () => {
    const ceiling = resolvePermissions({ role: 'editor', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: false, pageAccess: [{ targetId: 't9' }] });
    await expect(engagementOutlook({ ...actor, permissionCeiling: ceiling }, draft, { now })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('spam check', () => {
  const body = { message: 'Read https://example.com/a', targetIds: ['t1', 't2'], scheduledAtLocal: '2026-10-22T11:00' };
  beforeEach(() => { state.targets = ['t1', 't2', 't3', 't4'].map(id => ({ id, name: id, socialAccount: { provider: 'facebook' } })); });
  const nearbyRow = (ids: string[]) => ({ message: 'https://example.com/a?utm=1', link: null, channels: ids.map(id => ({ id, provider: 'facebook' })) });
  it('flags the same link on too many channels of one network within the window', async () => {
    state.nearby = [nearbyRow(['t3'])];
    expect(await spamCheck(actor, body, { now })).toEqual({ risk: { pages: 3, network: 'facebook', ownPages: 2, otherPosts: 1, gapMinutes: 20 }, gapMinutes: 20 });
  });
  it('reports no risk below the threshold or when the workspace turned the guard off', async () => {
    expect((await spamCheck(actor, body, { now })).risk).toBeNull();
    state.gap = 0; state.nearby = [nearbyRow(['t3', 't4'])];
    expect(await spamCheck(actor, body, { now })).toEqual({ risk: null, gapMinutes: 0 });
  });
  it('does not count channels a limited member cannot see', async () => {
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 't1' }, { targetId: 't2' }] }; state.nearby = [nearbyRow(['t3', 't4'])];
    expect((await spamCheck(actor, body, { now })).risk).toBeNull();
  });
  it('refuses channels outside the grants, a viewer and a foreign workspace; unknown channels are not found', async () => {
    state.role = 'editor'; state.scope = { allPages: false, pageAccess: [{ targetId: 't1' }] };
    await expect(spamCheck(actor, body, { now })).rejects.toMatchObject({ code: 'forbidden' });
    state.scope = { allPages: true, pageAccess: [] }; state.role = 'viewer';
    await expect(spamCheck(actor, body, { now })).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner';
    await expect(spamCheck({ userId: 'u1', workspaceId: 'foreign' }, body, { now })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(spamCheck(actor, { ...body, targetIds: ['t1', 'ghost'] }, { now })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('validates input strictly', async () => {
    for (const bad of [{ ...body, targetIds: [] }, { ...body, extra: true }, { ...body, scheduledAtLocal: 'soon' }, { ...body, timezone: 'Mars/Base' }]) {
      await expect(spamCheck(actor, bad, { now })).rejects.toMatchObject({ code: 'invalid_request' });
    }
  });
});
