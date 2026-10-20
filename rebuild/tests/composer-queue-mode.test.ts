import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authorize: vi.fn(),
  best: vi.fn(),
  allocate: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  queuePost: vi.fn(),
  validateTargets: vi.fn(),
  tz: [{ timezone: 'Africa/Casablanca' }] as Array<{ timezone: unknown; bestTimeMode?: string }>,
}));
vi.mock('@/modules/publishing/server/best-time', () => ({ getBestTimeSuggestions: h.best }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: async () => h.tz } }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.authorize }));
vi.mock('@/modules/publishing/collaboration/server/executors', () => ({ allocateQueueTime: h.allocate }));
vi.mock('@/modules/publishing/collaboration/server/core', () => ({ bounds: async () => ({ queueLookaheadDays: 21 }) }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ createPost: h.createPost, updatePost: h.updatePost, validateTargets: h.validateTargets, limits: async () => ({ maxTargets: 50 }) }));
vi.mock('@/modules/publishing/server/queue', () => ({ queuePost: h.queuePost }));

import { createQueuedPost, previewQueueTimes, QueueAfterSaveError } from '@/modules/publishing/server/queue-compose';

const actor = { userId: 'u1', workspaceId: 'w1' };
const input = { message: 'Hello', firstComment: '', targetIds: ['t1', 't2'] };

beforeEach(() => {
  vi.clearAllMocks();
  h.tz = [{ timezone: 'Africa/Casablanca' }];
  h.authorize.mockImplementation(async (a: typeof actor) => ({ actor: a, role: 'editor' }));
});

describe('previewQueueTimes', () => {
  it('uses the same apply suggestions for combined and per-channel queue previews', async () => {
    h.tz = [{ timezone: 'Africa/Casablanca', bestTimeMode: 'apply' }];
    const suggestions = [{ dayOfWeek: 2, hour: 8, minute: 0 }];
    h.best.mockResolvedValue({ suggestions }); h.allocate.mockResolvedValue(null);
    await previewQueueTimes(actor, ['t1', 't2']);
    expect(h.best).toHaveBeenCalledWith(actor, { targetIds: ['t1', 't2'] }, expect.any(Date));
    expect(h.allocate).toHaveBeenCalledWith(expect.anything(), 'w1', 'Africa/Casablanca', ['t1', 't2'], expect.any(Date), 21, suggestions);
    expect(h.allocate).toHaveBeenCalledTimes(3);
  });

  it('returns the shared next free time and each channel own time, read-only', async () => {
    const shared = new Date('2026-10-21T09:00:00Z');
    h.allocate.mockImplementation(async (_tx: unknown, _w: string, _z: string, ids: string[]) => ids.length > 1 ? shared : new Date(ids[0] === 't1' ? '2026-10-21T09:00:00Z' : '2026-10-22T09:00:00Z'));
    const result = await previewQueueTimes(actor, ['t1', 't2']);
    expect(h.authorize).toHaveBeenCalledWith(actor, 'publishing/queue', 'read');
    expect(result.scheduledAt).toEqual(shared);
    expect(result.channels).toEqual([{ targetId: 't1', nextAt: shared }, { targetId: 't2', nextAt: new Date('2026-10-22T09:00:00Z') }]);
    expect(h.createPost).not.toHaveBeenCalled();
  });

  it('reports a full queue as null, never as a time', async () => {
    h.allocate.mockResolvedValue(null);
    expect(await previewQueueTimes(actor, ['t1'])).toEqual({ scheduledAt: null, channels: [{ targetId: 't1', nextAt: null }] });
  });

  it('refuses channels outside the actor scope and empty selections', async () => {
    h.authorize.mockResolvedValue({ actor: { ...actor, allowedTargetIds: ['t1'] }, role: 'editor' });
    await expect(previewQueueTimes(actor, ['t1', 't9'])).rejects.toThrow(/outside your channel access/);
    await expect(previewQueueTimes(actor, [])).rejects.toThrow(/at least one destination/);
    expect(h.allocate).not.toHaveBeenCalled();
  });

  it('propagates an authorization refusal', async () => {
    h.authorize.mockRejectedValue(new Error('Publishing access is unavailable in this workspace.'));
    await expect(previewQueueTimes(actor, ['t1'])).rejects.toThrow(/unavailable/);
  });

  it('fails closed when the workspace zone is unreadable', async () => {
    h.tz = [];
    await expect(previewQueueTimes(actor, ['t1'])).rejects.toThrow(/scheduling settings/);
  });
});

describe('createQueuedPost', () => {
  it('creates a draft then queues it through the queue service', async () => {
    h.createPost.mockResolvedValue({ id: 'p1' });
    const at = new Date('2026-10-21T09:00:00Z');
    h.queuePost.mockResolvedValue({ postId: 'p1', scheduledAt: at, status: 'scheduled' });
    expect(await createQueuedPost(actor, input)).toEqual({ postId: 'p1', scheduledAt: at, status: 'scheduled' });
    expect(h.createPost.mock.calls[0]![1]).not.toHaveProperty('scheduledAt');
    expect(h.queuePost).toHaveBeenCalledWith(actor, 'p1');
  });

  it('keeps the saved draft id when queueing fails, and a retry reuses that draft', async () => {
    h.createPost.mockResolvedValue({ id: 'p1' });
    h.queuePost.mockRejectedValueOnce(new Error('No queue time is available for this post.'));
    const failure = await createQueuedPost(actor, input).catch(error => error);
    expect(failure).toBeInstanceOf(QueueAfterSaveError);
    expect(failure.draftPostId).toBe('p1');
    expect(failure.message).toMatch(/No queue time/);

    const at = new Date('2026-10-21T09:00:00Z');
    h.queuePost.mockResolvedValue({ postId: 'p1', scheduledAt: at, status: 'pending_approval' });
    expect(await createQueuedPost(actor, input, 'p1')).toMatchObject({ postId: 'p1', status: 'pending_approval' });
    expect(h.createPost).toHaveBeenCalledOnce();
    expect(h.updatePost).toHaveBeenCalledWith(actor, expect.objectContaining({ postId: 'p1', message: 'Hello' }));
  });

  it('checks current queue write access before creating a draft', async () => {
    h.authorize.mockRejectedValue(new Error('Queue access revoked'));
    await expect(createQueuedPost(actor, input)).rejects.toThrow(/revoked/);
    expect(h.createPost).not.toHaveBeenCalled();
    expect(h.queuePost).not.toHaveBeenCalled();
  });

  it('does not queue when creating the draft fails', async () => {
    h.createPost.mockRejectedValue(new Error('invalid'));
    await expect(createQueuedPost(actor, input)).rejects.toThrow('invalid');
    expect(h.queuePost).not.toHaveBeenCalled();
  });
});
