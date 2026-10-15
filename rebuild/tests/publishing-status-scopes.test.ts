import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  postTarget: { findMany: vi.fn(), groupBy: vi.fn() },
  post: { findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
const provider = vi.hoisted(() => ({ getRemoteStatus: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/platforms/registry', () => ({ platformFor: vi.fn(async () => provider) }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: vi.fn(async () => ({})), hasPlatformCapability: vi.fn(() => true) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async () => ['pages_read_engagement']) }));

import { syncPostStatus } from '@/server/publishing/lifecycle';

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue({
    id: 'post-1', authorId: 'user-1', status: 'scheduled', targets: [{
      id: 'post-target-1', status: 'scheduled_remote', remotePostId: 'remote-1',
      target: { type: 'page', accessToken: 'encrypted', socialAccount: { provider: 'facebook', scopes: 'pages_show_list', invalidatedAt: null } },
    }],
  });
});

describe('manual post status scope gate', () => {
  it('does not read remote status or write parent state when the grant is missing', async () => {
    expect(await syncPostStatus({ userId: 'user-1', workspaceId: 'workspace-1' }, 'post-1')).toEqual({ synced: 0 });
    expect(provider.getRemoteStatus).not.toHaveBeenCalled();
    expect(db.postTarget.groupBy).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
