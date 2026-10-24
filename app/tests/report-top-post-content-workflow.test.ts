vi.mock('@/modules/analytics/reports/generation/copy-server', async () => ({ loadReportDocumentCopy: async () => ({ copy: (await import('@/modules/analytics/reports/generation/copy')).reportDocumentCopyDefaults.en, locale: 'en' }) }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ posts: vi.fn() }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: async () => ({ postPerformance: platform.posts }) }));

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

import { db, state, reset, resetGen, snapshot, gen, execs } from './report82-engine-harness';
import { TOP_POST_CONTENT_DEFAULTS } from '../src/modules/analytics/reports/config';
import { createReportGenerator } from '../src/modules/analytics/reports/generation/document';
import { registerReportGeneration, resetReportCapabilityCache, unregisterReportGeneration } from '../src/modules/analytics/reports/generation/registry';
import { runReportNow } from '../src/modules/analytics/reports/generation/runs';
import { executeAnalyticsReportTool } from '../src/modules/analytics/reports/mcp';
const original = db.$queryRaw.getMockImplementation()!;
const now = new Date('2026-10-21T10:00:00Z');
const actor = { userId: 'u1', workspaceId: 'w1' };
const content = { postId: 'post1', text: 'Destination text', media: [{ kind: 'image', url: 'https://cdn.example/image' }], link: 'https://article.example/', articleTitle: 'Read this article', articleDescription: 'Article context' };
beforeEach(() => {
  vi.clearAllMocks(); reset(); resetGen(); resetReportCapabilityCache(); vi.useFakeTimers(); vi.setSystemTime(now);
  state.config['analytics.reports.topPostContent'] = TOP_POST_CONTENT_DEFAULTS;
  state.config['app.publicOrigin'] = 'https://app.example'; state.templateSections = ['topPosts']; state.scheduleSections = ['topPosts'];
  gen.snapshot = snapshot({ period: { start: '2026-10-01', end: '2026-10-18' } });
  platform.posts.mockResolvedValue([{ postId: 'post1', text: 'Generic adapter text', publishedAt: new Date('2026-10-15T10:00Z'), url: 'https://social.example/post1', rankLabel: 'Engagement', rankValue: 5, measures: [], measuredAt: null }]);
  db.$queryRaw.mockImplementation(async (sql, ...args) => {
    const query = sql.join('?');
    if (query.includes('SELECT a.provider')) return [{ provider: 'p1' }];
    if (query.includes('pt."messageOverride"') && query.includes('ANY(')) return [content];
    return original(sql, ...args);
  });
  registerReportGeneration({ generation: createReportGenerator({ bounds: async () => ({ maxRows: 100, maxBytes: 20000 }) }) });
});
afterEach(() => { db.$queryRaw.mockImplementation(original); unregisterReportGeneration(); vi.useRealTimers(); });
describe('ranked content through the confirmed shared workflow', () => {
  it.each(['service', 'mcp'] as const)('releases all three details and audited receipts through %s', async surface => {
    const input = { channelId: 'c1', templateId: 't1', start: '2026-10-01', end: '2026-10-18', requestId: '6f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11', confirmation: 'GENERATE CHANNEL REPORT c1' };
    const output = (surface === 'service' ? await runReportNow(actor, input, now) : await executeAnalyticsReportTool(actor, 'generate_report', input)) as Awaited<ReturnType<typeof runReportNow>>;
    expect(output).toMatchObject({ ok: true, outcome: 'prepared' });
    expect(output.html).toContain('Destination text'); expect(output.html).toContain('https://cdn.example/image'); expect(output.html).toContain('Read this article');
    expect(output.html).not.toContain('Generic adapter text');
    expect(JSON.parse(output.json!).records.map((r: { record_type: string }) => r.record_type)).toEqual(expect.arrayContaining(['top_post_content', 'top_post_media', 'top_post_link']));
    expect(execs('activity_logs').some(row => row.values.includes('analytics.report_run_finished'))).toBe(true);
  });
  it('refuses bad consent or lost channel scope before reading ranked content', async () => {
    const input = { channelId: 'c1', templateId: 't1', start: '2026-10-01', end: '2026-10-18', requestId: '6f1d0b6e-0f4b-4c5d-8a43-2d5b1d1f6a11', confirmation: 'WRONG' };
    await expect(executeAnalyticsReportTool(actor, 'generate_report', input)).rejects.toMatchObject({ code: 'invalid_request' });
    state.scope = ['other'];
    await expect(runReportNow(actor, { ...input, confirmation: 'GENERATE CHANNEL REPORT c1' }, now)).rejects.toMatchObject({ code: 'unavailable' });
    expect(platform.posts).not.toHaveBeenCalled();
  });
  it('honors the key result ceiling when asking the platform for ranked posts', async () => {
    const generator = createReportGenerator({ bounds: async () => ({ maxRows: 100, maxBytes: 20000 }) });
    const out = await generator.generate({ actor: { ...actor, maxResultItems: 1 }, channelId: 'c1', sections: ['topPosts'], period: { start: '2026-10-01', end: '2026-10-18' } });
    expect(out.ok).toBe(true); expect(platform.posts).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    if (out.ok) expect(out.output.rowCount).toBeLessThanOrEqual(1);
  });
});
