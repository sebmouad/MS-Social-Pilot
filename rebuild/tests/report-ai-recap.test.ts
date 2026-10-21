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
vi.mock('@/server/data-control/guard', async () => ({ assertWorkspaceNotPurging: async () => undefined }));
vi.mock('../src/modules/analytics/server/read', async () => { const h = await import('./report82-engine-harness'); return { readAnalyticsSnapshot: h.readSnapshot }; });
// The provider is never reached: the AI module is mocked at its public service functions.
const ai = vi.hoisted(() => ({ summarize: vi.fn(), summaryAvailable: vi.fn() }));
vi.mock('@/modules/ai/server/ai', () => ai);

import { reset, resetGen, snapshot, state } from './report82-engine-harness';
import { createReportGenerator, recapFacts, renderReport, RECAP_LABEL, RECAP_UNAVAILABLE } from '../src/modules/analytics/reports/generation/document';
import { manageReportTemplate, listReportTemplates } from '../src/modules/analytics/reports/server/templates';
import { reportConfirmation, type ReportActor } from '../src/modules/analytics/reports/contracts';
import { OperationError } from '../src/lib/operation-error';
import { DEFAULT_REPORT_UI_POLICY } from '../src/modules/analytics/report-ui-config';
import { loadReportUiPolicy } from '../src/modules/analytics/server/report-ui-policy';

const actor: ReportActor = { userId: 'owner1', workspaceId: 'w1' };
const bounds = { maxRows: 100, maxBytes: 50000 };
const period = { start: '2026-10-12', end: '2026-10-18' };
const generator = (recap?: Parameters<typeof createReportGenerator>[0]['recap']) => createReportGenerator({ bounds: async () => bounds, now: () => new Date('2026-10-19T08:01:00Z'), recap });
const request = (sections: Array<'analysis' | 'published' | 'aiRecap'>) => ({ actor, channelId: 'c1', sections, period });

beforeEach(() => { vi.clearAllMocks(); reset(); resetGen(); });

describe('AI recap rendering', () => {
  const input = { channelName: 'P', sections: ['published' as const, 'aiRecap' as const], generatedAt: new Date('2026-10-19T00:00:00Z') };
  it('labels the generated text as AI-generated in HTML, text, CSV and JSON', () => {
    const out = renderReport(snapshot() as never, { ...input, recap: { state: 'ready', text: '=SUM(1) <b>Reach rose</b>' } }, bounds);
    expect(out.sections).toEqual(['published', 'aiRecap']); expect(out.notIncluded).toEqual([]);
    expect(out.html).toContain('<h2>AI recap</h2>'); expect(out.html).toContain('AI-generated.'); expect(out.html).toContain(RECAP_LABEL);
    expect(out.html).toContain('&lt;b&gt;Reach rose&lt;/b&gt;');
    expect(out.text).toContain('AI recap (AI-generated;'); expect(out.text).toContain('=SUM(1) <b>Reach rose</b>');
    expect(out.csv).toContain('"ai_recap","ai_recap","AI recap (AI-generated)"'); expect(out.csv).toContain(`"'=SUM(1) <b>Reach rose</b>"`);
    const rec = JSON.parse(out.json!).records.find((r: { record_type: string }) => r.record_type === 'ai_recap');
    expect(rec.metric).toBe('AI recap (AI-generated)'); expect(rec.source).toBe('AI-generated'); expect(rec.aggregation).toBe(RECAP_LABEL); expect(rec.value).toBe('=SUM(1) <b>Reach rose</b>');
  });
  it('says the recap is unavailable for this run and carries no text', () => {
    const out = renderReport(snapshot() as never, { ...input, recap: { state: 'unavailable' } }, bounds);
    expect(out.sections).toContain('aiRecap');
    expect(out.html).toContain(RECAP_UNAVAILABLE); expect(out.text).toContain(RECAP_UNAVAILABLE);
    const rec = JSON.parse(out.json!).records.find((r: { record_type: string }) => r.record_type === 'ai_recap');
    expect(rec.value).toBeNull(); expect(rec.aggregation).toBe(RECAP_UNAVAILABLE);
  });
  it('lists the recap as not included when AI gave no answer state (off, or no access)', () => {
    const out = renderReport(snapshot() as never, { ...input, recap: null }, bounds);
    expect(out.sections).toEqual(['published']); expect(out.notIncluded).toEqual(['aiRecap']);
    expect(out.html).toContain('Not included: aiRecap'); expect(out.html).not.toContain('AI recap');
    expect(out.csv).not.toContain('ai_recap');
  });
});

describe('AI recap facts', () => {
  it('contains only already-computed figures, never post text, and stays bounded', () => {
    const topPosts = [{ text: 'SECRET CUSTOMER POST TEXT', url: 'https://x.test/p', publishedAt: new Date(), rankLabel: 'Reach', rankValue: 99, measures: [] }];
    const many = snapshot({ allMetrics: Array.from({ length: 200 }, (_, i) => ({ ...snapshot().allMetrics[0]!, key: `k${i}`, label: `Metric ${i} ${'x'.repeat(100)}` })) });
    const facts = recapFacts(many as never, { sections: ['analysis', 'published', 'audience', 'topPosts'], topPosts: topPosts as never });
    expect(facts).toContain('Posts: published 2'); expect(facts).toContain('Audience: 5'); expect(facts).toContain('best has 99');
    expect(facts).not.toContain('SECRET'); expect(facts).not.toContain('x.test'); expect(facts).not.toContain('HYPERLINK');
    expect(facts.length).toBeLessThanOrEqual(4000);
  });
  it('is empty when no other section supplies a figure', () => {
    expect(recapFacts(snapshot() as never, { sections: ['aiRecap'] })).toBe('');
  });
});

describe('AI recap generation', () => {
  it('asks the AI module under the run actor with only facts and a subject, and renders the answer', async () => {
    const write = vi.fn(async () => ({ text: 'Reach was 10 across 1 channel.' }));
    const result = await generator(write).generate(request(['analysis', 'published', 'aiRecap']));
    expect(result.ok).toBe(true);
    const [who, req] = write.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(who).toEqual({ userId: 'owner1', workspaceId: 'w1', permissionCeiling: undefined });
    expect(Object.keys(req).sort()).toEqual(['facts', 'language', 'subject']);
    expect(req.subject).toBe('Page One, 2026-10-12 to 2026-10-18'); expect(String(req.facts)).toContain('Posts: published 2');
    if (result.ok) { expect(result.output.sections).toContain('aiRecap'); expect(result.output.html).toContain('Reach was 10 across 1 channel.'); expect(result.output.text).toContain('AI-generated'); }
  });
  it('defaults to the AI module summarize with the Reports feature, which authorizes the actor itself', async () => {
    ai.summarize.mockResolvedValue({ text: 'Short recap.' });
    const result = await generator().generate(request(['published', 'aiRecap']));
    expect(ai.summarize).toHaveBeenCalledTimes(1);
    expect(ai.summarize.mock.calls[0]![0]).toMatchObject({ userId: 'owner1', workspaceId: 'w1' });
    expect(ai.summarize.mock.calls[0]![2]).toEqual({ feature: 'analytics/reports' });
    expect(result.ok && result.output.html.includes('Short recap.')).toBe(true);
  });
  it.each(['conflict', 'upstream_failure', 'invalid_request'])('still succeeds when the recap fails with %s and invents nothing', async code => {
    const write = vi.fn(async () => { throw new OperationError(code as never, 'x'); });
    const result = await generator(write).generate(request(['published', 'aiRecap']));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.output.sections).toContain('aiRecap'); expect(result.output.html).toContain(RECAP_UNAVAILABLE); expect(result.output.csv).not.toContain('Reach was'); }
  });
  it('treats an empty answer or a plain crash as unavailable', async () => {
    for (const write of [vi.fn(async () => ({ text: '  ' })), vi.fn(async () => { throw new Error('boom'); })]) {
      const result = await generator(write).generate(request(['published', 'aiRecap']));
      expect(result.ok && result.output.html.includes(RECAP_UNAVAILABLE)).toBe(true);
    }
  });
  it.each(['unavailable', 'forbidden', 'unauthorized'])('lists the recap under not included when AI is off or not permitted (%s)', async code => {
    const write = vi.fn(async () => { throw new OperationError(code as never, 'x'); });
    const result = await generator(write).generate(request(['published', 'aiRecap']));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.output.sections).toEqual(['published']); expect(result.output.notIncluded).toEqual(['aiRecap']); expect(result.output.html).not.toContain('AI-generated'); }
  });
  it('does not call the AI module when only the recap is requested', async () => {
    const write = vi.fn();
    expect(await generator(write).generate(request(['aiRecap']))).toEqual({ ok: false, reason: 'no_supported_sections' });
    expect(write).not.toHaveBeenCalled();
  });
  it('does not call the AI module when the recap was not requested', async () => {
    const write = vi.fn();
    await generator(write).generate(request(['published']));
    expect(write).not.toHaveBeenCalled();
  });
});

describe('AI recap availability in customer choices', () => {
  it('offers the section only while AI assist is available to the actor', async () => {
    state.config['analytics.reports.ui'] = DEFAULT_REPORT_UI_POLICY;
    ai.summaryAvailable.mockResolvedValue(false);
    expect((await loadReportUiPolicy(actor)).sectionOptions.map(o => o.id)).not.toContain('aiRecap');
    expect((await loadReportUiPolicy(actor)).defaultSections).not.toContain('aiRecap');
    ai.summaryAvailable.mockResolvedValue(true);
    expect((await loadReportUiPolicy(actor)).sectionOptions.map(o => o.id)).toContain('aiRecap');
    ai.summaryAvailable.mockRejectedValue(new Error('down'));
    expect((await loadReportUiPolicy(actor)).sectionOptions.map(o => o.id)).not.toContain('aiRecap');
  });
  it('adds the label to a Root policy saved before the recap existed', async () => {
    const old = { ...DEFAULT_REPORT_UI_POLICY, sectionLabels: DEFAULT_REPORT_UI_POLICY.sectionLabels.filter(l => l.id !== 'aiRecap'), enabledSections: DEFAULT_REPORT_UI_POLICY.enabledSections.filter(id => id !== 'aiRecap') };
    state.config['analytics.reports.ui'] = old;
    ai.summaryAvailable.mockResolvedValue(true);
    expect((await loadReportUiPolicy(actor)).sectionOptions.map(o => o.id)).not.toContain('aiRecap'); // still not enabled by Root
  });
  it('refuses a new template choice of the recap while AI is off, accepts it while on, and keeps a stored one', async () => {
    const create = () => manageReportTemplate(actor, { action: 'create', name: 'Weekly', sections: ['published', 'aiRecap'], confirmation: reportConfirmation.createTemplate('Weekly') });
    ai.summaryAvailable.mockResolvedValue(false);
    await expect(create()).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await listReportTemplates(actor)).selectableSections).not.toContain('aiRecap');
    ai.summaryAvailable.mockResolvedValue(true);
    await expect(create()).resolves.toMatchObject({ ok: true });
    expect((await listReportTemplates(actor)).selectableSections).toContain('aiRecap');
    // An existing template that already stores the recap may be edited while AI is off (it keeps what it has).
    state.templateSections = ['published', 'aiRecap'];
    ai.summaryAvailable.mockResolvedValue(false);
    await expect(manageReportTemplate(actor, { action: 'update', id: 't1', name: 'Weekly', sections: ['published', 'aiRecap'], rangeKey: '30d', confirmation: reportConfirmation.updateTemplate('t1') })).resolves.toMatchObject({ ok: true });
  });
});
