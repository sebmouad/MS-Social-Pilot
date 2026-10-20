import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ connections: vi.fn(), sessions: vi.fn(), errors: vi.fn(), workspaces: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 100 }));
vi.mock('@/server/root/legacy/connections', () => ({ listRootConnections: deps.connections }));
vi.mock('@/server/root/legacy/sessions', () => ({ listRootSessions: deps.sessions }));
vi.mock('@/server/root/legacy/errors', () => ({ listRootErrors: deps.errors }));
vi.mock('@/server/root/directory', () => ({ listRootWorkspaces: deps.workspaces }));
vi.mock('@/server/root/RootFrame', () => ({ RootFrame: ({ controls, children }: { controls: ReactNode; children: ReactNode }) => createElement('main', null, createElement('aside', null, controls), children) }));
vi.mock('@/components/SidebarDock', () => ({ SidebarDock: 'aside' }));
import Connections from '../src/app/root/connections/page';
import Sessions from '../src/app/root/sessions/page';
import Errors from '../src/app/root/errors/page';
import Workspaces from '../src/app/root/workspaces/page';
beforeEach(() => {
  vi.clearAllMocks();
  const page = { total: 1, page: 1, pageSize: 25, limits: { searchMaxCharacters: 100 } };
  deps.connections.mockResolvedValue({ ...page, items: [{ id: 'connection', name: 'Demo source', platformName: 'Demo', installed: true, workspace: { name: 'Example' }, state: 'connected', invalidReason: null, channels: { selected: 2, discovered: 3 }, scopeCount: 4, tokenExpiresAt: null }] });
  deps.sessions.mockResolvedValue({ ...page, truncated: false, limit: 25, items: [{ id: 'session', user: { name: 'Example owner', email: 'owner@example.test', installationOwner: true, disabled: false }, verified: true, current: false, expiresAt: '2026-10-22T00:00:00.000Z' }] });
  deps.errors.mockResolvedValue({ ...page, items: [{ id: 'error', name: 'Example error', message: 'Safe summary', location: null, source: 'worker', count: 2, lastSeenAt: '2026-10-20T00:00:00.000Z', resolvedAt: null }] });
  deps.workspaces.mockResolvedValue({ workspaces: [{ id: 'workspace', name: 'Example workspace', slug: 'example', timezone: 'UTC', suspendedAt: null, dataPurge: null, _count: { memberships: 2, targets: 3, posts: 5, adAccounts: 1 } }], total: 1, page: 1, take: 25, query: '' });
});
it.each([
  ['connections', Connections], ['sessions', Sessions], ['errors', Errors], ['workspaces', Workspaces],
] as const)('renders %s as a shared phone-card table with an icon heading', async (_name, Page) => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('ui-table--stack'); expect(html).toContain('data-label=');
  expect(html).toContain('ui-page-header__chip'); expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain('ui-filter-panel');
  if (_name === 'connections') { expect(html).toContain('Refresh token'); expect(html).toContain('Disconnect'); expect(html).toContain('Demo source'); }
  if (_name === 'sessions') expect(html).toContain('Sign out');
  if (_name === 'errors') expect(html).toContain('Mark resolved');
});
it('gives empty connection results an icon and a next action without hiding filters', async () => {
  deps.connections.mockResolvedValue({ items: [], total: 0, limits: { searchMaxCharacters: 100 } });
  const html = renderToStaticMarkup(await Connections({ searchParams: Promise.resolve({ q: 'missing' }) }));
  expect(html).toContain('ui-state__icon'); expect(html).toContain('Reset filters'); expect(html).toContain('value="missing"');
});
