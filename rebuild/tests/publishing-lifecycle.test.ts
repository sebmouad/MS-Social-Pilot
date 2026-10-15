import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  postTarget: { findMany: vi.fn() },
  post: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: db }));

import { cancelScheduledPost, reviewPost, schedulePost, submitPostForApproval } from '../src/server/publishing/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue({ role: 'editor' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue({ id: 'p1', authorId: 'u1', status: 'draft', targets: [{ status: 'pending' }] });
  db.post.update.mockResolvedValue({});
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});

describe('publishing lifecycle transitions', () => {
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
