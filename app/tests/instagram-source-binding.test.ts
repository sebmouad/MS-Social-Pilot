import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';

const state = vi.hoisted(() => ({ targets: vi.fn(), page: vi.fn(), config: vi.fn(), bindings: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { target: { findMany: state.targets, findFirst: state.page }, $queryRaw: state.bindings } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('@/platforms/instagram/locale', () => ({ instagramLocale: async () => 'fr' }));
vi.mock('@/server/secret-crypto', () => ({ decryptSecret: (value: string) => {
  if (!value.startsWith('encrypted:')) throw new Error('bad ciphertext');
  return value.slice('encrypted:'.length);
} }));

import { assertInstagramSource } from '@/platforms/instagram/source-binding';

const scopes = [...new Set([...INSTAGRAM_POLICY_DEFAULTS.readScopes, ...INSTAGRAM_POLICY_DEFAULTS.commentScopes])].join(',');
const makeTarget = () => ({
  id: 'instagram-target', workspaceId: 'workspace', providerId: 'ig-user', type: 'instagram', enabled: true, accessToken: 'encrypted:page-token',
  socialAccount: { id: 'ig-source', workspaceId: 'workspace', provider: 'instagram', providerUserId: 'ig-user', scopes, invalidatedAt: null as Date | null, tokenExpiresAt: null as Date | null,
    meta: { pageId: 'page', sourceId: 'facebook-source', remotePageId: 'remote-page' } as unknown },
});
const makePage = () => ({
  id: 'page', workspaceId: 'workspace', providerId: 'remote-page', type: 'page', enabled: true, socialAccountId: 'facebook-source', accessToken: 'encrypted:page-token',
  socialAccount: { id: 'facebook-source', workspaceId: 'workspace', provider: 'facebook', scopes, invalidatedAt: null as Date | null, tokenExpiresAt: null as Date | null },
});
const input = { workspaceId: 'workspace', targetId: 'instagram-target', remoteTargetId: 'ig-user', accessToken: 'page-token' };
let target: ReturnType<typeof makeTarget>, page: ReturnType<typeof makePage>;

beforeEach(() => {
  vi.resetAllMocks(); target = makeTarget(); page = makePage();
  state.targets.mockImplementation(async () => [target]); state.page.mockImplementation(async () => page);
  state.bindings.mockImplementation(async () => [{ meta: target.socialAccount.meta }]);
  state.config.mockImplementation(async (key: string) => key === 'instagram.policy' ? INSTAGRAM_POLICY_DEFAULTS : true);
});

describe('Instagram cloned Page source validity', () => {
  it('accepts exact selected same-workspace source, credential and grant bindings', async () => {
    await expect(assertInstagramSource(input)).resolves.toBeUndefined();
    expect(state.targets).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace', id: 'instagram-target', providerId: 'ig-user', enabled: true, type: 'instagram' }), take: INSTAGRAM_POLICY_DEFAULTS.connectionMaxPages + 1 }));
    expect(state.page).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace', id: 'page', providerId: 'remote-page', enabled: true, socialAccountId: 'facebook-source' }) }));
    expect(state.bindings.mock.calls[0]![0].join(' ')).toContain("provider='instagram'");
    expect(state.bindings.mock.calls[0]!.slice(1)).toEqual(['ig-source', 'workspace']);
  });
  it.each(['page-disabled', 'page-missing', 'page-revoked', 'page-expired', 'page-rotated-token', 'page-broken-token', 'page-other-workspace', 'page-other-source', 'page-other-provider', 'page-rebound', 'page-missing-grant'])('denies %s before dispatch', async change => {
    if (change === 'page-disabled') page.enabled = false;
    if (change === 'page-missing') state.page.mockResolvedValue(null);
    if (change === 'page-revoked') page.socialAccount.invalidatedAt = new Date();
    if (change === 'page-expired') page.socialAccount.tokenExpiresAt = new Date('2000-01-01');
    if (change === 'page-rotated-token') page.accessToken = 'encrypted:rotated';
    if (change === 'page-broken-token') page.accessToken = 'broken';
    if (change === 'page-other-workspace') page.socialAccount.workspaceId = 'other';
    if (change === 'page-other-source') page.socialAccountId = 'another';
    if (change === 'page-other-provider') page.socialAccount.provider = 'instagram';
    if (change === 'page-rebound') page.providerId = 'another-page';
    if (change === 'page-missing-grant') page.socialAccount.scopes = 'instagram_basic';
    await expect(assertInstagramSource(input)).rejects.toMatchObject({ outcome: 'rejected', message: INSTAGRAM_POLICY_DEFAULTS.copy.permission.fr });
  });
  it.each(['target-disabled', 'target-cross-workspace', 'target-other-id', 'target-other-remote', 'target-missing-grants', 'target-revoked', 'target-expired', 'target-token', 'source-cross-workspace', 'source-rebound', 'source-missing-meta', 'source-other-provider'])('denies %s despite a matching source Page', async change => {
    if (change === 'target-disabled') target.enabled = false;
    if (change === 'target-cross-workspace') target.workspaceId = target.socialAccount.workspaceId = 'other';
    if (change === 'target-other-id') target.id = 'other';
    if (change === 'target-other-remote') target.providerId = target.socialAccount.providerUserId = 'other';
    if (change === 'target-missing-grants') target.socialAccount.scopes = 'instagram_basic';
    if (change === 'target-revoked') target.socialAccount.invalidatedAt = new Date();
    if (change === 'target-expired') target.socialAccount.tokenExpiresAt = new Date('2000-01-01');
    if (change === 'target-token') target.accessToken = 'encrypted:other';
    if (change === 'source-cross-workspace') target.socialAccount.workspaceId = 'other';
    if (change === 'source-rebound') target.socialAccount.providerUserId = 'another';
    if (change === 'source-missing-meta') target.socialAccount.meta = null;
    if (change === 'source-other-provider') target.socialAccount.provider = 'facebook';
    await expect(assertInstagramSource(input)).rejects.toMatchObject({ outcome: 'rejected' });
  });
  it('requires the operation grants on both the clone and live source', async () => {
    await expect(assertInstagramSource({ ...input, requiredScopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes })).resolves.toBeUndefined();
    page.socialAccount.scopes = INSTAGRAM_POLICY_DEFAULTS.readScopes.join(',');
    await expect(assertInstagramSource({ ...input, requiredScopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes })).rejects.toMatchObject({ outcome: 'rejected' });
  });
  it('denies missing persisted binding metadata even if the cloned credential matches', async () => {
    state.bindings.mockResolvedValue([]);
    await expect(assertInstagramSource(input)).rejects.toMatchObject({ outcome: 'rejected' });
    expect(state.page).not.toHaveBeenCalled();
  });
  it('keeps token-only operations bounded and denies overflow before source reads', async () => {
    state.targets.mockResolvedValue(Array.from({ length: INSTAGRAM_POLICY_DEFAULTS.connectionMaxPages + 1 }, makeTarget));
    await expect(assertInstagramSource({ accessToken: 'page-token' })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(state.page).not.toHaveBeenCalled();
  });
  it('permits token-only reads only after validating a selected linked source', async () => {
    await expect(assertInstagramSource({ accessToken: 'page-token' })).resolves.toBeUndefined();
    expect(state.targets.mock.calls[0]![0].where).not.toHaveProperty('workspaceId');
    expect(state.page.mock.calls[0]![0].where.workspaceId).toBe('workspace');
  });
  it('denies disabled installation, missing credentials and empty scope policy', async () => {
    state.config.mockImplementation(async (key: string) => key === 'instagram.policy' ? INSTAGRAM_POLICY_DEFAULTS : false);
    await expect(assertInstagramSource(input)).rejects.toMatchObject({ outcome: 'rejected' });
    state.config.mockImplementation(async (key: string) => key === 'instagram.policy' ? INSTAGRAM_POLICY_DEFAULTS : true);
    await expect(assertInstagramSource({ ...input, accessToken: '' })).rejects.toMatchObject({ outcome: 'rejected' });
    await expect(assertInstagramSource({ ...input, requiredScopes: [] })).rejects.toMatchObject({ outcome: 'rejected' });
  });
});
