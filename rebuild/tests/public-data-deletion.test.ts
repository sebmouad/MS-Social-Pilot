import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ language: 'en', content: null as unknown, operator: null as unknown, status: null as unknown, maxCode: 100 }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': mocks.language }) }));
vi.mock('../src/modules/history/server/site', () => ({ loadSiteContent: async () => mocks.content, loadOperator: async () => mocks.operator, siteIsPublic: async () => true }));
vi.mock('../src/server/platforms/deletion-status', () => ({ deletionRequestStatus: async () => mocks.status }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => mocks.maxCode }));

import { OPERATOR_DEFAULTS, SITE_CONTENT_DEFAULTS, frenchTypography } from '../src/modules/history/public/content';
import { DataDeletionPage, pageMetadata } from '../src/modules/history/ui/public-pages';

const page = async (code?: string) => renderToStaticMarkup(await DataDeletionPage({ searchParams: Promise.resolve(code === undefined ? {} : { code }) }));

describe('data-deletion lookup page', () => {
  beforeEach(() => {
    mocks.language = 'en';
    mocks.content = SITE_CONTENT_DEFAULTS.en;
    mocks.operator = { operator: { ...OPERATOR_DEFAULTS, productName: 'MS Social Pilot' }, appUrl: '' };
    mocks.status = null;
    mocks.maxCode = 100;
  });
  it('renders the shipped English outcome sentences with the count and date filled', async () => {
    mocks.status = { state: 'completed', connections: 1, completedAt: new Date('2026-10-20T00:00:00Z') };
    expect(await page('some-code')).toContain('Done on October 20, 2026. We removed the stored access for 1 connection and stopped its scheduled work.');
    mocks.status = { state: 'completed', connections: 3, completedAt: new Date('2026-10-20T00:00:00Z') };
    expect(await page('some-code')).toContain('Done on October 20, 2026. We removed the stored access for 3 connections and stopped its scheduled work.');
    mocks.status = { state: 'unknown' };
    expect(await page('some-code')).toContain('We found no record for this code.');
    mocks.status = { state: 'invalid' };
    expect(await page('some-code')).toContain('This code is not valid. Open the link shown in your Facebook settings again.');
  });
  it('renders Root-edited outcome sentences as text, never markup', async () => {
    const edited = structuredClone(SITE_CONTENT_DEFAULTS.en);
    edited.dataDeletion.resultCompletedMany = 'Edited many: {count} on {when}.';
    edited.dataDeletion.resultUnknown = 'Edited <b>unknown</b>.';
    mocks.content = edited;
    mocks.status = { state: 'completed', connections: 2, completedAt: new Date('2026-10-20T00:00:00Z') };
    expect(await page('some-code')).toContain('Edited many: 2 on October 20, 2026.');
    mocks.status = { state: 'unknown' };
    const html = await page('some-code');
    expect(html).toContain('Edited &lt;b&gt;unknown&lt;/b&gt;.');
    expect(html).not.toContain('<b>unknown</b>');
  });
  it('renders the French outcome sentences for French browsers', async () => {
    mocks.language = 'fr';
    mocks.content = frenchTypography(SITE_CONTENT_DEFAULTS.fr);
    mocks.status = { state: 'completed', connections: 2, completedAt: new Date('2026-10-20T00:00:00Z') };
    expect(await page('some-code')).toContain('Terminé le 20 octobre 2026. Nous avons supprimé l’accès enregistré pour 2 connexions et arrêté ses tâches planifiées.');
    mocks.status = { state: 'invalid' };
    expect(await page('some-code')).toContain('Ce code n’est pas valide. Ouvrez à nouveau le lien affiché dans vos paramètres Facebook.');
  });
  it('falls back to the shipped sentences when the saved catalog predates them', async () => {
    const legacy = structuredClone(SITE_CONTENT_DEFAULTS.en);
    delete legacy.dataDeletion.resultCompletedOne;
    delete legacy.dataDeletion.resultCompletedMany;
    delete legacy.dataDeletion.resultUnknown;
    delete legacy.dataDeletion.resultInvalid;
    mocks.content = legacy;
    mocks.status = { state: 'completed', connections: 1, completedAt: new Date('2026-10-20T00:00:00Z') };
    expect(await page('some-code')).toContain('Done on October 20, 2026. We removed the stored access for 1 connection and stopped its scheduled work.');
    mocks.status = { state: 'unknown' };
    expect(await page('some-code')).toContain('We found no record for this code.');
  });
  it('shows no outcome without a code and never indexes the lookup or leaks it as a referrer', async () => {
    expect(await page()).not.toContain('role="status"');
    await expect(pageMetadata('dataDeletion')).resolves.toMatchObject({ robots: { index: false, follow: false }, referrer: 'no-referrer' });
  });
});
