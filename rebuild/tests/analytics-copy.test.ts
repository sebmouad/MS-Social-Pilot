import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_MODULE_CONFIG } from '@/modules/analytics/config';
import { goalsCopyDefaults, reportCopyDefaults, downloadCopyDefaults, demographicsCopyDefaults, workspaceCopyDefaults, recordsCopyDefaults, errorCopyDefaults, workspaceCopySchema } from '@/modules/analytics/copy';
import { uiCopy } from '@/modules/analytics/ui/reports/copy';
import { goalsText } from '@/modules/analytics/goals/copy';
import { ComparisonFilters } from '@/modules/analytics/ui/compare/ComparisonFilters';
import { ReportDownloads } from '@/modules/analytics/ui/reports/ReportDownloads';
const read = vi.hoisted(() => vi.fn());
const language = vi.hoisted(() => ({ value: 'en' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': language.value }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: read }));

describe('Analytics Root customer catalogs', () => {
  const catalogs = { reportsCopy: reportCopyDefaults, goalsCopy: goalsCopyDefaults, downloadCopy: downloadCopyDefaults, demographicsCopy: demographicsCopyDefaults, workspaceCopy: workspaceCopyDefaults, recordsCopy: recordsCopyDefaults, errorCopy: errorCopyDefaults };
  it.each(Object.entries(catalogs))('declares a strict complete en/fr catalog for %s', (name, defaults) => {
    const entry = ANALYTICS_MODULE_CONFIG.find(entry => entry.key === `analytics.${name}`)!;
    expect(entry.kind).toBe('json'); expect(entry.consumption).toBe('active');
    expect(entry.schema.safeParse(defaults).success).toBe(true);
    for (const value of Object.values(defaults)) { expect(value.en.trim()).not.toBe(''); expect(value.fr.trim()).not.toBe(''); }
    const invalid = structuredClone(defaults) as Record<string, { en: string; fr?: string }>;
    delete invalid[Object.keys(invalid)[0]!]!.fr;
    expect(entry.schema.safeParse(invalid).success).toBe(false);
    expect(entry.schema.safeParse({ ...defaults, unexpected: { en: 'X', fr: 'X' } }).success).toBe(false);
  });
  it('reads the registered runtime catalogs for the request', async () => {
    read.mockImplementation(async (key: string) => ANALYTICS_MODULE_CONFIG.find(entry => entry.key === key)!.defaultValue);
    const { analyticsCopy } = await import('@/modules/analytics/server/copy');
    expect(await analyticsCopy()).toEqual({ reports: reportCopyDefaults, goals: goalsCopyDefaults, downloads: downloadCopyDefaults, demographics: demographicsCopyDefaults, workspace: workspaceCopyDefaults, records: recordsCopyDefaults, errors: errorCopyDefaults });
    expect(read.mock.calls.map(([key]) => key)).toEqual(Object.keys(catalogs).map(key => `analytics.${key}`));
  });
  it('uses Root edits in both languages and retains interpolation', () => {
    const reports = structuredClone(reportCopyDefaults);
    reports['Page {0}'] = { en: 'Sheet {0}', fr: 'Feuillet {0}' };
    expect(uiCopy('en', reports)('Page {0}', 3)).toBe('Sheet 3');
    expect(uiCopy('fr', reports)('Page {0}', 3)).toBe('Feuillet 3');
    const goals = structuredClone(goalsCopyDefaults); goals.perMonth.fr = '{label} chaque mois';
    expect(goalsText('fr', 'perMonth', { label: 'Vues' }, goals)).toBe('Vues chaque mois');
  });

  it('applies Root service errors in French and preserves codes and template values', async () => {
    const errors = structuredClone(errorCopyDefaults);
    errors['Choose a valid result page.'].fr = 'Choisissez une autre page.';
    errors['List at most {0} recipients.'].fr = 'Maximum {0} personnes.';
    read.mockImplementation(async () => errors); language.value = 'fr-FR';
    const { analyticsError, localizeAnalyticsError } = await import('@/modules/analytics/server/error-copy');
    const { OperationError } = await import('@/lib/operation-error');
    await expect(analyticsError('invalid_request', 'Choose a valid result page.')).resolves.toMatchObject({ code: 'invalid_request', message: 'Choisissez une autre page.' });
    await expect(localizeAnalyticsError(new OperationError('invalid_request', 'List at most 12 recipients.'))).resolves.toMatchObject({ code: 'invalid_request', message: 'Maximum 12 personnes.' });
    const unknown = new Error('private diagnostic'); expect(await localizeAnalyticsError(unknown)).toBe(unknown);
    language.value = 'en';
  });
  it('serializes edited copy into client filter and download controls', () => {
    const copy = structuredClone(workspaceCopyDefaults); copy.Compare.fr = 'Comparer les chiffres';
    expect(workspaceCopySchema.parse(copy)).toEqual(copy);
    const html = renderToStaticMarkup(createElement(ComparisonFilters, { copy, locale: 'fr', mode: 'period', channels: [], initial: { aStart: '', aEnd: '', bStart: '', bEnd: '', start: '', end: '', channel: [], groupA: [], groupB: [] } }));
    expect(html).toContain('Comparer les chiffres'); expect(html).toContain(workspaceCopyDefaults['Period A (UTC)'].fr);
    const downloads = structuredClone(downloadCopyDefaults); downloads.csv.fr = 'Obtenir les chiffres';
    expect(renderToStaticMarkup(createElement(ReportDownloads, { copy: downloads, locale: 'fr', prepared: { filename: 'report', csv: '', json: null, html: '' } }))).toContain('Obtenir les chiffres');
  });
});
