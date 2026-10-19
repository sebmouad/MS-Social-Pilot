vi.mock('@/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
// Operation-lock/authority behavior is exercised by publishing-guard and PostgreSQL suites.
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  postTarget: { findMany: vi.fn(), groupBy: vi.fn() },
  post: { findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));
const provider = vi.hoisted(() => ({ statusPolicyFingerprint: 'test-policy', getRemoteStatus: vi.fn(), canUseCredential: vi.fn(() => false) }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/platforms/registry', () => ({ platformFor: vi.fn(async () => provider) }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: vi.fn(async () => ({})), hasPlatformCapability: vi.fn(() => true) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async () => ['pages_read_engagement']) }));

vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: async (actor: unknown) => ({ actor, role: 'owner', entitlements: {} }) }));
vi.mock('@/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: async () => ['target-1'], publishingPostVisibilityWhere: () => ({ workspaceId: 'workspace-1' }) }));

import { syncPostStatus } from '@/server/publishing/lifecycle';

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(work => work(db));
  db.$queryRaw.mockResolvedValue([]);
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue({
    id: 'post-1', authorId: 'user-1', status: 'scheduled', targets: [{
      id: 'post-target-1', targetId: 'target-1', status: 'scheduled_remote', remotePostId: 'remote-1',
      target: { id: 'target-1', workspaceId: 'workspace-1', enabled: true, providerId: 'page-1', type: 'page', accessToken: 'encrypted', socialAccount: { workspaceId: 'workspace-1', provider: 'facebook', scopes: 'pages_show_list', invalidatedAt: null } },
    }],
  });
});

describe('manual post status scope gate', () => {
  it('does not read remote status or write parent state when the grant is missing', async () => {
    expect(await syncPostStatus({ userId: 'user-1', workspaceId: 'workspace-1' }, 'post-1')).toEqual({ synced: 0 });
    expect(provider.getRemoteStatus).not.toHaveBeenCalled();
    expect(db.postTarget.groupBy).not.toHaveBeenCalled();
    expect(provider.canUseCredential).toHaveBeenCalled();
    expect(db.post.update).not.toHaveBeenCalled();
  });
});
