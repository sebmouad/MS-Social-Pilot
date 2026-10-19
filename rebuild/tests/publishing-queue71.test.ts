import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  policy: [{ timezone: 'America/Casablanca', requiresApproval: false }] as Array<{ timezone: string; requiresApproval: boolean }>,
  post: null as null | Record<string, unknown>, current: null as null | Record<string, unknown>,
  at: new Date('2026-10-20T08:00:00.000Z') as Date | null,
  writes: [] as Array<{ sql: string; values: unknown[] }>,
  txQueries: [] as Array<{ sql: string; values: unknown[] }>,
  rollbacks: 0,
  role: 'editor',
  lockTargets: vi.fn(),
  lockActor: vi.fn(),
  timezoneRows: 1,
  approvalRows: 1,
  authorize: vi.fn(),
  allocate: vi.fn(),
  record: vi.fn(),
  audit: vi.fn(),
  validateTargets: vi.fn(),
  limits: vi.fn(),
}));
const db = vi.hoisted(() => ({ post: { findFirst: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn() }));

vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: h.authorize }));
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingOperation: async (actor: { allowedTargetIds?: readonly string[] }, _options: unknown, work: (ctx: unknown) => Promise<unknown>) => work({ actor, role: h.role, signal: new AbortController().signal, lockTargets: async (ids: string[]) => { h.lockTargets(ids); if (actor.allowedTargetIds && ids.some(id => !actor.allowedTargetIds!.includes(id))) throw new Error('destination out of scope'); } }),
  withPublishingTransaction: async (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => {
    try { return await work(db); } catch (error) { h.rollbacks++; throw error; }
  },
}));
vi.mock('@/modules/publishing/collaboration/server/core', () => ({
  bounds: async () => ({ queueLookaheadDays: 21 }), audit: h.audit,
  lockActor: async (_tx: unknown, _actor: unknown, _feature: string, _write: boolean) => { h.lockActor(); return { role: h.role }; },
  parse: (schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } }, input: unknown) => { const result = schema.safeParse(input); if (!result.success) throw new Error('Check the details.'); return result.data; },
  exact: (actual: string, expected: string) => { if (actual !== expected) throw new Error('Type the exact confirmation shown to continue.'); },
}));
vi.mock('@/modules/publishing/collaboration/server/versions', () => ({ loadVersionRetention: async () => 25, recordPostVersion: h.record }));
vi.mock('@/modules/publishing/collaboration/server/executors', () => ({ allocateQueueTime: h.allocate }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({
  limits: h.limits, resolvePublishMedia: vi.fn(async (_workspaceId: string, media: unknown[]) => media),
  validatePostAttachments: vi.fn((value: unknown) => ({ link: null, media: [] })),
  validatePostContent: vi.fn((value: string) => value.trim()), validFirstComment: vi.fn((value: string) => value.trim() || null),
  validateTargets: h.validateTargets,
}));
vi.mock('@/lib/calendar-dates', () => ({ isValidTimeZone: (value: string) => value === 'America/Casablanca' }));

import { queuePost, queuePostConfirmation, queuePostRequest } from '@/modules/publishing/server/queue';

const actor = { userId: 'u1', workspaceId: 'w1' };
const post = () => ({ id: 'p1', authorId: 'u1', status: 'draft', publishedAt: null, message: 'A valid post', firstComment: null, link: null, media: [], targets: [{ id: 'pt1', targetId: 't1', status: 'pending', remotePostId: null }] });

beforeEach(() => {
  vi.clearAllMocks();
  h.policy = [{ timezone: 'America/Casablanca', requiresApproval: false }]; h.post = post(); h.current = post();
  h.at = new Date('2026-10-20T08:00:00.000Z'); h.writes = []; h.txQueries = []; h.rollbacks = 0; h.role = 'editor'; h.timezoneRows = 1; h.approvalRows = 1;
  db.post.findFirst.mockImplementation(async () => h.post);
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?'); h.txQueries.push({ sql, values });
    if (sql.includes('SELECT timezone')) return h.policy;
    if (sql.includes('SELECT id, "authorId"')) return h.current ? [h.current] : [];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { const sql = strings.join('?'); h.writes.push({ sql, values }); return sql.includes('UPDATE posts SET timezone') ? h.timezoneRows : sql.includes('"approvalStatus" =') ? h.approvalRows : 1; });
  h.authorize.mockImplementation(async () => ({ role: h.role })); h.lockTargets.mockResolvedValue(undefined); h.allocate.mockImplementation(async () => h.at);
  h.record.mockResolvedValue(true); h.audit.mockResolvedValue(undefined); h.validateTargets.mockResolvedValue([]);
  h.limits.mockResolvedValue({ maxText: 5000, maxMedia: 10, maxAlt: 500, maxTargets: 10 });
});

describe('queuePost', () => {
  it('requires a strict request and exact post-bound confirmation', async () => {
    expect(queuePostConfirmation('p1')).toBe('QUEUE POST p1');
    await expect(queuePostRequest(actor, { postId: 'p1', confirmation: 'QUEUE POST p2' })).rejects.toThrow(/exact confirmation/);
    await expect(queuePostRequest(actor, { postId: 'p1', confirmation: 'QUEUE POST p1', extra: true })).rejects.toThrow(/details/);
    expect(h.authorize).not.toHaveBeenCalled();
  });

  it('allocates under the shared workspace lock, writes approval state, snapshots both sides and audits', async () => {
    const result = await queuePost(actor, 'p1');
    expect(result).toEqual({ postId: 'p1', scheduledAt: h.at, status: 'scheduled' });
    expect(h.authorize).toHaveBeenCalledWith(actor, 'publishing/posts', 'write');
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.lockActor).toHaveBeenCalledTimes(1);
    expect(h.lockTargets).toHaveBeenCalledWith(['t1']);
    const advisoryIndex = h.txQueries.findIndex(q => q.sql.includes('pg_advisory_xact_lock(hashtext'));
    expect(advisoryIndex).toBeGreaterThanOrEqual(0);
    expect(h.txQueries.some(q => q.sql.includes('SELECT timezone') && q.sql.includes('FOR SHARE'))).toBe(true);
    expect(h.txQueries.some(q => q.sql.includes('SELECT timezone') && q.sql.includes('FOR UPDATE'))).toBe(false);
    expect(h.allocate).toHaveBeenCalledWith(db, 'w1', 'America/Casablanca', ['t1'], expect.any(Date), 21);
    expect(db.post.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', workspaceId: 'w1', status: 'draft' }, data: expect.objectContaining({ status: 'scheduled', scheduledAt: h.at }) }));
    expect(h.writes.some(w => w.sql.includes('UPDATE posts SET timezone'))).toBe(true);
    expect(h.record).toHaveBeenCalledTimes(2);
    expect(h.audit).toHaveBeenCalledWith(db, actor, 'publishing.post_queued', expect.objectContaining({ postId: 'p1', status: 'scheduled' }));
  });

  it('submits contributor queue requests for approval and clears prior review fields', async () => {
    h.role = 'contributor'; h.policy = [{ timezone: 'America/Casablanca', requiresApproval: true }];
    const result = await queuePost(actor, 'p1');
    expect(result.status).toBe('pending_approval');
    expect(db.post.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending_approval', scheduledAt: h.at }) }));
    expect(h.writes.some(w => w.sql.includes('"approvalStatus" = \'pending\'') && w.sql.includes('"reviewedById" = NULL'))).toBe(true);
    expect(h.audit).toHaveBeenCalledWith(db, actor, 'publishing.post_queued', expect.objectContaining({ status: 'pending_approval' }));
  });

  it('does not mutate or snapshot when no compatible queue slot is available', async () => {
    h.at = null;
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/No queue time is available/);
    expect(db.post.updateMany).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
    expect(h.rollbacks).toBe(1);
  });

  it('rejects corrupt stored media and requires both metadata updates to affect one row', async () => {
    h.post = { ...post(), media: null };
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/attachments need review/);
    expect(h.lockActor).not.toHaveBeenCalled(); expect(db.post.updateMany).not.toHaveBeenCalled();
    h.post = post(); h.current = post(); h.timezoneRows = 0;
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/changed while it was being queued/);
    expect(h.audit).not.toHaveBeenCalled(); expect(h.rollbacks).toBe(1);
    h.timezoneRows = 1; h.role = 'contributor'; h.policy = [{ timezone: 'America/Casablanca', requiresApproval: true }]; h.approvalRows = 0;
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/changed while it was being queued/);
    expect(h.audit).not.toHaveBeenCalled(); expect(h.rollbacks).toBe(2);
  });

  it('rejects noneditable, external, unauthorized and out-of-scope posts before writes', async () => {
    h.post = { ...post(), status: 'published' };
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/cannot be queued/);
    h.post = { ...post(), targets: [{ ...post().targets[0], remotePostId: 'remote' }] };
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/cannot be queued/);
    h.role = 'contributor'; h.post = { ...post(), authorId: 'u2' };
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/unavailable/);
    h.role = 'editor'; h.post = post(); h.post.targets = [{ ...post().targets[0], targetId: 't2' }];
    await expect(queuePost({ ...actor, allowedTargetIds: ['t1'] }, 'p1')).rejects.toThrow();
    expect(db.post.updateMany).not.toHaveBeenCalled(); expect(h.record).not.toHaveBeenCalled();
  });

  it('rolls back status, snapshots, and audit when a race or history failure occurs', async () => {
    db.post.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(queuePost(actor, 'p1')).rejects.toThrow(/changed while it was being queued/);
    expect(h.audit).not.toHaveBeenCalled(); expect(h.rollbacks).toBe(1);
    vi.clearAllMocks(); h.post = post(); h.current = post(); h.at = new Date('2026-10-20T08:00:00.000Z');
    db.post.findFirst.mockImplementation(async () => h.post); db.post.updateMany.mockResolvedValue({ count: 1 });
    h.rollbacks = 0; h.authorize.mockImplementation(async () => ({ role: h.role })); h.lockTargets.mockResolvedValue(undefined); h.allocate.mockImplementation(async () => h.at); h.limits.mockResolvedValue({ maxText: 5000, maxMedia: 10, maxAlt: 500, maxTargets: 10 }); h.validateTargets.mockResolvedValue([]); h.record.mockRejectedValue(new Error('history unavailable'));
    await expect(queuePost(actor, 'p1')).rejects.toThrow('history unavailable');
    expect(h.audit).not.toHaveBeenCalled(); expect(h.rollbacks).toBe(1);
  });
});
