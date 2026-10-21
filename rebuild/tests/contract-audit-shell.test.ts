import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: vi.fn(), language: 'fr', list: vi.fn(), detail: vi.fn(), viewer: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error('not found'); } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('@/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root' }) }));
vi.mock('@/server/root/legacy/errors', () => ({ listRootErrors: state.list, getRootError: state.detail }));
vi.mock('@/server/root/RootFrame', () => ({ RootFrame: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => createElement('main', null, controls, children) }));
vi.mock('@/server/root/RootFilters', () => ({
  RootFilters: ({ children }: { children: ReactNode }) => createElement('aside', null, children),
  RootFilterSelect: ({ options, name }: { options: { value: string; label: string }[]; name: string }) => createElement('select', { name }, options.map(item => createElement('option', { key: item.value, value: item.value }, item.label))),
}));
import Loading from '../src/app/loading';
import RootErrorsPage from '../src/app/root/errors/page';
import RootErrorPage from '../src/app/root/errors/[id]/page';
import { ROOT_ERROR_COPY, ROOT_ERROR_CONFIG } from '../src/app/root/errors/config';

beforeEach(() => {
  vi.clearAllMocks(); state.language = 'fr';
  state.config.mockImplementation(async (key: string) => {
    if (key === 'root.errorCopy') return ROOT_ERROR_COPY;
    if (key === 'ui.loadingCopy') return { en: 'Loading custom workspace', fr: 'Chargement personnalisé' };
    throw new Error('unregistered');
  });
});

describe('shell and Root error bilingual catalog consumers', () => {
  it('uses Root-provided French loading copy and retains an accessible busy state', async () => {
    const html = renderToStaticMarkup(await Loading());
    expect(html).toContain('Chargement personnalisé');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });
  it('keeps loading usable with localized fallback when config is unavailable', async () => {
    state.config.mockRejectedValue(new Error('offline'));
    expect(renderToStaticMarkup(await Loading())).toContain('Chargement de votre espace');
  });
  it('defines a validated Root error registration for the integrator', () => {
    const entry = ROOT_ERROR_CONFIG[0];
    expect(entry.key).toBe('root.errorCopy');
    expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
    expect(entry.schema.safeParse({ en: ROOT_ERROR_COPY.en }).success).toBe(false);
  });
  it('uses customized filter, unavailable and recovery labels on the real list page', async () => {
    state.list.mockRejectedValue(new Error('private error'));
    const catalog = structuredClone(ROOT_ERROR_COPY);
    catalog.fr.filterTitle = 'Filtres personnalisés'; catalog.fr.unavailable = 'Journal personnalisé indisponible'; catalog.fr.reset = 'Effacer la recherche';
    state.config.mockResolvedValue(catalog);
    const html = renderToStaticMarkup(await RootErrorsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Journal personnalisé indisponible');
    expect(html).toContain('Effacer la recherche');
    expect(html).toContain('Toutes les sources');
    expect(html).not.toContain('private error');
    expect(html).not.toContain('Errors unavailable');
  });
  it('localizes detail labels, status, absent stack and action labels', async () => {
    state.detail.mockResolvedValue({ id: 'error-1', source: 'server', name: 'Example', message: 'Synthetic message', count: 2, firstSeenAt: '2026-10-21', lastSeenAt: '2026-10-21', release: 'test', location: null, resolvedAt: null, stack: null });
    const html = renderToStaticMarkup(await RootErrorPage({ params: Promise.resolve({ id: 'error-1' }) }));
    expect(html).toContain('Première occurrence');
    expect(html).toContain('Aucune trace');
    expect(html).toContain('Marquer comme résolue');
    expect(html).not.toContain('No stack');
  });
});
