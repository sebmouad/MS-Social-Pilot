import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: new Map<string, unknown>() as Map<string, unknown>, secret: 'private-app-secret' as string | null,
  target: null as any, create: vi.fn(async (..._args: unknown[]) => ({ postGraph: vi.fn(), upload: vi.fn(), getGraph: vi.fn(), deleteGraph: vi.fn() })),
}));

vi.mock('../src/server/data', () => ({ prisma: { target: { findFirst: vi.fn(async () => state.target) } } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => state.config.get(key),
  runtimeSecret: async () => state.secret,
}));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => {
  if (value === 'bad-envelope') throw new Error('private crypto failure');
  return value.replace(/^enc:/, '');
} }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookNativeTransport: state.create }));

import { prepareFacebookNativeStatusRead } from '../src/platforms/facebook/formats/read-credentials';

const targetFixture = () => ({
  id: 'target-1', workspaceId: 'workspace-1', providerId: 'page-1', type: 'page', enabled: true,
  accessToken: 'enc:page-token', socialAccount: { id: 'connection-1', provider: 'facebook', workspaceId: 'workspace-1',
    scopes: 'pages_read_engagement pages_show_list', invalidatedAt: null, tokenExpiresAt: new Date(Date.now() + 60_000) },
});

function setup() {
  state.config = new Map<string, unknown>([
    ['facebook.native.statusRecoveryEnabled', true], ['meta.postReadScopes', ['pages_read_engagement']],
    ['meta.graphBaseUrl', 'https://graph.facebook.com'], ['meta.graphVersion', 'v24.0'],
    ['meta.appSecretProofEnabled', true], ['meta.requestTimeoutMs', 15_000], ['facebook.native.maxResponseBytes', 1048576],
  ]);
  state.secret = 'private-app-secret'; state.target = targetFixture(); state.create.mockClear();
}

afterEach(() => { vi.clearAllMocks(); });

describe('Facebook native status read credentials', () => {
  it('constructs a read transport without making provider requests and revalidates unchanged authority', async () => {
    setup();
    const controller = new AbortController();
    const prepared = await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' }, controller.signal);
    expect(prepared.transport).toBeTruthy();
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith('page-token', { signal: controller.signal });
    await prepared.assertCurrent();
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disabled Root recovery', () => state.config.set('facebook.native.statusRecoveryEnabled', false)],
    ['expired connection', () => { state.target.socialAccount.tokenExpiresAt = new Date(Date.now() - 1); }],
    ['disabled target', () => { state.target.enabled = false; }],
    ['non-Page target', () => { state.target.type = 'group'; }],
    ['wrong workspace', () => { state.target.workspaceId = 'workspace-2'; }],
    ['wrong provider', () => { state.target.socialAccount.provider = 'instagram'; }],
    ['invalidated connection', () => { state.target.socialAccount.invalidatedAt = new Date(); }],
    ['missing required grant', () => { state.target.socialAccount.scopes = 'pages_show_list'; }],
    ['invalid token envelope', () => { state.target.accessToken = 'bad-envelope'; }],
    ['empty configured read scopes', () => { state.config.set('meta.postReadScopes', []); }],
    ['malformed configured read scopes', () => { state.config.set('meta.postReadScopes', ['bad scope']); }],
  ])('fails closed for %s', async (_name, mutate) => {
    setup(); mutate();
    await expect(prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.create).not.toHaveBeenCalled();
  });

  it('rejects changed Root trust settings or grants after preparation', async () => {
    setup();
    const prepared = await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' });
    state.config.set('meta.graphVersion', 'v25.0');
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: 'unavailable' });

    setup();
    const withGrant = await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' });
    state.target.socialAccount.scopes = 'pages_read_engagement';
    await expect(withGrant.assertCurrent()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects a response-limit change after transport preparation', async () => {
    setup();
    const prepared = await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' });
    state.config.set('facebook.native.maxResponseBytes', 2048);
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('rejects a token or app-secret change after the provider read boundary', async () => {
    setup();
    const prepared = await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' });
    state.target.accessToken = 'enc:rotated-token';
    await expect(prepared.assertCurrent()).rejects.toMatchObject({ code: 'unavailable' });

    setup();
    const withSecret = await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' });
    state.secret = 'rotated-private-secret';
    await expect(withSecret.assertCurrent()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('does not expose provider credentials in failures', async () => {
    setup(); state.target.accessToken = 'bad-envelope';
    try { await prepareFacebookNativeStatusRead({ workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1' }); }
    catch (error) { expect(String(error)).not.toContain('private'); expect(String(error)).not.toContain('token'); expect(String(error)).not.toContain('crypto'); }
  });
});
