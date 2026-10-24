vi.mock('@/modules/analytics/reports/generation/copy-server', async () => ({ loadReportDocumentCopy: async () => ({ copy: (await import('@/modules/analytics/reports/generation/copy')).reportDocumentCopyDefaults.en, locale: 'en' }) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/data', async () => ({ prisma: (await import('./report82-engine-harness')).db }));
vi.mock('@/server/config/store', async () => { const h = await import('./report82-engine-harness'); return { runtimeConfig: async (key: string) => h.configValue(key) }; });
vi.mock('@/server/entitlements', async () => { const h = await import('./report82-engine-harness'); return { loadEntitlements: async (_u: string, w: string) => (h.state.entitled ? { workspaceId: w } : null), canUseFeature: () => h.state.entitled, entitledPlatformIds: () => h.state.providers }; });
vi.mock('@/server/permissions', async () => {
  const h = await import('./report82-engine-harness');
  return {
    canAccessFeature: (p: { deny?: string[] }) => h.state.canAccess && !(p?.deny ?? []).includes('analytics/reports'),
    resolvePermissions: () => ({ pageScope: h.state.freshScope ? { all: false, ids: h.state.freshScope } : { all: true, ids: [] }, deny: h.state.freshDeny }),
  };
});
vi.mock('@/server/permissions/loader', async () => { const h = await import('./report82-engine-harness'); return { loadPermissions: async () => h.permissionsFor() }; });
vi.mock('@/server/platforms/resource-visibility', async () => { const h = await import('./report82-engine-harness'); return { selectedResourceConnectionWhere: async () => ({ provider: { in: h.state.providers } }) }; });
vi.mock('@/server/data-control/guard', async () => { const h = await import('./report82-engine-harness'); return { assertWorkspaceNotPurging: async () => { if (h.state.purge) throw Object.assign(new Error('purging'), { code: 'conflict' }); } }; });
vi.mock('../src/modules/analytics/server/read', async () => { const h = await import('./report82-engine-harness'); return { readAnalyticsSnapshot: h.readSnapshot }; });

import { execs, gen, metric, reset, resetGen, snapshot, state } from './report82-engine-harness';
import { registerReportGeneration, unregisterReportGeneration, resetReportCapabilityCache, reportCapabilities } from '../src/modules/analytics/reports/generation/registry';
import { createReportGenerator, cutBytes, renderReport } from '../src/modules/analytics/reports/generation/document';
import { listReportRuns, runDueReportSchedules, runReportNow } from '../src/modules/analytics/reports/generation/runs';
import { manageReportSchedule } from '../src/modules/analytics/reports/server/schedules';
import { reportConfirmation, type ReportActor } from '../src/modules/analytics/reports/contracts';
import { withUnsupported } from './unsupported-section';
import { analyticsReportAvailableToolDefinitions, analyticsReportWriteTools, executeAnalyticsReportTool } from '../src/modules/analytics/reports/mcp';

const actor: ReportActor = { userId: 'u1', workspaceId: 'w1' };
const bounds = { maxRows: 100, maxBytes: 20000 };
const mailSent: Array<{ to: string; key: string }> = [];
const goodMail = () => ({ send: vi.fn(async (i: { to: string; idempotencyKey: string }) => { mailSent.push({ to: i.to, key: i.idempotencyKey }); return { status: 'sent' as const }; }) });
const generator = () => createReportGenerator({ bounds: async () => bounds, now: () => new Date('2026-10-19T08:01:00Z') });

beforeEach(() => {
  vi.clearAllMocks(); reset(); resetGen(); resetReportCapabilityCache(); mailSent.length = 0;
  registerReportGeneration({ generation: generator(), mail: goodMail(), eligible: async () => true });
});

describe('report rendering', () => {
  it('keeps channel metrics only, marks missing as not available, escapes HTML and spreadsheet formulas', async () => {
    const out = await withUnsupported('destinations', () => renderReport(snapshot() as never, { channelName: 'Page One', sections: ['analysis', 'audience', 'published', 'destinations'], generatedAt: new Date('2026-10-19T08:00:00Z') }, bounds));
    expect(out.csv).not.toContain('Spend');
    expect(out.csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out.html).toContain('&lt;b&gt;Empty&lt;/b&gt;');
    expect(out.html).toContain('Not available');
    expect(out.html).toContain('not unique people');
    expect(out.notIncluded).toEqual(['destinations']);
    expect(out.html).toContain('Not included: destinations');
    expect(out.truncated).toBe(false);
    expect(out.bytes).toBe(Buffer.byteLength(out.csv, 'utf8'));
  });
  it('turns every line separator, including U+2028 and U+2029, into a space in names', () => {
    const out = renderReport(snapshot() as never, { channelName: 'A B C\r\nD', sections: ['analysis'], generatedAt: new Date() }, bounds);
    expect(out.channelName).toBe('A B C D');
  });
  it('cuts to the row and byte limits and says so', () => {
    const many = snapshot({ allMetrics: [metric({ points: Array.from({ length: 50 }, (_, i) => ({ date: `2026-10-${i}`, label: 'x', value: i })) })] });
    const rows = renderReport(many as never, { channelName: 'P', sections: ['analysis'], generatedAt: new Date() }, bounds);
    expect(rows.rowCount).toBeLessThanOrEqual(100);
    const tiny = renderReport(many as never, { channelName: 'P', sections: ['analysis'], generatedAt: new Date() }, { maxRows: 100, maxBytes: 600 });
    expect(tiny.truncated).toBe(true); expect(tiny.bytes).toBeLessThanOrEqual(600); expect(tiny.csv).toContain('"truncated","true"');
    expect(Buffer.byteLength(tiny.html)).toBeLessThanOrEqual(1500);
  });
  it('never cuts inside a multi-byte character', () => {
    const cut = cutBytes('aé€😀', 5);
    expect(Buffer.byteLength(cut, 'utf8')).toBeLessThanOrEqual(5);
    expect(cut).not.toContain('�');
  });
});

describe('report generator', () => {
  it('reads one channel through the scoped reader and maps access loss without leaking detail', async () => {
    const gn = generator();
    const request = { actor, channelId: 'c1', sections: ['analysis' as const], period: { start: '2026-10-12', end: '2026-10-18' } };
    expect((await gn.generate(request)).ok).toBe(true);
    expect(gen.input).toMatchObject({ filter: '1', channel: 'c1', adFilter: '1', compare: 'none', start: '2026-10-12', end: '2026-10-18' });
    expect(gen.constraints).toEqual({ feature: 'analytics/reports', allowedChannelIds: ['c1'] });
    gen.error = Object.assign(new Error('secret detail'), { code: 'forbidden' });
    expect(await gn.generate(request)).toEqual({ ok: false, reason: 'access_unavailable' });
    gen.error = new Error('db password leaked');
    expect(await gn.generate(request)).toEqual({ ok: false, reason: 'generation_failed' });
    gen.error = null; gen.snapshot = snapshot({ selected: { channelIds: [], adAccountIds: [] } });
    expect(await gn.generate(request)).toEqual({ ok: false, reason: 'channel_unavailable' });
  });
  it('refuses a channel outside the actor scope or no longer connected, before reading data', async () => {
    const gn = generator();
    const request = { actor, channelId: 'c1', sections: ['analysis' as const], period: { start: '2026-10-12', end: '2026-10-18' } };
    state.scope = ['c9'];
    expect(await gn.generate(request)).toEqual({ ok: false, reason: 'channel_unavailable' });
    state.scope = null; state.usable = false;
    expect(await gn.generate(request)).toEqual({ ok: false, reason: 'channel_unavailable' });
    expect(gen.calls).toBe(0);
  });
  it('refuses a report that lists only unsupported sections', async () => {
    expect(await withUnsupported('destinations', () => generator().generate({ actor, channelId: 'c1', sections: ['destinations'], period: { start: '2026-10-12', end: '2026-10-18' } }))).toEqual({ ok: false, reason: 'no_supported_sections' });
  });
  it("bounds the generated rows themselves by the actor's result ceiling", async () => {
    const result = await generator().generate({ actor: { ...actor, maxResultItems: 3 }, channelId: 'c1', sections: ['analysis', 'audience', 'published'], period: { start: '2026-10-12', end: '2026-10-18' } });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.output.rowCount).toBe(3); expect(result.output.truncated).toBe(true); expect(result.output.csv).toContain('"truncated","true"'); }
    expect(await generator().generate({ actor: { ...actor, maxResultItems: 0 }, channelId: 'c1', sections: ['analysis'], period: { start: '2026-10-12', end: '2026-10-18' } })).toEqual({ ok: false, reason: 'access_unavailable' });
  });
});

describe('capability detection', () => {
  it('offers nothing without a registered port or run-history table, and schedules only with delivery and an eligibility gate', async () => {
    unregisterReportGeneration();
    expect(await reportCapabilities()).toEqual({ generate: false, schedules: false });
    const gn = { generate: async () => ({ ok: false as const, reason: 'x' }) };
    registerReportGeneration({ generation: gn });
    expect(await reportCapabilities()).toEqual({ generate: true, schedules: false });
    registerReportGeneration({ generation: gn, mail: { send: async () => ({ status: 'sent' }) } });
    expect(await reportCapabilities()).toEqual({ generate: true, schedules: false });
    registerReportGeneration({ generation: gn, mail: { send: async () => ({ status: 'sent' }) }, eligible: async () => true });
    expect(await reportCapabilities()).toEqual({ generate: true, schedules: true });
    registerReportGeneration({ generation: gn, mail: { send: async () => ({ status: 'sent' }), ready: async () => false }, eligible: async () => true });
    expect(await reportCapabilities()).toEqual({ generate: true, schedules: false });
    resetReportCapabilityCache(); state.tablePresent = false;
    expect(await reportCapabilities()).toEqual({ generate: false, schedules: false });
  });
  it('refuses new schedules and hides generation tools while unavailable, but still allows deleting old ones', async () => {
    unregisterReportGeneration();
    await expect(manageReportSchedule(actor, { action: 'create', channelId: 'c1', frequency: 'weekly', recipients: ['a@example.com'], templateId: null, confirmation: reportConfirmation.createSchedule('c1', 'weekly') })).rejects.toMatchObject({ code: 'unavailable' });
    expect((await analyticsReportAvailableToolDefinitions()).map(t => t.name)).toEqual(['list_report_templates', 'manage_report_template', 'list_report_schedules', 'manage_report_schedule']);
    await expect(executeAnalyticsReportTool(actor, 'list_report_runs', {})).rejects.toMatchObject({ code: 'invalid_request' });
    await manageReportSchedule(actor, { action: 'delete', id: 's1', confirmation: reportConfirmation.deleteSchedule('s1') });
    registerReportGeneration({ generation: { generate: async () => ({ ok: false, reason: 'x' }) } });
    expect((await analyticsReportAvailableToolDefinitions()).map(t => t.name)).toContain('generate_report');
    expect(analyticsReportWriteTools.has('generate_report')).toBe(true);
  });
});

describe('due schedule runs', () => {
  const now = new Date('2026-10-19T08:01:00Z');
  const due = (over: Record<string, unknown> = {}) => ({ id: 's1', workspaceId: 'w1', targetId: 'c1', templateId: 't1', frequency: 'weekly', nextRunAt: new Date('2026-10-19T08:00:00Z'), recipients: ['a@example.com', 'b@example.com'], createdById: 'u1', timezone: 'UTC', weekStartsOn: 1, sections: ['analysis'], ...over });
  /** The terminal write is the fenced update flagged finished. */
  const finalStatus = () => execs('"finishedAt" = CASE').filter(e => e.values.includes(true)).at(-1)!.values[0];

  it('does nothing and claims nothing when delivery is not registered', async () => {
    registerReportGeneration({ generation: { generate: async () => ({ ok: false, reason: 'x' }) } });
    state.due = [due()];
    expect(await runDueReportSchedules({ now })).toMatchObject({ disabled: true, examined: 0 });
    expect(state.queries.some(x => x.sql.includes('SKIP LOCKED') && x.sql.includes('report_schedules'))).toBe(false);
  });
  it('claims a period once, generates, delivers per recipient and records completion', async () => {
    registerReportGeneration({ generation: generator(), mail: goodMail(), eligible: async () => true });
    state.due = [due()];
    const s = await runDueReportSchedules({ now });
    expect(s).toMatchObject({ disabled: false, examined: 1, completed: 1 });
    const insert = state.queries.find(x => x.sql.includes('INSERT INTO report_runs'))!;
    expect(insert.values).toContain('sched:s1:2026-10-12:2026-10-18');
    expect(insert.sql).toContain('ON CONFLICT ("idempotencyKey") DO NOTHING');
    expect(insert.sql).toContain('"claimToken"');
    const persisted = execs('deliveries = COALESCE').map(e => String(e.values.find(v => typeof v === 'string' && v.startsWith('['))));
    // Each recipient is persisted as attempting before the send.
    expect(persisted.some(p => p.includes('"attempting"'))).toBe(true);
    expect(persisted.at(-1)).not.toContain('a@example.com');
    expect(finalStatus()).toBe('completed');
    expect(execs('"lastError"').at(-1)!.values).toContain(null);
    expect(execs('activity_logs').map(e => JSON.stringify(e.values)).join(' ')).not.toContain('example.com');
    expect(state.maxDepth).toBe(1);
  });
  it('claims the next due schedule with a fresh lease after an earlier report runs past its lease', async () => {
    let current = now.getTime();
    const clock = () => new Date(current);
    const generation = {
      generate: vi.fn(async ({ actor }: { actor: { workspaceId: string } }) => {
        if (generation.generate.mock.calls.length === 1) current += 601_000;
        return { ok: true as const, output: { channelName: actor.workspaceId === 'w1' ? 'Page' : 'Next page', period: { start: '2026-10-12', end: '2026-10-18' }, generatedAt: new Date(current).toISOString(), sections: ['analysis' as const], notIncluded: [], csv: 'report', html: '<p>report</p>', text: 'report', rowCount: 1, bytes: 6, htmlBytes: 13, textBytes: 6, truncated: false } };
      }),
    };
    state.due = [due({ recipients: ['a@example.com'] }), due({ id: 's2', workspaceId: 'w2', recipients: ['a@example.com'] })];
    registerReportGeneration({ generation, mail: goodMail(), eligible: async () => true });

    const result = await runDueReportSchedules({ now, clock });

    expect(result).toMatchObject({ examined: 2, interrupted: 1, completed: 1 });
    expect(generation.generate).toHaveBeenCalledTimes(2);
    expect(mailSent.map(item => item.to)).toEqual(['a@example.com']);
    const claimWrites = state.queries.filter(query => query.sql.includes('FROM report_schedules s JOIN workspaces w') && query.sql.includes('SKIP LOCKED'));
    expect(claimWrites).toHaveLength(3); // two claims, then the bounded scan observes no more due row
    expect(claimWrites.every(query => query.sql.includes('LIMIT 1'))).toBe(true);
    const nextInsert = state.queries.find(query => query.sql.includes('INSERT INTO report_runs') && query.values[4] === 'sched:s2:2026-10-12:2026-10-18')!;
    expect(nextInsert.values.some(value => value instanceof Date && value.getTime() === current + 600_000)).toBe(true);
  });
  it('continues past invalid time zones and duplicate periods within the bounded due attempts', async () => {
    state.due = [due({ timezone: 'Invalid/Zone' }), due({ id: 'duplicate', workspaceId: 'w2' }), due({ id: 'following', workspaceId: 'w3', recipients: ['a@example.com'] })];
    state.insertConflicts = ['sched:duplicate:2026-10-12:2026-10-18'];
    state.config['analytics.reports.dueBatchSize'] = 3;

    const result = await runDueReportSchedules({ now });

    expect(result).toMatchObject({ skipped: 1, examined: 1, completed: 1 });
    expect(mailSent.map(item => item.to)).toEqual(['a@example.com']);
    expect(state.queries.filter(query => query.sql.includes('FROM report_schedules s JOIN workspaces w') && query.sql.includes('SKIP LOCKED'))).toHaveLength(3);
  });
  it('renews scheduled claim leases from the worker clock when supplied', async () => {
    state.due = [due({ recipients: ['a@example.com'] })];
    let ticks = 0;
    const clock = () => new Date(now.getTime() + ticks++ * 1000);
    await runDueReportSchedules({ now, clock });
    const writes = execs('UPDATE report_runs SET status');
    expect(writes.some(write => write.values[5] instanceof Date && write.values[5].getTime() > now.getTime() + 600_000)).toBe(true);
  });
  it('excludes purging workspaces from stale-run maintenance', async () => {
    state.stale = [{ id: 'r-purging', workspaceId: 'w-purging', scheduleId: 's-purging', kind: 'scheduled', status: 'delivering', deliveries: [] }];
    state.purge = 'requested';
    await runDueReportSchedules({ now });
    const staleSelect = state.queries.find(q => q.sql.includes('FROM report_runs r WHERE') && q.sql.includes("status IN ('claimed','generating','delivering')"))!;
    expect(staleSelect.sql).toContain('NOT EXISTS');
    expect(staleSelect.sql).toContain('workspace_data_purges');
  });
  it('reports a maintenance failure while continuing to claim eligible schedules', async () => {
    state.due = [due()];
    const { db } = await import('./report82-engine-harness');
    const impl = db.$queryRaw.getMockImplementation()!;
    db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
      if (s.join('?').includes('FROM report_runs r') && s.join('?').includes('status IN')) throw new Error('maintenance unavailable');
      return impl(s, ...values);
    });
    try {
      const result = await runDueReportSchedules({ now });
      expect(result).toMatchObject({ maintenanceFailures: 1, examined: 1, completed: 1 });
    } finally { db.$queryRaw.mockImplementation(impl); }
  });
  it('sends each recipient exactly once, with a stable per-run, per-recipient key, and never stores the report body', async () => {
    const mail = goodMail();
    registerReportGeneration({ generation: generator(), mail, eligible: async () => true });
    state.due = [due()];
    await runDueReportSchedules({ now });
    expect(mailSent.map(m => m.to)).toEqual(['a@example.com', 'b@example.com']);
    expect(mailSent.map(m => m.key.split(':').at(-1))).toEqual(['0', '1']);
    expect(new Set(mailSent.map(m => m.key.split(':')[0])).size).toBe(1);
    expect(JSON.stringify(state.execs.map(e => e.values))).not.toContain('Analytics report:');
  });
  it('does not generate again when the period was already claimed', async () => {
    state.due = [due()]; state.insertConflict = true;
    expect(await runDueReportSchedules({ now })).toMatchObject({ examined: 0 });
    expect(mailSent).toHaveLength(0);
    expect(execs('UPDATE report_schedules SET "nextRunAt"')).toHaveLength(1);
  });
  it('never resends: a throwing mail port is recorded uncertain and the next recipient still gets one attempt', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('socket reset')).mockResolvedValueOnce({ status: 'sent' });
    registerReportGeneration({ generation: generator(), mail: { send }, eligible: async () => true });
    state.due = [due()];
    const s = await runDueReportSchedules({ now });
    expect(s).toMatchObject({ uncertain: 1, completed: 0 }); expect(send).toHaveBeenCalledTimes(2);
    expect(finalStatus()).toBe('uncertain');
    expect(execs('"lastError"').at(-1)!.values).toContain('delivery_uncertain');
  });
  it('treats an unknown mail answer as uncertain, not sent', async () => {
    registerReportGeneration({ generation: generator(), mail: { send: async () => ({ status: 'queued' as never }) }, eligible: async () => true });
    state.due = [due({ recipients: ['a@example.com'] })];
    expect(await runDueReportSchedules({ now })).toMatchObject({ uncertain: 1, completed: 0 });
  });
  it('separates partial and failed delivery', async () => {
    const send = vi.fn().mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce({ status: 'sent' });
    registerReportGeneration({ generation: generator(), mail: { send }, eligible: async () => true });
    state.due = [due()];
    expect(await runDueReportSchedules({ now })).toMatchObject({ partial: 1 });
    send.mockReset().mockResolvedValue({ status: 'unavailable' }); state.due = [due({ id: 's2' })];
    expect(await runDueReportSchedules({ now })).toMatchObject({ failed: 1 });
  });
  it('skips an ineligible owner, fails without an owner or on generation failure, and sends nothing', async () => {
    let calls = 0;
    const eligible = vi.fn(async () => { calls += 1; return calls !== 1; });
    registerReportGeneration({ generation: generator(), mail: goodMail(), eligible });
    state.due = [due(), due({ id: 's2', createdById: null }), due({ id: 's3' })];
    gen.error = Object.assign(new Error('x'), { code: 'forbidden' });
    const s = await runDueReportSchedules({ now });
    expect(s).toMatchObject({ examined: 3, skipped: 1, failed: 2, completed: 0 });
    expect(mailSent).toHaveLength(0);
    expect(execs('"lastError"').flatMap(e => e.values)).toEqual(expect.arrayContaining(['access_unavailable', 'no_report_owner']));
  });
  it('skips a channel that is no longer selected, connected or on an enabled platform', async () => {
    state.usable = false; state.due = [due()];
    expect(await runDueReportSchedules({ now })).toMatchObject({ skipped: 1, completed: 0 });
    expect(execs('"lastError"').at(-1)!.values).toContain('channel_unavailable');
    expect(mailSent).toHaveLength(0);
  });
  it('treats a throwing eligibility gate as not eligible', async () => {
    registerReportGeneration({ generation: generator(), mail: goodMail(), eligible: async () => { throw new Error('plan lookup down'); } });
    state.due = [due()];
    expect(await runDueReportSchedules({ now })).toMatchObject({ skipped: 1 });
    expect(mailSent).toHaveLength(0);
  });
  it('stops at the next recipient boundary when the recipient list or authority changed', async () => {
    state.due = [due()]; state.recipientsNow = ['b@example.com'];
    const s = await runDueReportSchedules({ now });
    expect(mailSent.map(m => m.to)).toEqual(['b@example.com']);
    expect(s.partial + s.completed).toBeGreaterThan(0);
  });
  it('stops and fails closed when the claim is lost', async () => {
    state.due = [due()]; state.failFenceAt = 2;
    const s = await runDueReportSchedules({ now });
    expect(s.interrupted).toBe(1); expect(s.completed).toBe(0); expect(mailSent).toHaveLength(0);
  });
  it('records interrupted runs from an expired lease as uncertain without retrying delivery', async () => {
    state.stale = [{ id: 'r9', workspaceId: 'w1', scheduleId: 's1', kind: 'scheduled', status: 'delivering', deliveries: [{ index: 0, mask: 'a***@example.com', status: 'attempting' }, { index: 1, mask: 'b***@example.com', status: 'pending' }] }];
    const s = await runDueReportSchedules({ now });
    expect(s.interrupted).toBe(1); expect(mailSent).toHaveLength(0);
    expect(execs('"lastError"').at(-1)!.values).toContain('lease_expired_during_delivery');
    const closed = execs('UPDATE report_runs SET status').find(e => e.values.includes('uncertain'))!;
    const deliveries = String(closed.values.find(v => typeof v === 'string' && v.startsWith('[')));
    expect(deliveries).toContain('"uncertain"'); expect(deliveries).toContain('"skipped"'); expect(deliveries).not.toContain('"attempting"');
  });
  it('does not mark an expired delivering run uncertain when no mail intent was recorded', async () => {
    state.stale = [{ id: 'r-no-send', workspaceId: 'w1', scheduleId: 's1', kind: 'scheduled', status: 'delivering', deliveries: [{ index: 0, mask: 'a***@example.com', status: 'pending' }] }];
    const result = await runDueReportSchedules({ now });
    expect(result).toMatchObject({ interrupted: 1, uncertain: 0 });
    const closed = execs('UPDATE report_runs SET status').find(e => e.values.includes('access_unavailable'))!;
    expect(closed.values[0]).toBe('skipped');
    const deliveries = String(closed.values.find(v => typeof v === 'string' && v.startsWith('[')));
    expect(deliveries).toContain('"skipped"');
    expect(deliveries).not.toContain('"uncertain"');
  });
  it('closes a run that expired before delivery as failed', async () => {
    state.stale = [{ id: 'r9', workspaceId: 'w1', scheduleId: null, kind: 'manual', status: 'generating', deliveries: [] }];
    await runDueReportSchedules({ now });
    expect(execs('UPDATE report_runs SET status').some(e => e.values.includes('failed') && e.values.includes('lease_expired'))).toBe(true);
    expect(execs('"lastError"')).toHaveLength(0);
  });
  it('clears expired prepared artifacts, keeps history, and does so even while delivery is unavailable', async () => {
    unregisterReportGeneration();
    registerReportGeneration({ generation: generator() });
    state.expiredOutputs = [{ id: 'r1', workspaceId: 'w1' }, { id: 'r2', workspaceId: 'w1' }];
    const s = await runDueReportSchedules({ now });
    expect(s).toMatchObject({ disabled: true, cleared: 2 });
    const candidates = state.queries.find(x => x.sql.includes('FROM report_runs r WHERE') && x.sql.includes('"outputExpiresAt"'))!;
    const clear = state.queries.find(x => x.sql.includes('SET output = NULL'))!;
    expect(candidates.sql).toContain('LIMIT');
    expect(candidates.sql).not.toContain('FOR UPDATE');
    expect(candidates.sql).toContain('NOT EXISTS');
    expect(candidates.sql).toContain('workspace_data_purges');
    expect(clear.sql).not.toContain('DELETE');
    expect(clear.sql).toContain('"outputExpiresAt" = NULL');
    expect(clear.sql).toContain('"workspaceId" =');
    expect(state.queries.some(query => query.sql.includes('FROM workspaces WHERE id = ANY') && query.sql.includes('FOR SHARE'))).toBe(true);
    const logged = execs('activity_logs').filter(e => e.values.includes('analytics.report_output_expired'));
    expect(logged).toHaveLength(1);
    expect(String(logged[0]!.values.find(v => typeof v === 'string' && v.startsWith('{')))).toContain('"runs":2');
  });
  it('backs invalid workspace time zones off by the configured lease and reports the skipped schedule', async () => {
    state.due = [due({ timezone: 'Invalid/Zone' })];
    const result = await runDueReportSchedules({ now });
    expect(result).toMatchObject({ skipped: 1, examined: 0 });
    const backoff = execs('UPDATE report_schedules SET "nextRunAt"').at(-1)!;
    expect(backoff.values.some(v => v instanceof Date && v.getTime() === now.getTime() + 600 * 1000)).toBe(true);
    expect(backoff.sql).toContain('workspace_time_zone_unavailable');
    expect(execs('activity_logs').some(e => e.values.includes('analytics.report_schedule_skipped'))).toBe(true);
    expect(mailSent).toHaveLength(0);
  });
  it('keeps a failed pre-send intent write failed, with no false delivery uncertainty', async () => {
    state.due = [due({ recipients: ['a@example.com'] })];
    const exec = state.execs;
    const impl = (await import('./report82-engine-harness')).db.$executeRaw.getMockImplementation()!;
    (await import('./report82-engine-harness')).db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const sql = s.join('?');
      if (sql.includes('deliveries = COALESCE') && values.some(v => typeof v === 'string' && v.includes('"attempting"'))) throw new Error('transient pre-send write failure');
      return impl(s, ...values);
    });
    try {
      const result = await runDueReportSchedules({ now });
      expect(result).toMatchObject({ failed: 1, uncertain: 0 });
      expect(mailSent).toHaveLength(0);
      const terminal = execs('deliveries = COALESCE').at(-1)!;
      expect(terminal.values).toContain('delivery_not_started');
      const deliveries = String(terminal.values.find(v => typeof v === 'string' && v.startsWith('[')));
      expect(deliveries).toContain('"skipped"');
      expect(deliveries).not.toContain('"attempting"');
      expect(deliveries).not.toContain('"uncertain"');
    } finally { (await import('./report82-engine-harness')).db.$executeRaw.mockImplementation(impl); }
  });
  it('preserves uncertainty from an earlier real mail attempt if a later intent write fails', async () => {
    state.due = [due()];
    const { db } = await import('./report82-engine-harness');
    const mail = { send: vi.fn().mockRejectedValueOnce(new Error('mail result unknown')) };
    registerReportGeneration({ generation: generator(), mail, eligible: async () => true });
    const impl = db.$executeRaw.getMockImplementation()!;
    let intentWrites = 0;
    db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const sql = s.join('?');
      if (sql.includes('deliveries = COALESCE') && values.some(v => typeof v === 'string' && v.includes('"attempting"')) && ++intentWrites === 2) throw new Error('transient pre-send write failure');
      return impl(s, ...values);
    });
    try {
      const result = await runDueReportSchedules({ now });
      expect(result).toMatchObject({ uncertain: 1, failed: 0 });
      expect(mail.send).toHaveBeenCalledTimes(1);
      const terminal = execs('deliveries = COALESCE').at(-1)!;
      expect(terminal.values[0]).toBe('uncertain');
      expect(terminal.values).toContain('delivery_uncertain');
      const deliveries = String(terminal.values.find(v => typeof v === 'string' && v.startsWith('[')));
      expect(deliveries).toContain('"uncertain"');
      expect(deliveries).toContain('"skipped"');
    } finally { db.$executeRaw.mockImplementation(impl); }
  });
});

describe('stored manual report replay limits', () => {
  it('refuses replay when the current key result ceiling is below the stored row count', async () => {
    const { state } = await import('./report82-engine-harness');
    const { registerReportGeneration } = await import('../src/modules/analytics/reports/generation/registry');
    const { reportChannelRunConfirmation } = await import('../src/modules/analytics/reports/contracts');
    const { requestHash } = await import('../src/modules/analytics/reports/generation/run-store');
    const now = new Date('2026-10-19T08:01:00Z');
    const requestId = '7f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11';
    state.existing = { id: 'r-existing', status: 'completed', requestHash: requestHash({ kind: 'channel', channelId: 'c1', templateId: null, start: '2026-10-01', end: '2026-10-18' }), targetId: 'c1', output: { channelName: 'Page', period: { start: '2026-10-01', end: '2026-10-18' }, generatedAt: now.toISOString(), sections: ['analysis'], notIncluded: [], csv: 'a,b', html: '<p>report</p>', rowCount: 10, truncated: false }, outputExpiresAt: new Date(now.getTime() + 3600_000) };
    registerReportGeneration({ generation: { generate: async () => ({ ok: false, reason: 'generation_failed' }) } });
    await expect(runReportNow({ userId: 'u1', workspaceId: 'w1', maxResultItems: 3 }, { channelId: 'c1', templateId: null, start: '2026-10-01', end: '2026-10-18', requestId, confirmation: reportChannelRunConfirmation('c1') }, now)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects a stored artifact whose combined CSV and HTML exceed the Root storage cap', async () => {
    const { db } = await import('./report82-engine-harness');
    state.config['analytics.reports.maxStoredArtifactBytes'] = 20000;
    const { registerReportGeneration } = await import('../src/modules/analytics/reports/generation/registry');
    registerReportGeneration({ generation: { generate: async () => ({ ok: true, output: { channelName: 'Page', period: { start: '2026-10-01', end: '2026-10-18' }, generatedAt: new Date().toISOString(), sections: ['analysis'], notIncluded: [], csv: 'c'.repeat(12000), html: 'h'.repeat(12000), text: 'short', rowCount: 1, bytes: 12000, htmlBytes: 12000, textBytes: 5, truncated: false } }) } });
    const now = new Date('2026-10-19T08:01:00Z');
    const requestId = '8f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11';
    await expect(runReportNow({ userId: 'u1', workspaceId: 'w1' }, { channelId: 'c1', templateId: null, start: '2026-10-01', end: '2026-10-18', requestId, confirmation: 'GENERATE CHANNEL REPORT c1' }, now)).rejects.toMatchObject({ code: 'unavailable' });
    const completion = db.$executeRaw.mock.calls.map(([sql, ...values]) => ({ sql: sql.join('?'), values })).find(e => e.sql.includes('"outputExpiresAt" = COALESCE') && e.values[0] === 'failed');
    expect(completion?.values[0]).toBe('failed');
    expect(completion?.values[1]).toBe('stored_output_too_large');
    expect(completion?.values[6]).toBeNull();
  });
});

describe('run history', () => {
  const runRow = (over: Record<string, unknown> = {}) => ({ id: 'r1', scheduleId: 's1', targetId: 'c1', kind: 'scheduled', status: 'completed', periodStart: '2026-10-12', periodEnd: '2026-10-18', startedAt: new Date(), finishedAt: new Date(), rowCount: 3, truncated: false, failureReason: null, deliveries: [{ index: 0, mask: 'a***@example.com', status: 'sent' }], ...over });
  it('shows recipient masks only to people who manage schedules and applies channel scope', async () => {
    state.runRows = [runRow()];
    const managed = await listReportRuns(actor, {});
    expect(managed.runs[0]!.deliveries).toHaveLength(1);
    expect(managed.runs[0]).toMatchObject({ outcome: 'sent' });
    state.role = 'viewer';
    expect((await listReportRuns(actor, {})).runs[0]!.deliveries).toEqual([]);
    state.scope = [];
    expect((await listReportRuns(actor, {})).runs).toEqual([]);
    state.scope = ['c1']; await listReportRuns(actor, {});
    expect(state.queries.at(-1)!.values).toContainEqual(['c1']);
  });
  it('labels a manual run Prepared and an unconfirmed delivery as uncertain', async () => {
    state.runRows = [runRow({ id: 'r2', kind: 'manual', scheduleId: null, deliveries: [] }), runRow({ id: 'r3', status: 'uncertain', failureReason: 'delivery_uncertain' })];
    const runs = (await listReportRuns(actor, {})).runs;
    expect(runs.map(r => r.outcome)).toEqual(['prepared', 'uncertain']);
  });
  it('bounds a page by the key result ceiling and reports more', async () => {
    state.runRows = [runRow({ id: 'a' }), runRow({ id: 'b' }), runRow({ id: 'c' })];
    const page = await listReportRuns({ ...actor, maxResultItems: 2 }, {});
    expect(page.runs).toHaveLength(2); expect(page.hasMore).toBe(true);
  });
});
