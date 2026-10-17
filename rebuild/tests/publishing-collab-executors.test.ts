import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const st = vi.hoisted(() => ({ executions: [] as Q[], queries: [] as Q[], handlers: [] as Array<[string, (v: unknown[]) => unknown]>, execResult: new Map<string, number>() }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb() }));

import { COLLAB_CONFIG } from '../src/modules/publishing/collaboration/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(COLLAB_CONFIG.map(i => [i.key, i.defaultValue]));
import { allocateQueueTime, nextAvailableSlot, runContentMix, runRecycleCycle, slotsForPages, variantForRun, wallToUtc } from '../src/modules/publishing/collaboration/server/executors';
import { availableCollaborationTools } from '../src/modules/publishing/collaboration/mcp';
import { registerCollaborationPorts } from '../src/modules/publishing/collaboration/ports';

const when = (fragment: string, fn: (v: unknown[]) => unknown) => { st.handlers.unshift([fragment, fn]); };
const wrote = (f: string) => st.executions.filter(q => q.sql.includes(f));
const now = new Date('2026-03-02T10:00:00Z'); // Monday
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(st, { executions: [], queries: [], handlers: [], execResult: new Map() });
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: s.join('?'), values }; st.queries.push(q);
    for (const [f, fn] of st.handlers) if (q.sql.includes(f)) return fn(values);
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: s.join('?'), values }; st.executions.push(q);
    for (const [f, n] of st.execResult) if (q.sql.includes(f)) return n;
    return 1;
  });
});

describe('scheduling helpers', () => {
  it('rotates wordings and falls back to the original text', () => {
    expect([1, 2, 3].map(i => variantForRun('A', ['B', ' '], i))).toEqual(['B', 'A', 'B']);
    expect(variantForRun('A', [], 4)).toBe('A');
  });
  it('converts wall time to UTC across zones and rejects daylight-saving gaps', () => {
    expect(wallToUtc('America/New_York', 2026, 1, 5, 9, 0)?.toISOString()).toBe('2026-01-05T14:00:00.000Z');
    expect(wallToUtc('America/New_York', 2026, 3, 8, 2, 30)).toBeNull();
    expect(wallToUtc('Africa/Casablanca', 2026, 6, 1, 9, 0)).not.toBeNull();
  });
  it('uses shared times plus times every channel owns', () => {
    const rows = [{ targetId: null, dayOfWeek: 1, hour: 9, minute: 0 }, { targetId: 'a', dayOfWeek: 2, hour: 9, minute: 0 }, { targetId: 'b', dayOfWeek: 2, hour: 9, minute: 0 }, { targetId: 'a', dayOfWeek: 3, hour: 9, minute: 0 }];
    expect(slotsForPages(rows, ['a', 'b']).map(s => s.dayOfWeek)).toEqual([1, 2]);
    expect(slotsForPages(rows, ['a']).map(s => s.dayOfWeek)).toEqual([1, 2, 3]);
    expect(slotsForPages(rows, [])).toHaveLength(1);
  });
  it('picks the next free time after now inside the horizon, skipping taken minutes', () => {
    const slots = [{ dayOfWeek: 1, hour: 9, minute: 0 }, { dayOfWeek: 1, hour: 15, minute: 0 }];
    const at = (taken: Date[]) => nextAvailableSlot({ slots, timeZone: 'UTC', takenUtc: taken, now, horizonDays: 7 })?.toISOString();
    expect(at([])).toBe('2026-03-02T15:00:00.000Z');
    expect(at([new Date('2026-03-02T15:00:30Z')])).toBe('2026-03-09T09:00:00.000Z');
    expect(nextAvailableSlot({ slots, timeZone: 'UTC', takenUtc: [], now, horizonDays: 3 })?.toISOString()).toBe('2026-03-02T15:00:00.000Z');
    expect(nextAvailableSlot({ slots: [], timeZone: 'UTC', takenUtc: [], now, horizonDays: 3 })).toBeNull();
    expect(nextAvailableSlot({ slots: [{ dayOfWeek: 5, hour: 9, minute: 0 }], timeZone: 'UTC', takenUtc: [], now, horizonDays: 2 })).toBeNull();
  });
  it('allocates inside the caller transaction with workspace-scoped queries', async () => {
    when('FROM queue_slots', () => [{ targetId: null, dayOfWeek: 1, hour: 15, minute: 0 }]);
    const at = await allocateQueueTime(db as never, 'w1', 'UTC', ['t1'], now, 7);
    expect(at?.toISOString()).toBe('2026-03-02T15:00:00.000Z');
    expect(st.queries.every(q => q.values.includes('w1'))).toBe(true);
  });
});

const due = { id: 'p1', workspaceId: 'w1', message: 'Hello', firstComment: null, firstCommentDelayMinutes: 0, format: 'post', link: null, linkPreview: null, media: [], mediaKeys: [], publishMode: 'worker', timezone: 'UTC', authorId: 'u', recycleEveryDays: 7, recycleLimit: 3, recycleCount: 0, recycleNextAt: new Date('2026-03-02T09:00:00Z'), variants: ['Alt'] };
describe('recycle executor', () => {
  beforeEach(() => { when('FOR UPDATE SKIP LOCKED', () => [due]); when('FROM posts WHERE "recycleEnabled"', () => [{ id: 'p1', workspaceId: 'w1' }]); when('FROM post_targets pt JOIN targets', () => [{ targetId: 't1' }, { targetId: 't2' }]); });
  it('claims by compare-and-set, creates one deterministic scheduled copy with destinations and audits', async () => {
    await expect(runRecycleCycle({ now, eligible: async () => true })).resolves.toMatchObject({ checked: 1, created: 1, failed: 0 });
    const claim = wrote('UPDATE posts SET "recycleCount"')[0]!;
    expect(claim.values).toContain(1);
    const insert = wrote('INSERT INTO posts')[0]!;
    expect(insert.values).toContain('rc_p1_1'); expect(insert.values).toContain('Alt');
    expect(wrote('INSERT INTO post_targets')).toHaveLength(2);
    expect(wrote('activity_logs')[0]!.values).toContain('publishing.recycled');
  });
  it('creates nothing when another worker won the claim or the row is locked', async () => {
    st.execResult.set('UPDATE posts SET "recycleCount"', 0);
    await expect(runRecycleCycle({ now, eligible: async () => true })).resolves.toMatchObject({ created: 0, skipped: 1 });
    expect(wrote('INSERT INTO posts')).toHaveLength(0);
    st.handlers = []; when('FROM posts WHERE "recycleEnabled"', () => [{ id: 'p1', workspaceId: 'w1' }]);
    await expect(runRecycleCycle({ now, eligible: async () => true })).resolves.toMatchObject({ skipped: 1 });
  });
  it('does not duplicate targets on an id conflict, and finishes at the repeat limit', async () => {
    st.execResult.set('INSERT INTO posts', 0);
    await runRecycleCycle({ now, eligible: async () => true }); expect(wrote('INSERT INTO post_targets')).toHaveLength(0);
    st.handlers = []; st.executions = [];
    when('FROM posts WHERE "recycleEnabled"', () => [{ id: 'p1', workspaceId: 'w1' }]); when('FOR UPDATE SKIP LOCKED', () => [{ ...due, recycleCount: 2 }]); when('FROM post_targets pt JOIN targets', () => [{ targetId: 't1' }]);
    await expect(runRecycleCycle({ now, eligible: async () => true })).resolves.toMatchObject({ created: 0, finished: 1 });
    expect(wrote('UPDATE posts SET "recycleCount"')[0]!.values).toContain(false);
  });
  it('stops a post with no active destination and honours workspace eligibility', async () => {
    st.handlers = []; when('FROM posts WHERE "recycleEnabled"', () => [{ id: 'p1', workspaceId: 'w1' }]); when('FOR UPDATE SKIP LOCKED', () => [due]);
    await expect(runRecycleCycle({ now, eligible: async () => true })).resolves.toMatchObject({ finished: 1 });
    expect(wrote('"recycleEnabled" = FALSE')).toHaveLength(1); expect(wrote('INSERT INTO posts')).toHaveLength(0);
    st.executions = [];
    await expect(runRecycleCycle({ now, eligible: async () => false })).resolves.toMatchObject({ skipped: 1 });
    expect(st.executions).toHaveLength(0);
  });
  it('counts failures without stopping the batch', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('db'));
    await expect(runRecycleCycle({ now, eligible: async () => true })).resolves.toMatchObject({ failed: 1 });
  });
});

describe('content mix executor', () => {
  const rule = { id: 'r1', targetId: 't1', groupId: null, labelId: 'l1', perWeek: 2, dryNotifiedAt: null };
  const draft = (id: string) => ({ id, authorId: 'u', approvalStatus: 'approved', targets: ['t1'], allActive: true, labels: ['l1'] });
  const base = (autoFill: boolean, drafts: unknown[]) => {
    when('FROM content_mix_rules WHERE "workspaceId"', () => [rule]); when('SELECT DISTINCT "workspaceId"', () => [{ workspaceId: 'w1' }]);
    when('FROM workspaces', () => [{ timezone: 'UTC', mixAutoFill: autoFill, requiresApproval: false }]); when('FROM targets', () => [{ id: 't1' }]);
    when('FROM queue_slots', () => [{ targetId: null, dayOfWeek: 1, hour: 15, minute: 0 }, { targetId: null, dayOfWeek: 3, hour: 9, minute: 0 }]);
    when("p.status::text = 'draft'", () => drafts);
  };
  it('schedules ready drafts into distinct free times, atomically per draft, and audits', async () => {
    base(true, [draft('d1'), draft('d2')]);
    await expect(runContentMix({ now, eligible: async () => true })).resolves.toMatchObject({ scheduled: 2, dry: 0 });
    const updates = wrote('SET status = \'scheduled\'');
    expect(updates).toHaveLength(2); expect(updates[0]!.values[0]).not.toEqual(updates[1]!.values[0]);
    expect(updates.every(u => u.sql.includes("status::text = 'draft'") && u.values.includes('w1'))).toBe(true);
    expect(wrote('activity_logs').filter(q => q.values.includes('publishing.mix_scheduled'))).toHaveLength(2);
  });
  it('does not schedule when auto-fill is off, and tells once that a label ran dry', async () => {
    base(false, []);
    const notify = vi.fn(async () => {});
    await expect(runContentMix({ now, notify, eligible: async () => true })).resolves.toMatchObject({ scheduled: 0, dry: 1 });
    expect(notify).toHaveBeenCalledWith({ workspaceId: 'w1', targetId: 't1', labelId: 'l1' });
    expect(wrote('SET status')).toHaveLength(0);
    st.execResult.set('"dryNotifiedAt" = ?', 0); notify.mockClear();
    await expect(runContentMix({ now, notify, eligible: async () => true })).resolves.toMatchObject({ dry: 0 }); expect(notify).not.toHaveBeenCalled();
  });
  it('skips drafts that need review and survives a failing notifier', async () => {
    base(true, [{ ...draft('d1'), approvalStatus: 'pending' }, { ...draft('d2'), allActive: false }]);
    const notify = vi.fn(async () => { throw new Error('mail'); });
    await expect(runContentMix({ now, notify, eligible: async () => true })).resolves.toMatchObject({ scheduled: 0, dry: 1, failed: 0 });
    expect(wrote('SET status')).toHaveLength(0);
  });
  it('leaves ineligible workspaces untouched', async () => {
    base(true, [draft('d1')]);
    await expect(runContentMix({ now, eligible: async () => false })).resolves.toMatchObject({ skipped: 1 });
    expect(st.executions).toHaveLength(0);
  });
});

describe('capability detection', () => {
  it('advertises queue, mix and recycle tools only when the host registered them', () => {
    const names = () => availableCollaborationTools().map(t => t.name);
    registerCollaborationPorts({});
    for (const n of ['list_queue_times', 'replace_queue_times', 'get_content_mix', 'save_content_mix', 'get_post_recycle', 'set_post_recycle', 'restore_post_version']) expect(names()).not.toContain(n);
    registerCollaborationPorts({ queue: { available: true }, mix: { available: true } });
    expect(names()).toContain('replace_queue_times'); expect(names()).toContain('save_content_mix'); expect(names()).not.toContain('set_post_recycle');
  });
});

describe('required worker authorization', () => {
  it('refuses recycling without an owner eligibility port before reads or writes', async () => {
    await expect(runRecycleCycle({ now })).rejects.toMatchObject({ code: 'unavailable' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('refuses content mix without an owner eligibility port before reads or writes', async () => {
    await expect(runContentMix({ now })).rejects.toMatchObject({ code: 'unavailable' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rechecks each recycle item instead of caching an earlier workspace grant', async () => {
    when('FROM posts WHERE "recycleEnabled"', () => [{ id: 'one', workspaceId: 'w1' }, { id: 'two', workspaceId: 'w1' }]);
    const eligible = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runRecycleCycle({ now, eligible })).resolves.toMatchObject({ checked: 2, skipped: 2 });
    expect(eligible).toHaveBeenCalledTimes(2);
    expect(wrote('INSERT INTO posts')).toHaveLength(0);
  });
});
