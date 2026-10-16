import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ load: vi.fn(), runtime: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root-user' }) }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.runtime }));
vi.mock('../src/server/root/users', () => ({ loadRootUsers: state.load }));
vi.mock('../src/server/root/RootFrame', () => ({ RootFrame: 'main' }));
vi.mock('../src/components/SidebarDock', () => ({ SidebarDock: 'aside' }));
import Page from '../src/app/root/users/page';
import { OperationError } from '../src/lib/operation-error';

const user = {
  id: 'user-2', name: 'Casey Example', email: 'casey@example.test', isInstanceOwner: false,
  disabledAt: null, totpEnabledAt: new Date('2026-10-15T12:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'),
  _count: { memberships: 2, sessions: 3, passkeys: 1 },
};
const directory = { users: [user], total: 1, installationTotal: 14, query: 'casey', status: 'active' as const, page: 1, take: 25, searchMaxCharacters: 180 };

beforeEach(() => {
  vi.clearAllMocks();
  state.runtime.mockResolvedValue(180);
  state.load.mockResolvedValue(directory);
});

describe('Root users directory page', () => {
  it('puts search, status and pagination in the contextual sidebar and keeps counts distinct', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'casey', status: 'active' }) }));
    const sidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    for (const value of ['name="q"', 'maxLength="180"', 'name="status"', 'aria-label="User directory pages"']) expect(sidebar).toContain(value);
    expect(html).toContain('1 matching user · 14 in this installation');
    expect(html).toContain('Active sessions');
    expect(html).toContain('Authenticator: Enabled');
    expect(html).toContain('Passkeys: 1');
    expect(html).toContain('Installation owner');
    expect(state.load).toHaveBeenCalledWith('root-user', { q: 'casey', status: 'active' });
  });

  it('distinguishes an empty installation from filters with no matches', async () => {
    state.load.mockResolvedValueOnce({ ...directory, users: [], total: 0, query: '', status: 'all' });
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain('No users found');
    state.load.mockResolvedValueOnce({ ...directory, users: [], total: 0 });
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'absent' }) }))).toContain('No users match these filters');
  });

  it('keeps the sidebar and reset path for invalid filters and masks unavailable details', async () => {
    state.load.mockRejectedValueOnce(new OperationError('invalid_request', 'Filter rejected'));
    const invalid = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: ['first', 'second'] }) }));
    expect(invalid).toContain('Check user filters');
    expect(invalid).toContain('Reset filters');
    expect(invalid).toContain('Directory filters');
    state.load.mockRejectedValueOnce(new Error('postgres://private-password@host'));
    const unavailable = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(unavailable).toContain('User directory unavailable');
    expect(unavailable).not.toContain('private-password');
    expect(unavailable).toContain('Directory filters');
  });

  it('renders a horizontally scrollable, keyboard reachable table region', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('role="region" aria-label="User directory" tabindex="0"');
    expect(html).toContain('aria-label="User directory pages"');
  });
});
