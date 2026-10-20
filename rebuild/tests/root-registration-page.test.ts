import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const h = vi.hoisted(() => ({ load: vi.fn(), locale: 'en' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': h.locale }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root' }) }));
vi.mock('../src/server/root/registration-admin', () => ({ listRootRegistration: h.load }));
vi.mock('../src/server/root/RootFrame', () => ({ RootFrame: ({ controls, children }: { controls: React.ReactNode; children: React.ReactNode }) => createElement('main', {}, createElement('aside', {}, controls), children) }));
import Page from '../src/app/root/registration/page';
const when = new Date('2026-10-20T10:00:00Z');
const data = {
  openRegistration: false, invitations: [
    { id: 'i1', email: 'pending@example.invalid', workspaceId: 'w1', workspaceName: 'Example', role: 'viewer', status: 'pending', createdAt: when, expiresAt: when, acceptedAt: null },
    { id: 'i2', email: 'accepted@example.invalid', workspaceId: 'w1', workspaceName: 'Example', role: 'viewer', status: 'accepted', createdAt: when, expiresAt: when, acceptedAt: when },
  ], accounts: [{ id: 'u1', name: 'Example', email: 'self@example.invalid', createdAt: when, disabledAt: null }],
  moreInvitations: true, moreAccounts: true, page: 2, accountsPage: 1, searchMaxCharacters: 40,
};
beforeEach(() => { vi.clearAllMocks(); h.locale = 'en'; h.load.mockResolvedValue(data); });
it('renders read-only configuration, independent paging, missing data and only valid actions', async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ status: 'pending', workspaceId: 'w1' }) }));
  expect(html).toContain('Closed'); expect(html).toContain('/root/config?search=auth.openRegistration');
  expect(html).toContain('Not available');
  expect(html.match(/<span>Revoke invitation<\/span>/g)).toHaveLength(1);
  expect(html).toContain('Delete account'); expect(html).not.toContain('Resend verification');
  expect(html).toContain('page=3'); expect(html).toContain('accountsPage=2');
  const sidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  expect(sidebar).toContain('name="status"'); expect(sidebar).toContain('name="workspaceId"');
  expect(html).toContain('role="region"');
});
it('renders French copy and resend when open', async () => {
  h.locale = 'fr-FR'; h.load.mockResolvedValue({ ...data, openRegistration: true });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('lang="fr"'); expect(html).toContain('Non disponible'); expect(html).toContain('Renvoyer la vérification');
});
it('masks database failure and rejects repeated filters without broadening the query', async () => {
  h.load.mockRejectedValue(new Error('private database credentials'));
  let html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('Not available'); expect(html).not.toContain('private database'); expect(html).toContain('Reload');
  h.load.mockClear();
  html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ status: ['pending', 'accepted'] }) }));
  expect(h.load).not.toHaveBeenCalled(); expect(html).toContain('could not be loaded');
});
it('has distinct empty states', async () => {
  h.load.mockResolvedValue({ ...data, invitations: [], accounts: [] });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('No invitations match'); expect(html).toContain('No unverified self-registrations match');
});
