import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ROOT_INTERFACE_COPY } from '../src/lib/config/root-interface-copy';
const deps = vi.hoisted(() => ({ access: vi.fn(), counts: vi.fn(), diagnostics: vi.fn(), health: vi.fn(), locale: 'en' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': deps.locale }) }));
vi.mock('@/server/config/access', () => ({ requireRootPage: deps.access }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => ROOT_INTERFACE_COPY }));
vi.mock('@/server/root/read-model', () => ({ getRootOverview: deps.counts }));
vi.mock('@/modules/root/server/admin/backups', () => ({ readRootDiagnosticsSummary: deps.diagnostics }));
vi.mock('@/server/root/module-health', () => ({ loadRootModuleHealth: deps.health }));
vi.mock('@/modules/root/ui/RootFrame', () => ({ RootFrame: 'main' }));
vi.mock('@/components/RootMcpConnection', () => ({ RootMcpConnection: () => null }));
vi.mock('@/components/charts', () => ({ BarChart: ({ label }: { label: string }) => createElement('div', { role: 'img', 'aria-label': label }) }));
import Page from '../src/app/root/page';
beforeEach(() => {
  vi.clearAllMocks(); deps.locale = 'en'; deps.access.mockResolvedValue({ id: 'root' });
  deps.counts.mockResolvedValue({ users: 12, workspaces: 3, sources: 4, publishedPosts: 20, failedPosts: 2 });
  deps.diagnostics.mockResolvedValue({ errors: { openLast24h: 7 } });
  deps.health.mockResolvedValue({ modules: [{ kind: 'shared', worker: { status: 'pass' }, jobs: [{ freshness: 'pass', outcome: 'fail' }] }] });
});
it('renders shared metrics, a Root icon header, truthful job failure and stored counts chart', async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain('ui-page-header__titleline'); expect(html).toContain('data-module="root"');
  expect(html).toContain('ui-metric'); expect(html).toContain('Open errors · last 24 hours');
  expect(html).toContain('Needs attention'); expect(html).toContain('ui-badge--danger');
  expect(html).toContain('Failed or partly failed posts: 2');
  expect(html).toContain('Stored content and connection counts');
  expect(deps.health).toHaveBeenCalledWith('root', 'shared');
});
it('preserves unknown evidence as unavailable rather than zero or healthy', async () => {
  deps.counts.mockRejectedValue(new Error('private database details'));
  deps.diagnostics.mockResolvedValue({ errors: null }); deps.health.mockRejectedValue(new Error('unavailable'));
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Installation summary unavailable'); expect(html).toContain('Unknown');
  expect(html).toContain('is-unavailable'); expect(html).not.toContain('private database');
  expect(html).not.toContain('ui-badge--success');
});
it('reads French and registered Root interface copy', async () => {
  deps.locale = 'fr';
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('Centre de contrôle'); expect(html).toContain('Espaces de travail'); expect(html).toContain('À vérifier');
});
it('authorizes before any overview service reads', async () => {
  deps.access.mockRejectedValue(new Error('Root required'));
  await expect(Page()).rejects.toThrow('Root required');
  expect(deps.counts).not.toHaveBeenCalled(); expect(deps.diagnostics).not.toHaveBeenCalled(); expect(deps.health).not.toHaveBeenCalled();
});
