import { beforeEach, describe, expect, it, vi } from 'vitest';
import { responseTimeCopyDefaults } from '@/modules/analytics/reports/generation/response-copy';
import { reportDocumentCopyDefaults, reportDocumentCatalogDefaults, reportDocumentCopySchema } from '@/modules/analytics/reports/generation/copy';
const state = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
import { loadReportDocumentCopy } from '@/modules/analytics/reports/generation/copy-server';
import { renderReport } from '@/modules/analytics/reports/generation/document';

const snapshot = { period: { start: '2026-10-01', end: '2026-10-10' }, allMetrics: [], audience: { covered: 0, selected: 1, entries: [], total: 0 }, publishing: { published: 2, scheduled: 1, failed: 0 } };
const input = { channelName: 'Example', sections: ['audience', 'published', 'topPosts'] as Array<'audience' | 'published' | 'topPosts'>, generatedAt: new Date('2026-10-11T12:00:00Z') };
const bounds = { maxRows: 100, maxBytes: 50000 };

describe('Root report document copy', () => {
  beforeEach(() => state.config.mockReset());
  it('requires complete, nonempty bilingual copy and preserves interpolation spacing', () => {
    const copy = reportDocumentCopySchema.parse(reportDocumentCatalogDefaults);
    expect(copy[' (stored for {v0} of {v1} posts)'].en).toMatch(/^ /);
    expect(reportDocumentCopySchema.safeParse({ ...copy, Audience: { en: 'Audience' } }).success).toBe(false);
    expect(reportDocumentCopySchema.safeParse({ ...copy, Audience: { ...copy.Audience, fr: ' ' } }).success).toBe(false);
  });
  it('loads Root language and renders French text, headings and unknown figures', async () => {
    state.config.mockImplementation(async key => key === 'analytics.reportDocumentLocale' ? 'fr' : key === 'analytics.responseTimeCopy' ? responseTimeCopyDefaults : reportDocumentCatalogDefaults);
    const { copy, locale } = await loadReportDocumentCopy();
    const out = renderReport(snapshot as never, input, bounds, copy, locale);
    expect(out.html).toContain('lang="fr"');
    expect(out.html).toContain('Rapport statistique');
    expect(out.html).toContain('<h2>Publications publiées</h2>');
    expect(out.html).toContain('Non disponible');
    expect(out.text).toContain('Publiées 2, planifiées 1, en échec 0.');
    expect(state.config).toHaveBeenCalledTimes(3);
  });
  it('treats Root copy as plain text in HTML and preserves configured byte bounds', () => {
    const copy = { ...reportDocumentCopyDefaults.en, 'Published posts': '<img src=x onerror=alert(1)>', unknown: '<b>missing date</b>' };
    const out = renderReport(snapshot as never, input, bounds, copy);
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out.html).not.toContain('<img src=x');
    const tiny = renderReport(snapshot as never, input, { maxRows: 1, maxBytes: 150 }, copy);
    expect(Buffer.byteLength(tiny.html)).toBeLessThanOrEqual(150);
    expect(tiny.truncated).toBe(true);
  });
});
