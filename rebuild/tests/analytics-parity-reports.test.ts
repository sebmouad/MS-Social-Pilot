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

import { db, execs, reset, state } from './report82-engine-harness';
import { registerReportGeneration, resetReportCapabilityCache } from '../src/modules/analytics/reports/generation/registry';
import { listReportTemplates, manageReportTemplate } from '../src/modules/analytics/reports/server/templates';
import { listReportSchedules, manageReportSchedule } from '../src/modules/analytics/reports/server/schedules';
import { REPORT_SUPPORTED_SECTIONS, reportConfirmation, type ReportActor } from '../src/modules/analytics/reports/contracts';
import { executeAnalyticsReportTool, analyticsReportToolDefinitions, analyticsReportWriteTools } from '../src/modules/analytics/reports/mcp';
import { REPORT_WORKFLOW_CONFIG } from '../src/modules/analytics/reports/config';
import { workspaceWide } from '../src/modules/analytics/reports/server/access';
import { nextReportRun, reportPeriod } from '../src/modules/analytics/reports/schedule-time';

const actor: ReportActor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks(); reset(); resetReportCapabilityCache();
  registerReportGeneration({ generation: { generate: async () => ({ ok: false, reason: 'unused' }) }, mail: { send: async () => ({ status: 'sent' }) }, eligible: async () => true });
});

describe('report templates', () => {
  it('rejects wrong confirmations and unknown fields before touching the database', async () => {
    await expect(manageReportTemplate(actor, { action: 'create', name: 'Weekly', sections: ['audience'], confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(manageReportTemplate(actor, { action: 'create', name: 'Weekly', sections: ['x'], confirmation: reportConfirmation.createTemplate('Weekly') })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(manageReportTemplate(actor, { action: 'delete', id: 't1', extra: 1, confirmation: reportConfirmation.deleteTemplate('t1') })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.queries).toHaveLength(0);
  });
  it('creates with workspace scope and an audit row holding no content', async () => {
    const result = await manageReportTemplate(actor, { action: 'create', name: 'Weekly', sections: ['audience', 'analysis'], rangeKey: '7d', confirmation: reportConfirmation.createTemplate('Weekly') });
    expect(result).toMatchObject({ ok: true, action: 'create' });
    expect(execs('INSERT INTO report_templates')[0]!.values).toContain('w1');
    const log = execs('activity_logs')[0]!;
    expect(log.values).toContain('w1'); expect(log.values).toContain('u1');
    expect(JSON.stringify(log.values)).not.toContain('Weekly');
  });
  it('does not let a new template advertise sections the shared readers cannot supply, but keeps legacy stored ones', async () => {
    await expect(manageReportTemplate(actor, { action: 'create', name: 'Goals', sections: ['goals'], rangeKey: '7d', confirmation: reportConfirmation.createTemplate('Goals') })).rejects.toMatchObject({ code: 'invalid_request' });
    // An existing template that already stores 'goals' may be renamed and keep it, but may not gain another unsupported section.
    state.templateSections = ['analysis', 'goals'];
    await expect(manageReportTemplate(actor, { action: 'update', id: 't1', name: 'Kept', sections: ['analysis', 'goals'], rangeKey: '7d', confirmation: reportConfirmation.updateTemplate('t1') })).resolves.toMatchObject({ ok: true });
    await expect(manageReportTemplate(actor, { action: 'update', id: 't1', name: 'Kept', sections: ['analysis', 'topPosts'], rangeKey: '7d', confirmation: reportConfirmation.updateTemplate('t1') })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it.each(['viewer', 'member'])('denies writes to role %s but allows listing', async role => {
    state.role = role;
    await expect(manageReportTemplate(actor, { action: 'delete', id: 't1', confirmation: reportConfirmation.deleteTemplate('t1') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.execs).toHaveLength(0);
    await expect(listReportTemplates(actor)).resolves.toMatchObject({ ok: true });
  });
  it('enforces entitlement, disabled account, membership, purge, a denied feature and a role revoked at lock time', async () => {
    const body = { action: 'delete', id: 't1', confirmation: reportConfirmation.deleteTemplate('t1') };
    state.entitled = false; await expect(manageReportTemplate(actor, body)).rejects.toMatchObject({ code: 'forbidden' });
    state.entitled = true; state.disabled = true; await expect(manageReportTemplate(actor, body)).rejects.toMatchObject({ code: 'unauthorized' });
    state.disabled = false; state.member = false; await expect(listReportTemplates(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    state.member = true; state.purge = 'running'; await expect(manageReportTemplate(actor, body)).rejects.toThrow();
    state.purge = null; state.lockRole = 'viewer';
    await expect(manageReportTemplate(actor, body)).rejects.toMatchObject({ code: 'unauthorized' });
    state.lockRole = null; state.freshDeny = ['analytics/reports'];
    await expect(manageReportTemplate(actor, body)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('applies a key permission ceiling that can only narrow', async () => {
    const readOnly = { ...actor, permissionCeiling: { deny: ['analytics/reports'] } as never };
    await expect(listReportTemplates(readOnly)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('enforces Root limits, uniqueness and missing/foreign templates', async () => {
    const big = 'N'.repeat(21);
    await expect(manageReportTemplate(actor, { action: 'create', name: big, sections: ['analysis'], confirmation: reportConfirmation.createTemplate(big) })).rejects.toMatchObject({ code: 'invalid_request' });
    state.count = 3; await expect(manageReportTemplate(actor, { action: 'create', name: 'X', sections: ['analysis'], confirmation: reportConfirmation.createTemplate('X') })).rejects.toMatchObject({ code: 'conflict' });
    state.count = 0; state.duplicate = true; await expect(manageReportTemplate(actor, { action: 'create', name: 'X', sections: ['analysis'], confirmation: reportConfirmation.createTemplate('X') })).rejects.toMatchObject({ code: 'conflict' });
    state.config['analytics.reports.maxTemplates'] = 0; await expect(listReportTemplates(actor)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('aborts the change when the audit write fails and detaches schedules on delete', async () => {
    state.auditThrows = true;
    await expect(manageReportTemplate(actor, { action: 'delete', id: 't1', confirmation: reportConfirmation.deleteTemplate('t1') })).rejects.toThrow('audit failed');
    state.auditThrows = false;
    const r = await manageReportTemplate(actor, { action: 'delete', id: 't1', confirmation: reportConfirmation.deleteTemplate('t1') });
    expect(r).toMatchObject({ detachedSchedules: 1 });
    expect(state.execs.some(e => e.sql.includes('SET "templateId" = NULL') && e.values.includes('w1'))).toBe(true);
  });
  it('lists one page with hasMore, drops unknown stored sections and names what a new choice may use', async () => {
    const r = await listReportTemplates(actor, { page: 1 });
    expect(r.templates).toHaveLength(2); expect(r.hasMore).toBe(true); expect(r.templates[0]!.sections).toEqual(['audience']);
    expect(r.selectableSections).toEqual(REPORT_SUPPORTED_SECTIONS);
    await expect(listReportTemplates(actor, { page: 0 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('bounds a key page by its result ceiling', async () => {
    const r = await listReportTemplates({ ...actor, maxResultItems: 1 });
    expect(r.templates).toHaveLength(1);
    await expect(listReportTemplates({ ...actor, maxResultItems: 0 })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('workspace-wide template authority', () => {
  it('refuses templates only to a SELECTED-RESOURCE key, not to a scoped session or an all-resource key', async () => {
    expect(workspaceWide(actor)).toBe(true);
    // A session with channel scope carries no key id: templates stay available.
    expect(workspaceWide({ allowedChannelIds: ['c1'] })).toBe(true);
    // A key with channel ceilings and no explicit flag is treated as selected-resource.
    expect(workspaceWide({ apiKeyId: 'k1', allowedChannelIds: ['c1'] })).toBe(false);
    // The host's explicit flag wins either way: an all-resource key keeps parity even with inherited limits.
    expect(workspaceWide({ apiKeyId: 'k1', allowedChannelIds: ['c1'], resourceRestricted: false })).toBe(true);
    expect(workspaceWide({ apiKeyId: 'k1', resourceRestricted: true })).toBe(false);
    state.scope = ['c1'];
    await expect(listReportTemplates({ ...actor, allowedChannelIds: ['c1'] })).resolves.toMatchObject({ ok: true });
    await expect(listReportTemplates({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'], resourceRestricted: false })).resolves.toMatchObject({ ok: true });
    await expect(listReportTemplates({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'], resourceRestricted: true })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(manageReportTemplate({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'] }, { action: 'delete', id: 't1', confirmation: reportConfirmation.deleteTemplate('t1') })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('report schedules', () => {
  const create = { action: 'create', channelId: 'c1', frequency: 'weekly', recipients: ['A@Example.com', 'a@example.com'], templateId: null, confirmation: reportConfirmation.createSchedule('c1', 'weekly') };
  it('creates in the workspace time zone, dedupes recipients, audits without addresses', async () => {
    const r = await manageReportSchedule(actor, create, new Date('2026-10-17T12:00:00Z'));
    expect(r).toMatchObject({ ok: true, action: 'create' });
    expect((r as { nextRunAt: Date }).nextRunAt.toISOString()).toBe('2026-10-19T08:00:00.000Z');
    expect(JSON.stringify(execs('activity_logs')[0]!.values)).not.toContain('example.com');
    expect(execs('INSERT INTO report_schedules')[0]!.values).toContainEqual(['a@example.com']);
  });
  it('does not offer a schedule that nothing could deliver', async () => {
    registerReportGeneration({ generation: { generate: async () => ({ ok: false, reason: 'unused' }) } });
    await expect(manageReportSchedule(actor, create)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('limits recipients, validates addresses, and checks the live channel scope and connection', async () => {
    await expect(manageReportSchedule(actor, { ...create, recipients: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(manageReportSchedule(actor, { ...create, recipients: ['not-an-email'] })).rejects.toMatchObject({ code: 'invalid_request' });
    state.freshScope = ['c9']; await expect(manageReportSchedule(actor, create)).rejects.toMatchObject({ code: 'invalid_request' });
    state.freshScope = null; state.usable = false; await expect(manageReportSchedule(actor, create)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.execs.some(e => e.sql.includes('INSERT'))).toBe(false);
  });
  it('rejects a template from another workspace and enforces the schedule limit', async () => {
    state.templateOk = false; await expect(manageReportSchedule(actor, { ...create, templateId: 'foreign' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.templateOk = true; state.count = 3; await expect(manageReportSchedule(actor, create)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('hides outside addresses from non-managers and filters by channel scope', async () => {
    state.role = 'viewer'; state.scope = ['c1'];
    const r = await listReportSchedules(actor);
    expect(r.canManage).toBe(false); expect(r.schedules[0]).toMatchObject({ recipientCount: 2, recipients: [], lastOutcome: 'never', channelAvailable: true });
    expect(state.queries.at(-1)!.values).toContainEqual(['c1']);
    state.scope = []; expect((await listReportSchedules(actor)).schedules).toEqual([]);
  });
  it('hides template names from a selected-resource key', async () => {
    state.scope = ['c1'];
    const r = await listReportSchedules({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'] });
    expect(r.schedules[0]).toMatchObject({ templateId: null, templateName: null });
    const wide = await listReportSchedules({ ...actor, apiKeyId: 'k1', allowedChannelIds: ['c1'], resourceRestricted: false });
    expect(wide.schedules[0]).toMatchObject({ templateId: 't1', templateName: 'Weekly' });
  });
  it('treats an out-of-scope or foreign schedule as not found on update and delete', async () => {
    state.freshScope = ['other'];
    await expect(manageReportSchedule(actor, { action: 'delete', id: 's1', confirmation: reportConfirmation.deleteSchedule('s1') })).rejects.toMatchObject({ code: 'not_found' });
    state.freshScope = null; state.found = false;
    await expect(manageReportSchedule(actor, { action: 'update', id: 's9', frequency: 'monthly', recipients: ['a@example.com'], templateId: null, confirmation: reportConfirmation.updateSchedule('s9') })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('fails closed on an invalid workspace time zone', async () => {
    state.tz = 'Mars/Base'; await expect(manageReportSchedule(actor, create)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('never nests a pooled transaction inside another', async () => {
    await manageReportSchedule(actor, create, new Date('2026-10-17T12:00:00Z'));
    expect(state.maxDepth).toBe(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('schedule time, MCP and config', () => {
  it('computes next weekly/monthly runs and previous periods in the workspace zone', () => {
    expect(nextReportRun('monthly', new Date('2026-10-17T00:00:00Z'), 'UTC', 1, '08:00').toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(nextReportRun('weekly', new Date('2026-10-17T00:00:00Z'), 'Africa/Casablanca', 1, '08:00').getTime()).toBeGreaterThan(Date.parse('2026-10-18T00:00:00Z'));
    expect(reportPeriod('monthly', new Date('2026-11-01T08:00:00Z'), 'UTC', 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });
  it('exposes write tools and routes MCP calls through the same confirmed services', async () => {
    expect(analyticsReportWriteTools.has('manage_report_template')).toBe(true);
    expect(analyticsReportToolDefinitions.map(t => t.name)).toEqual(expect.arrayContaining([...analyticsReportWriteTools]));
    await expect(executeAnalyticsReportTool(actor, 'manage_report_template', { action: 'delete', id: 't1', confirmation: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAnalyticsReportTool(actor, 'unknown', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('declares generate_report for both forms with their confirmations', () => {
    const tool = analyticsReportToolDefinitions.find(t => t.name === 'generate_report') as unknown as { description: string; inputSchema: { properties: Record<string, unknown>; required: string[] } };
    expect(Object.keys(tool.inputSchema.properties)).toEqual(expect.arrayContaining(['scheduleId', 'channelId', 'templateId', 'start', 'end', 'requestId', 'confirmation']));
    expect(tool.inputSchema.required).toEqual(['requestId', 'confirmation']);
    expect(tool.description).toContain('GENERATE REPORT <scheduleId>');
    expect(tool.description).toContain('GENERATE CHANNEL REPORT <channelId>');
  });
  it('declares every config entry as active with a default the schema accepts, and does not duplicate host-owned policy', () => {
    for (const e of REPORT_WORKFLOW_CONFIG) { expect(e.consumption).toBe('active'); expect(e.schema.safeParse(e.defaultValue).success).toBe(true); }
    const keys = REPORT_WORKFLOW_CONFIG.map(e => e.key);
    expect(keys).toContain('analytics.reports.outputRetentionHours');
    for (const owned of ['analytics.reports.ui', 'analytics.reports.deliveryEnabled', 'analytics.reports.schedule']) expect(keys).not.toContain(owned);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
