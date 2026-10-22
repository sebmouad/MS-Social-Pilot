import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const st = vi.hoisted(() => ({ executions: [] as Q[], queries: [] as Q[], handlers: [] as Array<[string, (v: unknown[]) => unknown]>, execResult: new Map<string, number>(), cursorValues: {} as Record<string, string>, cursorPresent: {} as Record<string, boolean> }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), appSetting: { findUnique: vi.fn() } }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key === 'data.workspaceOperationTimeoutMs' ? 30000 : key === 'publishing.automation.recycleCursor' || key === 'publishing.automation.mixCursor' ? st.cursorValues[key] ?? '' : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb() }));

import { COLLAB_CONFIG } from '../src/modules/publishing/collaboration/config';
import { CALENDAR_EXTRAS_CONFIG } from '../src/modules/calendar-extras/config';
const DEFAULTS: Record<string, unknown> = Object.fromEntries([...COLLAB_CONFIG, ...CALENDAR_EXTRAS_CONFIG].map(i => [i.key, i.defaultValue]));
import { allocateQueueTime, nextAvailableSlot, runContentMix, runRecycleCycle, slotsForPages, variantForRun, wallToUtc, type AutomationLifecycle } from '../src/modules/publishing/collaboration/server/executors';
import { availableCollaborationTools } from '../src/modules/publishing/collaboration/mcp';
import { registerCollaborationPorts } from '../src/modules/publishing/collaboration/ports';

const when = (fragment: string, fn: (v: unknown[]) => unknown) => { st.handlers.unshift([fragment, fn]); };
const wrote = (f: string) => st.executions.filter(q => q.sql.includes(f));
const now = new Date('2026-03-02T10:00:00Z'); // Monday
const lifecycle = {
  recycle: vi.fn(async (_tx: Parameters<AutomationLifecycle['recycle']>[0], _input: Parameters<AutomationLifecycle['recycle']>[1]) => true),
  stop: vi.fn(async (_tx: Parameters<AutomationLifecycle['stop']>[0], _input: Parameters<AutomationLifecycle['stop']>[1]) => true),
  schedule: vi.fn(async (_tx: Parameters<AutomationLifecycle['schedule']>[0], _input: Parameters<AutomationLifecycle['schedule']>[1]) => true),
} satisfies AutomationLifecycle;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(st, { executions: [], queries: [], handlers: [], execResult: new Map(), cursorValues: {}, cursorPresent: {} });
  db.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => st.cursorPresent[where.key] ? { value: st.cursorValues[where.key], encrypted: false } : null);
  lifecycle.recycle.mockResolvedValue(true); lifecycle.stop.mockResolvedValue(true); lifecycle.schedule.mockResolvedValue(true);
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: s.join('?'), values }; st.queries.push(q);
    for (const [f, fn] of st.handlers) if (q.sql.includes(f)) return fn(values);
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: s.join('?'), values }; st.executions.push(q);
    for (const [f, n] of st.execResult) if (q.sql.includes(f)) return n;
    if (q.sql.includes('INSERT INTO app_settings')) { const key = String(values[0]); st.cursorValues[key] = JSON.parse(String(values[1])); st.cursorPresent[key] = true; }
    if (q.sql.includes('UPDATE app_settings SET')) { const key = String(values[1]); st.cursorValues[key] = JSON.parse(String(values[0])); st.cursorPresent[key] = true; }
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
  beforeEach(() => { when('FOR UPDATE SKIP LOCKED', () => [due]); when('FROM posts WHERE id >', () => [{ id: 'p1', workspaceId: 'w1' }]); when('FROM post_targets pt JOIN targets', () => [{ targetId: 't1' }, { targetId: 't2' }]); });
  it('claims by compare-and-set, creates one deterministic scheduled copy with destinations and audits', async () => {
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ checked: 1, created: 1, failed: 0 });
    const claim = wrote('UPDATE posts SET "recycleCount"')[0]!;
    expect(claim.values).toContain(1);
    expect(lifecycle.recycle).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'w1', sourcePostId: 'p1', copyId: 'rc_p1_1', message: 'Alt', scheduledAt: now, run: 1 });
    expect(wrote('INSERT INTO posts')).toHaveLength(0); expect(wrote('INSERT INTO post_targets')).toHaveLength(0);
    expect(wrote('activity_logs')[0]!.values).toContain('publishing.recycled');
  });
  it('creates nothing when another worker won the claim or the row is locked', async () => {
    st.execResult.set('UPDATE posts SET "recycleCount"', 0);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ created: 0, failed: 1 });
    expect(wrote('INSERT INTO posts')).toHaveLength(0);
    st.handlers = []; when('FROM posts WHERE id >', () => [{ id: 'p1', workspaceId: 'w1' }]);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ skipped: 1 });
  });
  it('does not duplicate targets on an id conflict, and finishes at the repeat limit', async () => {
    st.execResult.set('INSERT INTO posts', 0);
    await runRecycleCycle({ now, eligible: async () => true, lifecycle }); expect(wrote('INSERT INTO post_targets')).toHaveLength(0);
    st.handlers = []; st.executions = [];
    when('FROM posts WHERE id >', () => [{ id: 'p1', workspaceId: 'w1' }]); when('FOR UPDATE SKIP LOCKED', () => [{ ...due, recycleCount: 2 }]); when('FROM post_targets pt JOIN targets', () => [{ targetId: 't1' }]);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ created: 1, finished: 1 });
    expect(wrote('UPDATE posts SET "recycleCount"')[0]!.values).toContain(false);
  });
  it('stops a post with no active destination and honours workspace eligibility', async () => {
    st.handlers = []; when('FROM posts WHERE id >', () => [{ id: 'p1', workspaceId: 'w1' }]); when('FOR UPDATE SKIP LOCKED', () => [due]);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ finished: 1 });
    expect(wrote('"recycleEnabled" = FALSE')).toHaveLength(1); expect(wrote('INSERT INTO posts')).toHaveLength(0);
    st.executions = [];
    await expect(runRecycleCycle({ now, eligible: async () => false, lifecycle })).resolves.toMatchObject({ skipped: 1 });
    expect(wrote('UPDATE posts')).toHaveLength(0);
  });
  it('does not stop or audit a recycle source when lifecycle authorization declines', async () => {
    st.handlers = []; when('FROM posts WHERE "recycleEnabled"', () => [{ id: 'p1', workspaceId: 'w1' }]);
    when('FOR UPDATE SKIP LOCKED', () => [due]); // no active targets
    lifecycle.stop.mockResolvedValueOnce(false);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ skipped: 1 });
    expect(lifecycle.stop).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'w1', sourcePostId: 'p1', reason: 'no_active_destinations' });
    expect(wrote('"recycleEnabled" = FALSE')).toHaveLength(0); expect(wrote('publishing.recycle_stopped')).toHaveLength(0);
  });
  it.each([
    ['interval exceeds current Root limit', { ...due, recycleEveryDays: 366 }],
    ['repeat limit exceeds current Root limit', { ...due, recycleLimit: 1001 }],
    ['variant entry is malformed', { ...due, variants: ['valid', 12] }],
    ['variant count exceeds current Root limit', { ...due, variants: Array.from({ length: 11 }, (_, i) => `Alt ${i}`) }],
    ['variant length exceeds current Root limit', { ...due, variants: ['x'.repeat(5001)] }],
  ])('refuses recycle when %s without calling lifecycle or mutating the source', async (_label, invalid) => {
    when('FOR UPDATE SKIP LOCKED', () => [invalid]);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ failed: 1, created: 0 });
    expect(lifecycle.recycle).not.toHaveBeenCalled(); expect(lifecycle.stop).not.toHaveBeenCalled();
    expect(wrote('UPDATE posts')).toHaveLength(0); expect(wrote('publishing.recycled')).toHaveLength(0);
  });
  it('stops an exhausted recycle cadence without creating one more copy and preserves its count', async () => {
    when('FOR UPDATE SKIP LOCKED', () => [{ ...due, recycleLimit: 1, recycleCount: 1 }]);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ finished: 1, created: 0 });
    expect(lifecycle.recycle).not.toHaveBeenCalled();
    expect(lifecycle.stop).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'w1', sourcePostId: 'p1', reason: 'repeat_limit' });
    expect(wrote('"recycleEnabled" = FALSE')[0]!.values).toContain(1);
    expect(JSON.parse(String(wrote('activity_logs')[0]!.values[3]))).toMatchObject({ reason: 'repeat_limit' });
  });
  it('counts failures without stopping the batch', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('db'));
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ failed: 1 });
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
    await expect(runContentMix({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ scheduled: 2, dry: 0 });
    const updates = wrote('SET status = \'scheduled\'');
    expect(updates).toHaveLength(0);
    expect(lifecycle.schedule).toHaveBeenCalledTimes(2);
    expect(lifecycle.schedule.mock.calls.map(c => c[1])).toEqual([
      { workspaceId: 'w1', postId: 'd1', scheduledAt: expect.any(Date), timeZone: 'UTC' },
      { workspaceId: 'w1', postId: 'd2', scheduledAt: expect.any(Date), timeZone: 'UTC' },
    ]);
  });
  it('does not schedule when auto-fill is off, and tells once that a label ran dry', async () => {
    base(false, []);
    const notify = vi.fn(async () => {});
    await expect(runContentMix({ now, enqueueNotice: notify, eligible: async () => true, lifecycle })).resolves.toMatchObject({ scheduled: 0, dry: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ $executeRaw: expect.any(Function) }), expect.objectContaining({ workspaceId: 'w1', targetId: 't1', labelId: 'l1', eventId: expect.any(String) }));
    expect(wrote('SET status')).toHaveLength(0);
    st.execResult.set('"dryNotifiedAt" = ?', 0); notify.mockClear();
    await expect(runContentMix({ now, enqueueNotice: notify, eligible: async () => true, lifecycle })).resolves.toMatchObject({ dry: 0 }); expect(notify).not.toHaveBeenCalled();
  });
  it('skips drafts that need review and fails the transaction when durable intent cannot be recorded', async () => {
    base(true, [{ ...draft('d1'), approvalStatus: 'pending' }, { ...draft('d2'), allActive: false }]);
    const notify = vi.fn(async () => { throw new Error('mail'); });
    await expect(runContentMix({ now, enqueueNotice: notify, eligible: async () => true, lifecycle })).resolves.toMatchObject({ scheduled: 0, dry: 0, failed: 1 });
    expect(wrote('SET status')).toHaveLength(0);
  });
  it('leaves ineligible workspaces untouched', async () => {
    base(true, [draft('d1')]);
    await expect(runContentMix({ now, eligible: async () => false, lifecycle })).resolves.toMatchObject({ skipped: 1 });
    expect(wrote('UPDATE posts')).toHaveLength(0);
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
  it('validates and scopes an explicitly selected workspace before processing candidates', async () => {
    await expect(runRecycleCycle({ now, workspaceId: 'w1', eligible: async () => true, lifecycle })).resolves.toMatchObject({ checked: 0 });
    const recycleQuery = st.queries.find(q => q.sql.includes('FROM posts WHERE "workspaceId"'))!;
    expect(recycleQuery.sql).toContain('"workspaceId" = ?'); expect(recycleQuery.values).toContain('w1');
    st.queries = [];
    await expect(runContentMix({ now, workspaceId: 'w1', eligible: async () => true, lifecycle })).resolves.toMatchObject({ workspaces: 0 });
    const mixQuery = st.queries.find(q => q.sql.includes('FROM content_mix_rules WHERE "workspaceId"'))!;
    expect(mixQuery.sql).toContain('"workspaceId" = ?'); expect(mixQuery.values).toContain('w1');
    expect(db.appSetting.findUnique).not.toHaveBeenCalled(); expect(wrote('app_settings')).toHaveLength(0);
    st.queries = [];
    await expect(runContentMix({ now, workspaceId: '', eligible: async () => true, lifecycle })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(st.queries).toHaveLength(0);
  });
  it('rotates past a skipped first batch so later workspaces are reached', async () => {
    const all = Array.from({ length: 51 }, (_, i) => ({ workspaceId: `w${String(i + 1).padStart(3, '0')}` }));
    when('FROM content_mix_rules WHERE "workspaceId" >', values => all.filter(item => item.workspaceId > String(values[0])).slice(0, 50));
    when('SELECT DISTINCT "workspaceId" FROM content_mix_rules ORDER BY', () => all.slice(0, 50));
    const eligible = vi.fn(async () => false);
    await expect(runContentMix({ now, eligible, lifecycle })).resolves.toMatchObject({ workspaces: 50, skipped: 50 });
    expect(st.cursorValues['publishing.automation.mixCursor']).toBe('w050');
    await expect(runContentMix({ now, eligible, lifecycle })).resolves.toMatchObject({ workspaces: 1, skipped: 1 });
    expect(eligible).toHaveBeenCalledTimes(51);
    expect(st.cursorValues['publishing.automation.mixCursor']).toBe('w051');
  });
  it('rotates recycle posts past a skipped first batch', async () => {
    const all = Array.from({ length: 51 }, (_, i) => ({ id: `p${String(i + 1).padStart(3, '0')}`, workspaceId: 'w1' }));
    when('FROM posts WHERE id >', values => all.filter(item => item.id > String(values[0])).slice(0, 50));
    const eligible = vi.fn(async () => false);
    await expect(runRecycleCycle({ now, eligible, lifecycle })).resolves.toMatchObject({ checked: 50, skipped: 50 });
    expect(st.cursorValues['publishing.automation.recycleCursor']).toBe('p050');
    await expect(runRecycleCycle({ now, eligible, lifecycle })).resolves.toMatchObject({ checked: 1, skipped: 1 });
    expect(eligible).toHaveBeenCalledTimes(51);
    expect(st.cursorValues['publishing.automation.recycleCursor']).toBe('p051');
  });
  it('does not overwrite a Root cursor edit made after the scan cursor was read', async () => {
    st.cursorValues['publishing.automation.mixCursor'] = 'w010'; st.cursorPresent['publishing.automation.mixCursor'] = true;
    when('FROM content_mix_rules WHERE "workspaceId" >', () => [{ workspaceId: 'w020' }]);
    db.appSetting.findUnique.mockResolvedValueOnce({ value: 'root-edit', encrypted: false });
    await expect(runContentMix({ now, eligible: async () => false, lifecycle })).resolves.toMatchObject({ workspaces: 1, skipped: 1 });
    expect(wrote('UPDATE app_settings')).toHaveLength(0); expect(wrote('INSERT INTO root_activities')).toHaveLength(0);
    expect(st.cursorValues['publishing.automation.mixCursor']).toBe('w010');
  });
  it('rechecks each recycle item instead of caching an earlier workspace grant', async () => {
    when('FROM posts WHERE id >', () => [{ id: 'one', workspaceId: 'w1' }, { id: 'two', workspaceId: 'w1' }]);
    const eligible = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runRecycleCycle({ now, eligible, lifecycle })).resolves.toMatchObject({ checked: 2, skipped: 2 });
    expect(eligible).toHaveBeenCalledTimes(2);
    expect(wrote('INSERT INTO posts')).toHaveLength(0);
  });
  it('requires lifecycle callbacks before reading candidates', async () => {
    await expect(runRecycleCycle({ now, eligible: async () => true })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(runContentMix({ now, eligible: async () => true })).rejects.toMatchObject({ code: 'unavailable' });
    expect(db.$queryRaw).not.toHaveBeenCalled(); expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('does not claim a recycle run when lifecycle declines or throws', async () => {
    when('FROM posts WHERE id >', () => [{ id: 'p1', workspaceId: 'w1' }]);
    when('FOR UPDATE SKIP LOCKED', () => [due]);
    when('FROM post_targets pt JOIN targets', () => [{ targetId: 't1' }]);
    lifecycle.recycle.mockResolvedValueOnce(false);
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ skipped: 1, created: 0 });
    expect(wrote('UPDATE posts SET "recycleCount"')).toHaveLength(0);
    st.executions = []; lifecycle.recycle.mockRejectedValueOnce(new Error('lifecycle refused'));
    await expect(runRecycleCycle({ now, eligible: async () => true, lifecycle })).resolves.toMatchObject({ failed: 1 });
    expect(wrote('UPDATE posts SET "recycleCount"')).toHaveLength(0);
  });
  it('skips mix candidates when the lifecycle declines and rechecks eligibility per candidate', async () => {
    const draft = (id: string) => ({ id, authorId: 'u', approvalStatus: 'approved', targets: ['t1'], allActive: true, labels: ['l1'] });
    when('FROM content_mix_rules WHERE "workspaceId"', () => [{ id: 'r1', targetId: 't1', groupId: null, labelId: 'l1', perWeek: 2, dryNotifiedAt: null }]);
    when('SELECT DISTINCT "workspaceId"', () => [{ workspaceId: 'w1' }]);
    when('FROM workspaces', () => [{ timezone: 'UTC', mixAutoFill: true, requiresApproval: false }]);
    when('FROM targets', () => [{ id: 't1' }]);
    when('FROM queue_slots', () => [{ targetId: null, dayOfWeek: 1, hour: 15, minute: 0 }, { targetId: null, dayOfWeek: 3, hour: 9, minute: 0 }]);
    when("p.status::text = 'draft'", () => [draft('d1'), draft('d2')]);
    lifecycle.schedule.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const eligible = vi.fn().mockResolvedValue(true);
    await expect(runContentMix({ now, eligible, lifecycle })).resolves.toMatchObject({ scheduled: 1, skipped: 1 });
    expect(eligible).toHaveBeenCalledTimes(3); // workspace gate and each attempted schedule
  });
});
