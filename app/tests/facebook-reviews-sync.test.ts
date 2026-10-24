import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { membership: { findUnique: vi.fn() }, target: { findFirst: vi.fn(), findMany: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), decrypt: vi.fn(), engine: { listReviews: vi.fn() }, configuredEngine: vi.fn(),
  entitlements: vi.fn(), permissions: vi.fn(), canUseFeature: vi.fn(), canAccessFeature: vi.fn(), canAccessPage: vi.fn(), guard: vi.fn(), tx: { $executeRaw: vi.fn() },
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: mocks.configuredEngine }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature, canAccessPage: mocks.canAccessPage }));
vi.mock('@/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: mocks.guard, inboxCommentSuppressed: vi.fn(), orderInboxCommentBatch: vi.fn() }));

import { syncFacebookReviews } from '../src/platforms/facebook/inbox';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const review = (id: string) => ({ id, createdAt: new Date('2026-03-01T10:00:00Z'), authorName: 'Sam', rating: 5, recommendation: null, text: 'Great' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ id: 'm', role: 'owner' });
  mocks.entitlements.mockResolvedValue({}); mocks.permissions.mockResolvedValue({});
  mocks.canUseFeature.mockReturnValue(true); mocks.canAccessFeature.mockReturnValue(true); mocks.canAccessPage.mockReturnValue(true);
  mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-1' }]);
  mocks.prisma.target.findFirst.mockResolvedValue({ id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_read_engagement,pages_messaging', tokenExpiresAt: null, invalidatedAt: null } });
  mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : ['pages_messaging']);
  mocks.decrypt.mockReturnValue('page-secret'); mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.listReviews.mockResolvedValue([review('s1'), review('s2')]);
  mocks.prisma.$executeRaw.mockResolvedValue(1); mocks.tx.$executeRaw.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => Promise<unknown>) => work(mocks.tx));
  mocks.guard.mockImplementation(async (_workspace: string, _target: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(new AbortController().signal));
});

describe('Facebook review sync', () => {
  it('reads reviews with the Page token under the channel lock and stores them', async () => {
    const result = await syncFacebookReviews(actor, 'target-1');
    expect(mocks.engine.listReviews).toHaveBeenCalledWith('page-secret', 'page-1');
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ targetCount: 1, failedCount: 0, reviewCount: 2 });
    expect(mocks.guard).toHaveBeenCalledWith('workspace-1', 'target-1', expect.any(Function));
    expect(JSON.stringify(mocks.prisma.$executeRaw.mock.calls)).not.toContain('page-secret');
  });
  it('refuses when Root disables the platform, without a provider read', async () => {
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? false : []);
    await expect(syncFacebookReviews(actor, 'target-1')).rejects.toThrow(/unavailable in the inbox/);
    expect(mocks.configuredEngine).not.toHaveBeenCalled();
  });
  it('does not reveal a channel the member cannot access', async () => {
    mocks.canAccessPage.mockReturnValue(false);
    await expect(syncFacebookReviews(actor, 'target-1')).rejects.toThrow(/unavailable in the current workspace/);
    expect(mocks.engine.listReviews).not.toHaveBeenCalled();
  });
  it('reports a channel that could not be read while keeping the others', async () => {
    mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-1' }, { id: 'target-2' }]);
    mocks.prisma.target.findFirst.mockResolvedValueOnce({ id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_messaging', tokenExpiresAt: null, invalidatedAt: null } }).mockResolvedValueOnce(null);
    const result = await syncFacebookReviews(actor);
    expect(result).toMatchObject({ targetCount: 1, failedCount: 1, reviewCount: 2 });
  });
});
