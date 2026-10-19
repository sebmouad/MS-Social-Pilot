import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { db, execs, gen, reset, resetGen, snapshot, state } from './report82-engine-harness';
import { registerReportGeneration, resetReportCapabilityCache, unregisterReportGeneration } from '../src/modules/analytics/reports/generation/registry';
import { createReportGenerator } from '../src/modules/analytics/reports/generation/document';
import { runReportNow } from '../src/modules/analytics/reports/generation/runs';
import { requestHash } from '../src/modules/analytics/reports/generation/run-store';
import { reportChannelRunConfirmation, reportRunConfirmation, type ReportActor, type ReportOutput } from '../src/modules/analytics/reports/contracts';
import { executeAnalyticsReportTool } from '../src/modules/analytics/reports/mcp';

const NOW = new Date('2026-10-21T10:00:00Z');
const RID = '6f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11';
const actor: ReportActor = { userId: 'u1', workspaceId: 'w1' };
const channelInput = (over: Record<string, unknown> = {}) => ({ channelId: 'c1', templateId: null, start: '2026-10-01', end: '2026-10-18', requestId: RID, confirmation: reportChannelRunConfirmation('c1'), ...over });
const scheduleInput = (over: Record<string, unknown> = {}) => ({ scheduleId: 's1', requestId: RID, confirmation: reportRunConfirmation('s1'), ...over });
const real = () => createReportGenerator({ bounds: async () => ({ maxRows: 100, maxBytes: 20000 }), now: () => new Date('2026-10-21T09:59:00Z') });
const stored = { channelName: 'Page One', period: { start: '2026-10-01', end: '2026-10-18' }, generatedAt: '2026-10-20T00:00:00.000Z', sections: ['analysis'], notIncluded: [], csv: '"a"\r\n"é€😀"\r\n', html: '<p>é</p>', rowCount: 1, truncated: false };
const channelHash = (over: Record<string, string | null> = {}) => requestHash({ kind: 'channel', channelId: 'c1', templateId: null, start: '2026-10-01', end: '2026-10-18', ...over });
const prior = (over: Record<string, unknown> = {}) => ({ id: 'r-old', status: 'completed', requestHash: channelHash(), targetId: 'c1', output: stored, outputExpiresAt: new Date(NOW.getTime() + 3600_000), ...over });
const inserts = () => state.queries.filter(q => q.sql.includes('INSERT INTO report_runs'));
const finishedWrites = () => execs('UPDATE report_runs SET status').filter(e => e.values.includes(true));
const mailPort = { send: vi.fn(async () => ({ status: 'sent' as const })) };
const okOutput = (over: Partial<ReportOutput> = {}): ReportOutput => ({ channelName: 'P', period: { start: '2026-10-01', end: '2026-10-18' }, generatedAt: '2026-10-21T09:59:00.000Z', sections: ['analysis'], notIncluded: [], csv: 'x', html: 'y', text: 'z', rowCount: 1, bytes: 1, truncated: false, htmlBytes: 1, textBytes: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks(); reset(); resetGen(); resetReportCapabilityCache();
  registerReportGeneration({ generation: real() });
});

describe('standalone channel report (a download, no delivery needed)', () => {
  it('prepares a report for explicit inclusive UTC dates without SMTP, jobs or an eligibility gate', async () => {
    gen.snapshot = snapshot({ period: { start: '2026-10-01', end: '2026-10-18' } });
    const out = await runReportNow(actor, channelInput(), NOW);
    expect(out).toMatchObject({ ok: true, outcome: 'prepared', replayed: false, period: { start: '2026-10-01', end: '2026-10-18' }, truncated: false, rowCount: expect.any(Number), notIncluded: [] });
    expect(out.filename).toContain('report-');
    expect(out.csv).toContain('summary');
    expect(out.bytes).toBe(Buffer.byteLength(out.csv, 'utf8'));
    expect(gen.input).toMatchObject({ start: '2026-10-01', end: '2026-10-18', channel: 'c1', compare: 'none' });
    expect(mailPort.send).not.toHaveBeenCalled();
    expect(state.maxDepth).toBe(1);
  });
  it('records a manual run with no schedule, the payload-bound hash and the actor-scoped idempotency key', async () => {
    await runReportNow(actor, channelInput(), NOW);
    const insert = inserts()[0]!;
    expect(insert.values).toContain(`manual:w1:u1:${RID}`);
    expect(insert.values).toContain(channelHash());
    expect(insert.values).toContain(null);
    expect(insert.values).toContain('2026-10-01');
    expect(insert.sql).toContain('ON CONFLICT ("idempotencyKey") DO NOTHING');
    expect(insert.sql).toContain('"claimToken"');
    expect(insert.sql).toContain('"requestHash"');
    expect(JSON.stringify(execs('activity_logs').map(e => e.values))).not.toContain('@');
  });
  it('stores the output in the same fenced completion write, with the retention expiry, before releasing it', async () => {
    await runReportNow(actor, channelInput(), NOW);
    const done = finishedWrites();
    expect(done).toHaveLength(1);
    expect(done[0]!.values[0]).toBe('completed');
    const json = JSON.parse(String(done[0]!.values.find(v => typeof v === 'string' && v.startsWith('{"channelName"'))));
    expect(json).toMatchObject({ channelName: 'Page One', rowCount: expect.any(Number) });
    expect(typeof json.csv).toBe('string'); expect(typeof json.html).toBe('string'); expect(json).not.toHaveProperty('text');
    expect(done[0]!.values.some(v => v instanceof Date && v.getTime() === NOW.getTime() + 24 * 3600_000)).toBe(true);
    expect(done[0]!.sql).toContain('"claimToken"');
    expect(execs('activity_logs').some(e => e.values.includes('analytics.report_run_finished'))).toBe(true);
  });
  it('uses the template sections and lists stored ones that cannot be supplied', async () => {
    state.templateSections = ['audience', 'destinations'];
    const out = await runReportNow(actor, channelInput({ templateId: 't1' }), NOW);
    expect(out.notIncluded).toEqual(['destinations']);
    expect(out.csv).toContain('audience'); expect(out.csv).not.toContain('summary');
    expect(inserts()[0]!.values).toContain(channelHash({ templateId: 't1' }));
  });
  it('refuses a template from another workspace and a template for a selected-resource key', async () => {
    state.templateOk = false;
    await expect(runReportNow(actor, channelInput({ templateId: 'foreign' }), NOW)).rejects.toMatchObject({ code: 'invalid_request' });
    state.templateOk = true;
    await expect(runReportNow({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'] }, channelInput({ templateId: 't1' }), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    expect(inserts()).toHaveLength(0);
  });
  it('lets a scoped session use a template, and an all-resource key with inherited limits keep parity', async () => {
    state.scope = ['c1']; state.freshScope = ['c1'];
    await expect(runReportNow({ ...actor, allowedChannelIds: ['c1'] }, channelInput({ templateId: 't1' }), NOW)).resolves.toMatchObject({ ok: true });
    state.existing = null; state.queries.length = 0;
    await expect(runReportNow({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'], resourceRestricted: false }, channelInput({ templateId: 't1', requestId: '7f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11' }), NOW)).resolves.toMatchObject({ ok: true });
  });
  it('lets a selected-resource key prepare a channel inside its ceiling, and refuses any other channel', async () => {
    const key = { ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'], resourceRestricted: true };
    await expect(runReportNow(key, channelInput(), NOW)).resolves.toMatchObject({ ok: true });
    await expect(runReportNow(key, channelInput({ channelId: 'c2', confirmation: reportChannelRunConfirmation('c2'), requestId: '8f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11' }), NOW)).rejects.toMatchObject({ code: 'not_found' });
    // The key id (never a secret) is recorded in the audit detail, with the fixed source marker.
    const detail = execs('activity_logs').map(e => String(e.values.find(v => typeof v === 'string' && v.startsWith('{')))).join(' ');
    expect(detail).toContain('"apiKeyId":"k1"'); expect(detail).toContain('"authSource":"api_key"');
  });
  it('refuses an out-of-scope or no-longer-connected channel before inserting anything', async () => {
    state.freshScope = ['other'];
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'not_found' });
    state.freshScope = null; state.usable = false;
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(inserts()).toHaveLength(0); expect(gen.calls).toBe(0);
  });

  describe('dates follow the shared Analytics date policy', () => {
    const rejects = async (over: Record<string, unknown>) => {
      await expect(runReportNow(actor, channelInput(over), NOW)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(inserts()).toHaveLength(0);
    };
    it('rejects malformed, impossible, reversed, future and too-long ranges', async () => {
      await rejects({ start: 'Oct 1' });
      await rejects({ end: '2026-02-30' });
      await rejects({ start: '2026-10-19', end: '2026-10-18' });
      await rejects({ end: '2026-10-22' });
      await rejects({ start: '2026-07-20', end: '2026-10-18' }); // 91 days; Root's maximum is 90
    });
    it('accepts exactly the maximum range, a single day and a range ending today', async () => {
      await expect(runReportNow(actor, channelInput({ start: '2026-07-21', end: '2026-10-18' }), NOW)).resolves.toMatchObject({ ok: true });
      await expect(runReportNow(actor, channelInput({ start: '2026-10-18', end: '2026-10-18', requestId: '9f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11' }), NOW)).resolves.toMatchObject({ ok: true });
      await expect(runReportNow(actor, channelInput({ start: '2026-10-21', end: '2026-10-21', requestId: 'af1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11' }), NOW)).resolves.toMatchObject({ ok: true });
    });
    it('reads the limit from Root settings and fails closed when the policy is unusable', async () => {
      state.config['analytics.maxRangeDays'] = 10;
      await rejects({ start: '2026-10-01', end: '2026-10-18' });
      state.config['analytics.maxRangeDays'] = 0;
      await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'unavailable' });
    });
    it('rejects a missing date, an unknown field and the other form\'s confirmation', async () => {
      await expect(runReportNow(actor, { ...channelInput(), start: undefined }, NOW)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(runReportNow(actor, { ...channelInput(), extra: 1 }, NOW)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(runReportNow(actor, channelInput({ confirmation: reportRunConfirmation('c1') }), NOW)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(runReportNow(actor, { ...channelInput(), scheduleId: 's1' }, NOW)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(runReportNow(actor, { ...scheduleInput(), start: '2026-10-01' }, NOW)).rejects.toMatchObject({ code: 'invalid_request' });
      expect(state.queries).toHaveLength(0);
    });
  });
});

describe('schedule report', () => {
  it('prepares the most recent complete period, never emails, and records Prepared', async () => {
    registerReportGeneration({ generation: real(), mail: mailPort, eligible: async () => true });
    state.scheduleSections = ['analysis', 'destinations'];
    const out = await runReportNow(actor, scheduleInput(), NOW);
    expect(out).toMatchObject({ ok: true, outcome: 'prepared', period: { start: '2026-10-12', end: '2026-10-18' }, truncated: false, notIncluded: ['destinations'], replayed: false });
    expect(mailPort.send).not.toHaveBeenCalled();
    expect(inserts()[0]!.values).toContain(`manual:w1:u1:${RID}`);
    expect(inserts()[0]!.values).toContain('s1');
    expect(inserts()[0]!.values).toContain(requestHash({ kind: 'schedule', scheduleId: 's1', channelId: 'c1', templateId: null }));
  });
  it('requires the exact confirmation, a writer role and a visible schedule', async () => {
    await expect(runReportNow(actor, scheduleInput({ confirmation: 'GENERATE REPORT s2' }), NOW)).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'viewer';
    await expect(runReportNow(actor, scheduleInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'editor'; state.scheduleRow = false;
    await expect(runReportNow(actor, scheduleInput(), NOW)).rejects.toMatchObject({ code: 'not_found' });
    state.scheduleRow = true; state.freshScope = ['other'];
    await expect(runReportNow(actor, scheduleInput(), NOW)).rejects.toMatchObject({ code: 'not_found' });
    expect(inserts()).toHaveLength(0);
  });
  it('fails closed on an invalid workspace time zone', async () => {
    state.tz = 'Mars/Base';
    await expect(runReportNow(actor, scheduleInput(), NOW)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('authority and availability', () => {
  it('is unavailable without a registered generator, and denied to readers, disabled features and non-members', async () => {
    unregisterReportGeneration();
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'unavailable' });
    registerReportGeneration({ generation: real() });
    state.role = 'viewer'; await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'editor'; state.canAccess = false; await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.canAccess = true; state.member = false; await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(inserts()).toHaveLength(0);
  });
  it('re-reads membership and feature under lock so a change committed after the preflight wins', async () => {
    state.lockRole = 'viewer';
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'unauthorized' });
    state.lockRole = null; state.lockSuspended = true;
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.lockSuspended = false; state.purge = 'running';
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toThrow();
    expect(inserts()).toHaveLength(0);
  });
  it('honours a key permission ceiling', async () => {
    await expect(runReportNow({ ...actor, permissionCeiling: { deny: ['analytics/reports'] } as never }, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('idempotent retry of a manual request', () => {
  it('recovers a matching prepared result instead of generating again', async () => {
    state.existing = prior();
    const out = await runReportNow(actor, channelInput(), NOW);
    expect(out).toMatchObject({ ok: true, replayed: true, runId: 'r-old', outcome: 'prepared', csv: stored.csv, html: stored.html, rowCount: 1, truncated: false });
    expect(out.bytes).toBe(Buffer.byteLength(stored.csv, 'utf8'));
    expect(out.bytes).toBeGreaterThan(stored.csv.length); // multi-byte characters: exact UTF-8 size, not string length
    expect(gen.calls).toBe(0); expect(inserts()).toHaveLength(0); expect(finishedWrites()).toHaveLength(0);
    expect(execs('activity_logs').some(e => e.values.includes('analytics.report_run_replayed'))).toBe(true);
    expect(state.maxDepth).toBe(1);
  });
  it('looks up identity by workspace, person and request id only', async () => {
    state.existing = prior();
    await runReportNow({ ...actor, userId: 'u2' }, channelInput(), NOW);
    const lookup = state.queries.find(q => q.sql.includes('FROM report_runs WHERE "idempotencyKey"'))!;
    expect(lookup.values).toContain(`manual:w1:u2:${RID}`);
    expect(lookup.values).toContain('w1');
  });
  it('recovers a matching schedule request the same way', async () => {
    state.existing = prior({ requestHash: requestHash({ kind: 'schedule', scheduleId: 's1', channelId: 'c1', templateId: null }) });
    expect(await runReportNow(actor, scheduleInput(), NOW)).toMatchObject({ replayed: true, runId: 'r-old' });
    expect(gen.calls).toBe(0);
  });
  it('refuses the same request id with a different payload', async () => {
    for (const hash of [channelHash({ end: '2026-10-17' }), channelHash({ templateId: 't1' }), channelHash({ channelId: 'c9' }), requestHash({ kind: 'schedule', scheduleId: 's1', channelId: 'c1', templateId: null })]) {
      state.existing = prior({ requestHash: hash });
      await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'conflict' });
    }
    state.existing = prior({ targetId: 'c9' });
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'conflict' });
    expect(gen.calls).toBe(0); expect(inserts()).toHaveLength(0);
  });
  it('reports a run still in progress without regenerating', async () => {
    for (const status of ['claimed', 'generating']) {
      state.existing = prior({ status, output: null, outputExpiresAt: null });
      const error = await runReportNow(actor, channelInput(), NOW).catch(e => e);
      expect(error).toMatchObject({ code: 'conflict' });
      expect(String(error.message)).toContain('will not be started again');
    }
    expect(gen.calls).toBe(0); expect(inserts()).toHaveLength(0);
  });
  it('says so when the earlier request ended without a report', async () => {
    for (const status of ['failed', 'skipped', 'uncertain', 'partial']) {
      state.existing = prior({ status, output: null, outputExpiresAt: null });
      await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'conflict' });
    }
    expect(gen.calls).toBe(0);
  });
  it('reports an expired or cleared artifact as unavailable and never regenerates it', async () => {
    for (const over of [{ outputExpiresAt: new Date(NOW.getTime() - 1) }, { outputExpiresAt: NOW }, { output: null }, { outputExpiresAt: null }, { output: { csv: 5 } }]) {
      state.existing = prior(over);
      const error = await runReportNow(actor, channelInput(), NOW).catch(e => e);
      expect(error).toMatchObject({ code: 'unavailable' });
      expect(String(error.message)).toContain('no longer available');
    }
    expect(gen.calls).toBe(0); expect(inserts()).toHaveLength(0);
  });
  it('does not show a stored result after access was revoked', async () => {
    state.existing = prior();
    state.role = 'viewer';
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'editor'; state.canAccess = false;
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.canAccess = true; state.usable = false;
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'invalid_request' });
    state.usable = true; state.freshScope = ['other'];
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'not_found' });
    state.freshScope = null; state.entitled = false;
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
    state.entitled = true;
    await expect(runReportNow({ ...actor, allowedChannelIds: ['c9'], apiKeyId: 'k1' }, channelInput(), NOW)).rejects.toMatchObject({ code: 'not_found' });
    expect(execs('activity_logs').some(e => e.values.includes('analytics.report_run_replayed'))).toBe(false);
  });
  it('refuses a replay when the race lands between the check and the release', async () => {
    state.existing = prior();
    // The first authorisation (preflight) passes; the release-time one sees a revoked feature.
    let membership = 0;
    const impl = db.$queryRaw.getMockImplementation()!;
    db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
      const sql = s.join('?');
      if (sql.includes('FROM memberships m JOIN users u') && !sql.includes('FOR SHARE')) { membership += 1; if (membership >= 2) return []; }
      return impl(s, ...v);
    });
    try { await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' }); }
    finally { db.$queryRaw.mockImplementation(impl); }
    expect(execs('activity_logs').some(e => e.values.includes('analytics.report_run_replayed'))).toBe(false);
  });
  it('lets a concurrent insert of the same id surface as a conflict, not a second run', async () => {
    state.insertConflict = true;
    await expect(runReportNow(actor, channelInput(), NOW)).rejects.toMatchObject({ code: 'conflict' });
    expect(gen.calls).toBe(0);
  });
});

describe('result ceilings', () => {
  it('bounds the generated rows themselves for a key, marks them truncated and reports exact bytes', async () => {
    const out = await runReportNow({ ...actor, maxResultItems: 3 }, channelInput(), NOW);
    expect(out).toMatchObject({ ok: true, rowCount: 3, truncated: true });
    expect(out.csv).toContain('"truncated","true"');
    expect(out.bytes).toBe(Buffer.byteLength(out.csv, 'utf8'));
    const stored2 = JSON.parse(String(finishedWrites()[0]!.values.find(v => typeof v === 'string' && v.startsWith('{"channelName"'))));
    expect(stored2.rowCount).toBe(3); expect(stored2.truncated).toBe(true);
  });
  it('fails closed when a generator returns more rows than the ceiling allows', async () => {
    registerReportGeneration({ generation: { generate: async () => ({ ok: true, output: okOutput({ rowCount: 50 }) }) } });
    const error = await runReportNow({ ...actor, maxResultItems: 3 }, channelInput(), NOW).catch(e => e);
    expect(error).toMatchObject({ code: 'unavailable' }); expect(String(error.message)).toContain('more rows');
    expect(finishedWrites()[0]!.values[0]).toBe('failed');
    expect(finishedWrites()[0]!.values).toContain('result_too_large');
    expect(JSON.stringify(finishedWrites()[0]!.values)).not.toContain('"csv"');
  });
  it('refuses an unusable ceiling', async () => {
    await expect(runReportNow({ ...actor, maxResultItems: 0 }, channelInput(), NOW)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('failure, release and fencing', () => {
  it('records a failed run and gives a safe message when generation fails', async () => {
    gen.error = new Error('internal path /srv/x');
    const error = await runReportNow(actor, channelInput(), NOW).catch(e => e);
    expect(error).toMatchObject({ code: 'unavailable' }); expect(String(error.message)).not.toContain('/srv');
    expect(finishedWrites()[0]!.values[0]).toBe('failed');
    expect(finishedWrites()[0]!.values).toContain('generation_failed');
  });
  it('does not release content when the channel or person stops qualifying during generation', async () => {
    registerReportGeneration({ generation: { generate: async () => { state.usable = false; return { ok: true, output: okOutput() }; } } });
    const error = await runReportNow(actor, channelInput(), NOW).catch(e => e);
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(finishedWrites()[0]!.values).toContain('channel_unavailable');
    expect(JSON.stringify(finishedWrites()[0]!.values)).not.toContain('"csv"');
  });
  it('does not release content when the completion write loses its claim', async () => {
    state.failFenceAt = 1;
    const error = await runReportNow(actor, channelInput(), NOW).catch(e => e);
    expect(error).toMatchObject({ code: 'unavailable' }); expect(String(error.message)).toContain('not released');
    expect(error).not.toHaveProperty('csv');
  });
  it('retries a transient completion failure but never a lost claim, and still releases nothing if it cannot record', async () => {
    const impl = db.$executeRaw.getMockImplementation()!;
    let attempts = 0;
    db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
      const sql = s.join('?');
      if (sql.includes('activity_logs') && v.includes('analytics.report_run_finished')) { attempts += 1; throw new Error('db down'); }
      return impl(s, ...v);
    });
    try {
      const error = await runReportNow(actor, channelInput(), NOW).catch(e => e);
      expect(String(error.message)).toContain('not released');
      expect(attempts).toBe(2); // finishRetries = 1 → two attempts, then the sweep closes the run
    } finally { db.$executeRaw.mockImplementation(impl); }
  });
  it('closes the start of a run and its audit in one transaction and never nests pooled transactions', async () => {
    await runReportNow(actor, channelInput(), NOW);
    expect(state.maxDepth).toBe(1);
    const started = execs('activity_logs').find(e => e.values.includes('analytics.report_run_started'))!;
    expect(String(started.values.find(v => typeof v === 'string' && v.startsWith('{')))).toContain('"channelId":"c1"');
  });
});

describe('MCP generate_report', () => {
  // The tool entry point reads the real clock; pin it so the explicit dates stay inside "today".
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  it('serves both forms through the same confirmed service and bounds rows by the key ceiling', async () => {
    const wide = await executeAnalyticsReportTool({ ...actor, maxResultItems: 3 }, 'generate_report', channelInput()) as Awaited<ReturnType<typeof runReportNow>>;
    expect(wide).toMatchObject({ ok: true, outcome: 'prepared', rowCount: 3, truncated: true });
    expect(wide.bytes).toBe(Buffer.byteLength(wide.csv, 'utf8'));
    registerReportGeneration({ generation: real(), mail: mailPort, eligible: async () => true });
    state.existing = null;
    const sched = await executeAnalyticsReportTool(actor, 'generate_report', scheduleInput({ requestId: 'bf1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11' })) as Awaited<ReturnType<typeof runReportNow>>;
    expect(sched).toMatchObject({ ok: true, outcome: 'prepared' });
    await expect(executeAnalyticsReportTool(actor, 'generate_report', channelInput({ confirmation: 'nope' }))).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('recovers a retried MCP request', async () => {
    state.existing = prior();
    expect(await executeAnalyticsReportTool(actor, 'generate_report', channelInput())).toMatchObject({ replayed: true });
  });
  it('is not offered when generation is unavailable', async () => {
    unregisterReportGeneration();
    await expect(executeAnalyticsReportTool(actor, 'generate_report', channelInput())).rejects.toMatchObject({ code: 'unavailable' });
  });
});


describe('current release bounds and lease clock', () => {
  it('refuses replay under a narrower current key result ceiling', async () => {
    state.existing = prior({output:{...stored,rowCount:3}});
    await expect(runReportNow({...actor,maxResultItems:1},channelInput(),NOW)).rejects.toMatchObject({code:'unavailable'});
    expect(gen.calls).toBe(0);
    expect(execs('activity_logs').some(e=>e.values.includes('analytics.report_run_replayed'))).toBe(false);
  });
  it('uses elapsed wall time in the completion lease fence', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
    const later=new Date(NOW.getTime()+601000);
    try {
      registerReportGeneration({generation:{generate:async()=>{vi.setSystemTime(later);return {ok:true,output:okOutput()};}}});
      await expect(runReportNow(actor,channelInput())).rejects.toMatchObject({code:'unavailable'});
      const completionAttempt=execs('UPDATE report_runs SET status').at(-1)!;
      expect(completionAttempt.values[8]).toBe(true);
      expect(completionAttempt.values[9]).toEqual(later);
      expect(finishedWrites()).toHaveLength(1); // the recorded call is the rejected terminal CAS; the report was not released
    } finally {vi.useRealTimers();}
  });
});
