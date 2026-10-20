import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn() }));
vi.mock('@/server/platforms/publication-recovery', () => ({ assertPlatformPublicationOutcome: vi.fn(), assertPlatformPublicationsSettled: vi.fn() }));
vi.mock('../src/modules/publishing/server/post-deletion-guard', () => ({ assertNoPostDeletionForRemoteIdentity: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: {} }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 2048 }));

import { projectPublicationInTransaction } from '@/modules/publishing/server/publication';

const attempt = { id: 'op', workspaceId: 'w1', postId: 'p1', postTargetId: 'pt1', targetId: 't1', provider: 'facebook', state: 'receipt_recorded', remotePostId: 'remote-1', remoteUrl: null, receiptAt: new Date('2030-01-01T00:00:00Z'), attestedAt: null };

function transaction(heldFor: Date | null) {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
    postTarget: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([{ status: 'scheduled_remote', publishedAt: null }]) },
    post: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  tx.$queryRaw.mockResolvedValueOnce([attempt]).mockResolvedValueOnce([{ nativeScheduledFor: heldFor }]);
  return tx;
}

describe('projecting a publication receipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a destination claimed for platform-held scheduling as scheduled_remote with its remote id and no publication time', async () => {
    const tx = transaction(new Date('2030-02-01T00:00:00Z'));
    await projectPublicationInTransaction(tx as never, { userId: 'u1', workspaceId: 'w1' }, 'op');
    expect(tx.postTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'scheduled_remote', remotePostId: 'remote-1', remoteUrl: null, publishedAt: null } }));
    // The post as a whole waits for the platform: aggregation reports it as scheduled, not published.
    expect(tx.post.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'scheduled' }) }));
  });

  it('records an ordinary publication as published', async () => {
    const tx = transaction(null);
    tx.postTarget.findMany.mockResolvedValue([{ status: 'published', publishedAt: new Date('2030-01-01T00:00:00Z') }]);
    await projectPublicationInTransaction(tx as never, { userId: 'u1', workspaceId: 'w1' }, 'op');
    expect(tx.postTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published', remotePostId: 'remote-1' }) }));
  });

  it('lets a read that proved the post live override a requested hold', async () => {
    const tx = transaction(new Date('2030-02-01T00:00:00Z'));
    tx.postTarget.findMany.mockResolvedValue([{ status: 'published', publishedAt: new Date('2030-01-02T00:00:00Z') }]);
    await projectPublicationInTransaction(tx as never, { userId: 'u1', workspaceId: 'w1' }, 'op', new Date('2030-01-02T00:00:00Z'));
    expect(tx.postTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }));
  });
});
