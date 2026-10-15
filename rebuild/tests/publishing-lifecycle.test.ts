import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findMany: vi.fn() },
  postTarget: { findMany: vi.fn() },
  post: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.maxMessageCharacters': 10000, 'publishing.maxImportRows': 100,
  'publishing.maxImportBytes': 256000, 'publishing.maxTargetsPerPost': 20,
  'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
})[key] }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({ publish: vi.fn(), supportsTargetKind: () => true }) }));

import { cancelScheduledPost, createPost, reviewPost, schedulePost, submitPostForApproval } from '../src/server/publishing/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue({ role: 'editor' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'draft', targets: [{ status: 'pending' }] });
  db.post.update.mockResolvedValue({});
  db.post.create.mockResolvedValue({});
  db.target.findMany.mockResolvedValue([{ id: 'target-1', type: 'page', accessToken: 'encrypted', socialAccount: { provider: 'facebook', invalidatedAt: null } }]);
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

describe('publishing lifecycle transitions', () => {
  it('creates a scheduled post atomically and rejects a schedule without destinations', async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    await createPost(actor, { message: 'Planned update', firstComment: 'More details', targetIds: ['target-1'], scheduledAt });
    expect(db.post.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'scheduled', scheduledAt, targets: { create: [expect.objectContaining({ targetId: 'target-1', status: 'pending' })] } }) });
    db.post.create.mockClear();
    await expect(createPost(actor, { message: 'No destination', firstComment: '', targetIds: [], scheduledAt })).rejects.toThrow(/destination/);
    expect(db.post.create).not.toHaveBeenCalled();
  });
  it('submits an authored draft with destinations for approval', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    await submitPostForApproval(actor, 'p1');
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'pending_approval' }) });
  });

  it('rejects approval submission by a contributor for another author', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u2', status: 'draft', targets: [{ status: 'pending' }] });
    await expect(submitPostForApproval(actor, 'p1')).rejects.toThrow(/cannot be submitted/);
  });

  it('allows a client reviewer to approve a different author’s post back to draft', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'client' });
    db.post.findFirst.mockResolvedValueOnce({ authorId: 'u2' }).mockResolvedValueOnce({ id: 'p1', status: 'pending_approval' });
    await reviewPost(actor, 'p1', 'approve');
    expect(db.post.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', workspaceId: 'w1', status: 'pending_approval' }, data: expect.objectContaining({ status: 'draft' }) });
  });

  it('schedules only future posts with pending destinations', async () => {
    await schedulePost(actor, 'p1', new Date(Date.now() + 60_000));
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ status: 'scheduled' }) });
    await expect(schedulePost(actor, 'p1', new Date(Date.now() - 60_000))).rejects.toThrow(/future/);
  });

  it('cancels a local queued item and preserves remote scheduled posts', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'scheduled', targets: [{ status: 'pending', remotePostId: null }] });
    await cancelScheduledPost(actor, 'p1');
    expect(db.post.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', workspaceId: 'w1', status: 'scheduled' }, data: expect.objectContaining({ status: 'draft', scheduledAt: null }) });

    db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'scheduled', targets: [{ status: 'scheduled_remote', remotePostId: 'remote-1' }] });
    await expect(cancelScheduledPost(actor, 'p1')).rejects.toThrow(/no longer be cancelled locally/);
  });

  it('blocks mutations outside a member’s channel scope', async () => {
    db.postTarget.findMany.mockResolvedValue([{ targetId: 'restricted-target' }]);
    await expect(submitPostForApproval({ ...actor, allowedTargetIds: ['allowed-target'] }, 'p1')).rejects.toThrow(/channel scope/);
    expect(db.post.update).not.toHaveBeenCalled();
  });
});
