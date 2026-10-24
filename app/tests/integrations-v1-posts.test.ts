import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  /** The viewer the bearer check resolves; null means an invalid, revoked or expired key. */
  key: null as null | Record<string, unknown>,
  postStatus: 'draft' as string,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), post: { findFirst: vi.fn() } }));
const publishing = vi.hoisted(() => ({ createPost: vi.fn(), readPublishingPostList: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async () => ({}), canUseFeature: () => true, entitledPlatformIds: () => ['facebook'] }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => null }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (p: { features: Record<string, { read: boolean; write: boolean }> }, feature: string, access = 'read') => Boolean(p.features?.[feature]?.[access as 'read' | 'write']) }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({}) }));
vi.mock('@/server/client-ip', () => ({ clientIp: (request: Request) => request.headers.get('x-test-ip') ?? 'ip-1' }));
vi.mock('@/server/mcp/bearer', () => ({ authenticateBearerHeader: async () => state.key }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ createPost: publishing.createPost }));
vi.mock('@/modules/publishing/server/read', () => ({ readPublishingPostList: publishing.readPublishingPostList }));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));
import { reset as resetRateLimit } from '../src/server/rate-limit';
import * as postsRoute from '../src/app/api/v1/posts/route';

const TOKEN = `mcp_${'a'.repeat(43)}`;
const origin = 'https://app.test';
const keyed = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => new Request(`${origin}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const body = async (response: Response) => response.json() as Promise<Record<string, unknown>>;
const auditRows = () => db.$executeRaw.mock.calls.map(([strings, ...values]) => ({ sql: (strings as TemplateStringsArray).join('?'), values }));

const grants = (read: boolean, write: boolean) => ({ 'publishing/posts': { read, write } });
const viewer = (over: Record<string, unknown> = {}, features: Record<string, { read: boolean; write: boolean }> = grants(true, true), pageScope: { all: boolean; ids: string[] } = { all: true, ids: [] }) => ({
  scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'owner', apiKeyId: 'mcpkey_1', entitlements: { workspaceId: 'workspace-a' },
  workspace: { id: 'workspace-a', name: 'Acme', timezone: 'UTC' }, maxResultItems: 100, resourceRestricted: !pageScope.all,
  permissions: { pageScope, features }, ...over,
});
const valid = { message: 'Hello', targetIds: ['t1'], confirmation: 'CREATE POST' };
const future = new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimit();
  Object.assign(state, { config: {}, key: viewer(), postStatus: 'draft' });
  db.$queryRaw.mockImplementation(async () => []);
  db.$executeRaw.mockImplementation(async () => 1);
  db.post.findFirst.mockImplementation(async () => ({ status: state.postStatus, scheduledAt: null }));
  publishing.createPost.mockImplementation(async () => ({ id: 'post-1' }));
  publishing.readPublishingPostList.mockImplementation(async () => []);
});

describe('GET /api/v1/posts', () => {
  it('refuses a missing or invalid key before touching Publishing', async () => {
    state.key = null;
    const response = await postsRoute.GET(keyed('/api/v1/posts'));
    expect(response.status).toBe(401); expect(await body(response)).toMatchObject({ code: 'unauthorized' });
    expect(publishing.readPublishingPostList).not.toHaveBeenCalled();
    expect((await postsRoute.GET(new Request(`${origin}/api/v1/posts`, { headers: { cookie: 'sp_session=valid' } }))).status).toBe(401);
  });
  it('needs the posts read grant', async () => {
    state.key = viewer({}, { 'settings/connections': { read: true, write: true } });
    expect((await postsRoute.GET(keyed('/api/v1/posts'))).status).toBe(403);
    expect(publishing.readPublishingPostList).not.toHaveBeenCalled();
  });
  it('lists through the Publishing read service with the key workspace, filters and result cap', async () => {
    state.key = viewer({ maxResultItems: 25 });
    publishing.readPublishingPostList.mockImplementation(async () => [{ id: 'p1', firstComment: null, targets: [{ id: 'pt1', status: 'pending', remotePostId: null, remoteUrl: null, publishedAt: null, target: { id: 't1', name: 'Alpha' }, firstCommentAt: null, firstCommentId: null, firstCommentError: null }] }]);
    const response = await postsRoute.GET(keyed('/api/v1/posts?status=scheduled,draft&from=2026-10-01&to=2026-10-31&limit=10&q=sale&channelId=t1'));
    expect(response.status).toBe(200);
    const result = await body(response) as { posts: Array<{ id: string; targets: Array<{ firstComment: { state: string } }> }> };
    expect(result.posts[0]!.id).toBe('p1'); expect(result.posts[0]!.targets[0]!.firstComment.state).toBeTruthy();
    const [actor, input, constraints] = publishing.readPublishingPostList.mock.calls[0]!;
    expect(actor).toEqual({ userId: 'user-a', workspaceId: 'workspace-a' });
    expect(input).toEqual({ status: 'scheduled,draft', from: '2026-10-01', to: '2026-10-31', limit: 10, q: 'sale', channelId: 't1' });
    expect(constraints).toEqual({ maxItems: 25 });
  });
  it('accepts the legacy single `pages` filter and refuses lists, conflicts, unknown keys and bad sizes', async () => {
    await postsRoute.GET(keyed('/api/v1/posts?pages=t1'));
    expect(publishing.readPublishingPostList.mock.calls[0]![1]).toEqual({ channelId: 't1' });
    for (const query of ['pages=t1,t2', 'pages=t1&channelId=t2', 'bogus=1', 'limit=0', 'limit=abc', 'limit=1&limit=2']) {
      expect((await postsRoute.GET(keyed(`/api/v1/posts?${query}`))).status, query).toBe(400);
    }
    expect(publishing.readPublishingPostList).toHaveBeenCalledTimes(1);
  });
  it('carries the selected-channel ceiling into the service, including an explicit empty one', async () => {
    state.key = viewer({}, grants(true, false), { all: false, ids: ['t1', 't2'] });
    await postsRoute.GET(keyed('/api/v1/posts'));
    expect(publishing.readPublishingPostList.mock.calls[0]![0]).toEqual({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['t1', 't2'] });
    state.key = viewer({}, grants(true, false), { all: false, ids: [] });
    await postsRoute.GET(keyed('/api/v1/posts'));
    expect(publishing.readPublishingPostList.mock.calls[1]![0]).toMatchObject({ allowedTargetIds: [] });
  });
  it('a key from workspace B only ever asks for workspace B', async () => {
    state.key = viewer({ workspaceId: 'workspace-b', apiKeyId: 'mcpkey_b' });
    await postsRoute.GET(keyed('/api/v1/posts?channelId=t-of-workspace-a'));
    expect(publishing.readPublishingPostList.mock.calls[0]![0]).toMatchObject({ workspaceId: 'workspace-b' });
  });
  it('returns a safe failure when the service fails', async () => {
    publishing.readPublishingPostList.mockImplementation(async () => { throw new Error('SELECT secret FROM somewhere'); });
    const response = await postsRoute.GET(keyed('/api/v1/posts'));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await body(response))).not.toMatch(/SELECT|somewhere/);
  });
});

describe('POST /api/v1/posts', () => {
  const post = (payload: unknown, headers: Record<string, string> = {}) => postsRoute.POST(keyed('/api/v1/posts', 'POST', payload, headers));
  it('refuses a missing or invalid key and creates nothing', async () => {
    state.key = null;
    const response = await post(valid);
    expect(response.status).toBe(401);
    expect(publishing.createPost).not.toHaveBeenCalled(); expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('refuses a read-only key and a key without the posts grant', async () => {
    state.key = viewer({}, grants(true, false));
    expect((await post(valid)).status).toBe(403);
    state.key = viewer({}, { 'settings/webhooks': { read: true, write: true } });
    expect((await post(valid)).status).toBe(403);
    expect(publishing.createPost).not.toHaveBeenCalled(); expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it.each([undefined, 'CREATE DRAFT', 'CREATE POST ', 'CREATE POST other'])('refuses missing or different creation consent: %s', async confirmation => {
    const response = await post({ ...valid, confirmation });
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ code: 'invalid_request' });
    expect(publishing.createPost).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('creates a draft through the Publishing service as the key owner and writes an audit receipt naming the key', async () => {
    const response = await post({ ...valid, firstComment: 'First!', link: 'https://example.com/a', media: [{ kind: 'image', url: 'https://example.com/i.png', altText: 'Alt' }] });
    expect(response.status).toBe(201);
    expect(await body(response)).toMatchObject({ id: 'post-1', status: 'draft', held: false, mcpAuditRecorded: true });
    const [actor, input] = publishing.createPost.mock.calls[0]!;
    expect(actor).toEqual({ userId: 'user-a', workspaceId: 'workspace-a' });
    expect(input).toMatchObject({ message: 'Hello', firstComment: 'First!', targetIds: ['t1'], link: 'https://example.com/a', media: [{ kind: 'image', url: 'https://example.com/i.png', altText: 'Alt' }] });
    expect(input.scheduledAt).toBeUndefined();
    const audit = auditRows().find(row => row.sql.includes('root_activities'))!;
    expect(JSON.stringify(audit.values)).toContain('rest.create_post'); expect(JSON.stringify(audit.values)).toContain('mcpkey_1'); expect(JSON.stringify(audit.values)).toContain('workspace-a');
  });
  it('schedules when scheduledAt is given and reports what the service decided', async () => {
    const response = await post({ ...valid, scheduledAt: future });
    expect(response.status).toBe(201);
    expect(publishing.createPost.mock.calls[0]![1].scheduledAt).toEqual(new Date(future));
  });
  it('an approval-required workspace holds the scheduled post: the response says pending_approval, not scheduled', async () => {
    state.postStatus = 'pending_approval';
    db.post.findFirst.mockImplementation(async () => ({ status: 'pending_approval', scheduledAt: new Date(future) }));
    const result = await body(await post({ ...valid, scheduledAt: future }));
    expect(result).toMatchObject({ id: 'post-1', status: 'pending_approval', held: true });
    expect(db.post.findFirst.mock.calls[0]![0].where).toEqual({ id: 'post-1', workspaceId: 'workspace-a' });
  });
  it('passes the selected-channel ceiling to the service; a destination outside it is refused and leaves no receipt', async () => {
    state.key = viewer({}, grants(true, true), { all: false, ids: ['t1'] });
    publishing.createPost.mockImplementation(async (_actor: unknown, input: { targetIds: string[] }) => { if (input.targetIds.includes('t2')) throw new OperationError('forbidden', 'Choose a channel this key can use.'); return { id: 'post-1' }; });
    expect((await post({ message: 'ok', targetIds: ['t1'], confirmation: 'CREATE POST' })).status).toBe(201);
    expect(publishing.createPost.mock.calls[0]![0]).toEqual({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['t1'] });
    db.$executeRaw.mockClear();
    const refused = await post({ message: 'no', targetIds: ['t1', 't2'], confirmation: 'CREATE POST' });
    expect(refused.status).toBe(403);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('an explicit empty ceiling reaches the service as an empty list, never as "all"', async () => {
    state.key = viewer({}, grants(true, true), { all: false, ids: [] });
    await post(valid);
    expect(publishing.createPost.mock.calls[0]![0]).toMatchObject({ allowedTargetIds: [] });
  });
  it('cannot be pointed at another workspace: the workspace is the key\'s and body fields for it are refused', async () => {
    state.key = viewer({ workspaceId: 'workspace-b', apiKeyId: 'mcpkey_b' });
    await post(valid);
    expect(publishing.createPost.mock.calls[0]![0]).toMatchObject({ workspaceId: 'workspace-b' });
    expect((await post({ ...valid, workspaceId: 'workspace-a' })).status).toBe(400);
    expect((await post({ ...valid, authorId: 'someone' })).status).toBe(400);
    expect(publishing.createPost).toHaveBeenCalledTimes(1);
  });
  it('validates the body: types, bounds, unknown fields, destinations and the schedule time', async () => {
    const bad: unknown[] = [
      {}, { message: 'x' }, { message: 'x', targetIds: [] }, { message: 5, targetIds: ['t1'] }, { message: 'x'.repeat(10_001), targetIds: ['t1'] },
      { ...valid, targetIds: Array.from({ length: 51 }, (_, i) => `t${i}`) }, { ...valid, targetIds: [''] }, { ...valid, extra: true },
      { ...valid, scheduledAt: 'tomorrow' }, { ...valid, scheduledAt: '2026-10-30' }, { ...valid, firstCommentDelayMinutes: -1 }, { ...valid, firstCommentDelayMinutes: 1.5 },
      { ...valid, media: [{ kind: 'audio', url: 'https://example.com/a' }] }, { ...valid, media: Array.from({ length: 21 }, () => ({ kind: 'image', url: 'https://example.com/i.png' })) },
      { ...valid, media: [{ kind: 'image', url: 'https://example.com/i.png', extra: 1 }] }, [], 'text', null,
    ];
    for (const payload of bad) expect((await post(payload)).status, JSON.stringify(payload)?.slice(0, 80)).toBe(400);
    expect(publishing.createPost).not.toHaveBeenCalled();
  });
  it('caps request size and rejects malformed JSON', async () => {
    expect((await post(`{"message":"${'x'.repeat(300_000)}","targetIds":["t1"]}`)).status).toBe(400);
    expect((await post('{nope')).status).toBe(400);
    expect((await postsRoute.POST(keyed('/api/v1/posts', 'POST', valid, { 'content-length': '999999' }))).status).toBe(400);
    expect(publishing.createPost).not.toHaveBeenCalled();
  });
  it('uses the current Root request body ceiling', async () => {
    state.config['integrations.api.postsBodyMaxBytes'] = 1024;
    expect((await post(`{"message":"${'x'.repeat(1500)}","targetIds":["t1"]}`)).status).toBe(400);
    expect(publishing.createPost).not.toHaveBeenCalled();
  });
  it('uses current Root field and collection limits after contract parsing', async () => {
    state.config['integrations.api.messageMaxCharacters'] = 3;
    expect((await post({ message: 'Hello', targetIds: ['t1'], confirmation: 'CREATE POST' })).status).toBe(400);
    state.config['integrations.api.messageMaxCharacters'] = 100;
    state.config['integrations.api.targetIdsMaxItems'] = 1;
    expect((await post({ message: 'Hi', targetIds: ['t1', 't2'], confirmation: 'CREATE POST' })).status).toBe(400);
    expect(publishing.createPost).not.toHaveBeenCalled();
  });
  it('maps a service failure to a safe error without internals', async () => {
    publishing.createPost.mockImplementation(async () => { throw new Error('INSERT INTO posts leaked'); });
    const response = await post(valid);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await body(response))).not.toMatch(/INSERT|leaked/);
  });
  it('is off with the API switch', async () => {
    state.config['integrations.api.enabled'] = false;
    const response = await post(valid);
    expect(await body(response)).toMatchObject({ code: 'unavailable' }); expect(publishing.createPost).not.toHaveBeenCalled();
  });
});
