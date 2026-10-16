vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 15000 }));
// Operation-lock/authority behavior is exercised by publishing-guard and PostgreSQL suites.
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal, lockTargets: async () => {} }),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  postTarget: { findMany: vi.fn() },
  post: { findFirst: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: db }));

import { reschedulePost, reviewPost } from '../src/server/publishing/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };
const input = { postId: 'p1', date: '2026-10-20', time: '09:00', timeZone: 'America/New_York' };
const scheduled = { id: 'p1', authorId: 'u1', status: 'scheduled', scheduledAt: new Date('2026-10-18T13:00:00Z'), targets: [{ status: 'pending', remotePostId: null }] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  vi.clearAllMocks();
  db.membership.findUnique.mockResolvedValue({ role: 'editor' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockResolvedValue(scheduled);
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
});
afterEach(() => vi.useRealTimers());

describe('rescheduling a scheduled post', () => {
  it('stores the workspace-local wall time as the matching instant and audits both times', async () => {
    const result = await reschedulePost(actor, input);
    expect(result.scheduledAt.toISOString()).toBe('2026-10-20T13:00:00.000Z');
    expect(db.post.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', workspaceId: 'w1', status: 'scheduled' }, data: expect.objectContaining({ scheduledAt: new Date('2026-10-20T13:00:00Z') }) });
    expect(JSON.stringify(db.$executeRaw.mock.calls)).toContain('publishing.post_rescheduled');
    expect(JSON.stringify(db.$executeRaw.mock.calls)).toContain('2026-10-18T13:00:00.000Z');
  });

  it('applies the daylight-saving offset of the target day, not of today', async () => {
    // New York leaves daylight time on 2026-11-01, so 09:00 is UTC-5 after the change.
    const result = await reschedulePost(actor, { ...input, date: '2026-11-02' });
    expect(result.scheduledAt.toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('rejects local times that do not exist because clocks jump forward', async () => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    await expect(reschedulePost(actor, { ...input, date: '2026-03-08', time: '02:30' })).rejects.toThrow(/does not exist on that day/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects the past in the workspace zone, even when the UTC date is still in the future', async () => {
    // 2026-10-15 20:00 in Honolulu is 2026-10-16T06:00Z, after "now"; 06:00 that morning is before it.
    vi.setSystemTime(new Date('2026-10-15T20:00:00Z'));
    await expect(reschedulePost(actor, { ...input, date: '2026-10-15', time: '09:00', timeZone: 'Pacific/Honolulu' })).rejects.toThrow(/future/);
    await expect(reschedulePost(actor, { ...input, date: '2026-10-15', time: '12:00', timeZone: 'Pacific/Honolulu' })).resolves.toBeTruthy();
  });

  it('rejects malformed input and unknown time zones', async () => {
    await expect(reschedulePost(actor, { ...input, date: '2026-02-30' })).rejects.toThrow(/valid date and time/);
    await expect(reschedulePost(actor, { ...input, time: '9am' })).rejects.toThrow(/valid date and time/);
    await expect(reschedulePost(actor, { ...input, timeZone: 'Mars/Olympus' })).rejects.toThrow(/time zone/);
    expect(db.post.updateMany).not.toHaveBeenCalled();
  });

  it('allows only workspace members who can write posts', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(reschedulePost(actor, input)).rejects.toThrow(/permission/);
    db.membership.findUnique.mockResolvedValue(null);
    await expect(reschedulePost(actor, input)).rejects.toThrow(/no longer a member/);
    expect(db.post.updateMany).not.toHaveBeenCalled();
  });

  it('lets a contributor move only their own posts but a manager move any', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    db.post.findFirst.mockResolvedValue({ ...scheduled, authorId: 'u2' });
    await expect(reschedulePost(actor, input)).rejects.toThrow(/cannot be rescheduled/);
    db.post.findFirst.mockResolvedValue({ ...scheduled, authorId: 'u1' });
    await expect(reschedulePost(actor, input)).resolves.toBeTruthy();
    db.membership.findUnique.mockResolvedValue({ role: 'editor' });
    db.post.findFirst.mockResolvedValue({ ...scheduled, authorId: 'u2' });
    await expect(reschedulePost(actor, input)).resolves.toBeTruthy();
  });

  it('refuses posts outside the member channel scope', async () => {
    db.postTarget.findMany.mockResolvedValue([{ targetId: 'page-other' }]);
    await expect(reschedulePost({ ...actor, allowedTargetIds: ['page-1'] }, input)).rejects.toThrow(/channel scope/);
    expect(db.post.updateMany).not.toHaveBeenCalled();
  });

  it('only moves posts that are scheduled and not yet handed to the platform', async () => {
    db.post.findFirst.mockResolvedValue({ ...scheduled, status: 'draft' });
    await expect(reschedulePost(actor, input)).rejects.toThrow(/still waiting to publish/);
    db.post.findFirst.mockResolvedValue({ ...scheduled, status: 'published' });
    await expect(reschedulePost(actor, input)).rejects.toThrow(/still waiting to publish/);
    db.post.findFirst.mockResolvedValue({ ...scheduled, targets: [{ status: 'scheduled_remote', remotePostId: 'remote-1' }] });
    await expect(reschedulePost(actor, input)).rejects.toThrow(/still waiting to publish/);
    db.post.findFirst.mockResolvedValue(null);
    await expect(reschedulePost(actor, input)).rejects.toThrow(/cannot be rescheduled/);
  });

  it('fails safely when the status changed between the read and the write', async () => {
    db.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(reschedulePost(actor, input)).rejects.toThrow(/still waiting to publish/);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('approval review note', () => {
  it('records an optional trimmed note with the decision and rejects an overlong one', async () => {
    db.post.findFirst.mockResolvedValue({ id: 'p1', status: 'pending_approval' });
    await reviewPost(actor, 'p1', 'reject', '  Needs a clearer image  ');
    expect(JSON.stringify(db.$executeRaw.mock.calls)).toContain('Needs a clearer image');
    expect(JSON.stringify(db.$executeRaw.mock.calls)).toContain('publishing.post_rejected');
    await expect(reviewPost(actor, 'p1', 'approve', 'x'.repeat(501))).rejects.toThrow(/500 characters/);
  });
});
