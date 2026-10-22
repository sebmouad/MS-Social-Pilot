// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: vi.fn(), list: vi.fn(), thread: vi.fn(), manage: vi.fn(), workflow: vi.fn(), language: 'en', refresh: vi.fn(), replace: vi.fn(),
  commentRows: vi.fn(async () => [] as unknown[]),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh, replace: state.replace }) }));
vi.mock('@/modules/shell/server/chrome', () => ({ shellChrome: async () => ({ copy: { moreTabs: 'More' }, policy: {}, locale: 'en' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'inbox.progressivePageLimit' ? 3 : 180 }));
vi.mock('@/modules/inbox/server/details', () => ({ readInboxContactDetails: async () => null }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/inbox/ui/scope', () => ({ inboxScope: async (viewer: { permissions: { pageScope: { all: boolean; ids: string[] } } }) => ({ ids: [], constraints: viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids }, param: undefined }) }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ sidebar, children }: { sidebar: import('react').ReactNode; children: import('react').ReactNode }) => createElement('main', null, createElement('aside', null, sidebar), children) }));
vi.mock('@/modules/inbox/server/read', async importOriginal => ({ ...await importOriginal<typeof import('../src/modules/inbox/server/read')>(), readInboxList: state.list, readInboxThread: state.thread }));
vi.mock('@/modules/inbox/server/actions', () => ({ canManageInbox: state.manage, canManageInboxWorkflow: state.workflow }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: async () => ({ reply: true, hide: true, remove: false }) }));
vi.mock('@/modules/inbox/server/policy', () => ({ inboxReplyPolicy: async () => ({ allowed: true, headline: 'Replies are open' }) }));
vi.mock('../src/modules/inbox/ui/ThreadTools', () => ({ ThreadTools: () => null }));

import InboxPage from '../src/modules/inbox/ui/InboxScreen';
import { ThreadToolbar } from '../src/modules/inbox/ui/InboxActions';
import { ThreadProductivity } from '../src/modules/inbox/components/ThreadProductivity';
import { ToastProvider } from '../src/components/Toast';
import { InboxTag } from '../src/modules/inbox/ui/InboxTags';
import { inboxCopy } from '../src/modules/inbox/ui/copy';
import { actionCopy } from '../src/modules/inbox/ui/action-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (key: string, over: Record<string, unknown> = {}) => ({
  key, kind: 'comment', id: key.split(':')[1], author: 'Amina', preview: 'Love it', time: new Date('2026-10-20T09:00:00Z'), rating: null, recommendation: null,
  target: { id: 'channel', name: 'Atelier', provider: 'facebook' }, unread: 0, needsReply: false, resolved: false, hidden: false, context: null, sentiment: null, ...over,
});
const listPage = (items: unknown[], filters = {}) => ({ items, total: items.length, limit: 25, cursor: null, olderCursor: null, newerCursor: null, filters: { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '', ...filters }, channels: [{ id: 'channel', name: 'Atelier' }], lastSynced: new Date('2026-10-20T08:00:00Z'), timeZone: 'UTC', limits: { listPageSize: 25, threadPageSize: 50, searchMaxCharacters: 200, cursorMaxCharacters: 4096 } });
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await InboxPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.clearAllMocks(); state.language = 'en';
  state.viewer.mockResolvedValue({ user: { id: 'reader' }, workspaceId: 'workspace', permissions: { pageScope: { all: true, ids: [] } }, membership: { workspace: { timezone: 'UTC' } } });
  state.list.mockResolvedValue(listPage([]));
  state.manage.mockResolvedValue(true); state.workflow.mockResolvedValue(true);
});

describe('sentiment in the read model', () => {
  it('shows only the three classifier outputs; anything else stored is unknown, never neutral', async () => {
    const { storedSentiment } = await import('../src/modules/inbox/server/read');
    expect(storedSentiment('positive')).toBe('positive');
    expect(storedSentiment('neutral')).toBe('neutral');
    expect(storedSentiment('negative')).toBe('negative');
    expect(storedSentiment(null)).toBeNull();
    expect(storedSentiment('angry')).toBeNull();
    expect(storedSentiment('')).toBeNull();
  });

  it('renders a sentiment chip with a word, tone and explanation only when the item is classified', async () => {
    state.list.mockResolvedValue(listPage([item('comment:1', { sentiment: 'negative' }), item('comment:2', { sentiment: 'positive' }), item('comment:3', { sentiment: null }), item('message:4', { kind: 'message', sentiment: null })]));
    const html = await render();
    expect(html).toContain('>Negative<');
    expect(html).toContain('>Positive<');
    expect(html).toContain('ui-badge--danger');
    expect(html).toContain('title="Classified automatically from the comment text"');
    expect((html.match(/Classified automatically/g) ?? []).length).toBe(2);
    expect(html).not.toContain('>Neutral<');
  });

  it('labels every sentiment in French', () => {
    expect(inboxCopy.fr.sentiment).toEqual({ positive: 'Positif', neutral: 'Neutre', negative: 'Négatif' });
    expect(renderToStaticMarkup(createElement(InboxTag, { icon: 'negative', tone: 'danger', children: 'Négatif' }))).toContain('Négatif');
  });
});

describe('Inbox language and shared components', () => {
  it('renders the French screen from the request language, including filters and empty state', async () => {
    state.language = 'fr-FR,fr;q=0.9';
    state.list.mockResolvedValue(listPage([], { kind: 'comment' }));
    const html = await render();
    expect(html).toContain('Règles');
    expect(html).toContain('Filtres rapides');
    expect(html).toContain('Réinitialiser les filtres');
    expect(html).toContain('Aucun résultat pour ces filtres');
    expect(html).toContain('Filtres actifs');
    expect(html).not.toContain('Nothing matches these filters');
  });

  it('shows applied filters as removable chips and keeps the filter form a plain GET form', async () => {
    state.list.mockResolvedValue(listPage([item('comment:1')], { kind: 'comment', q: 'refund' }));
    const html = await render();
    expect(html).toContain('ui-filter-chip');
    expect(html).toContain('aria-label="Remove filter: Type Comments"');
    expect(html).toContain('aria-label="Remove filter: Search refund"');
    expect(html).toMatch(/<form[^>]*method="get"/);
    // The one Filter button carries the count; its fields open from it.
    expect(html).toContain('ui-filter-button is-active');
    expect(html).toContain('name="q" value="refund"');
  });

  it('has an English and a French string for every screen and action key', () => {
    expect(Object.keys(inboxCopy.fr).sort()).toEqual(Object.keys(inboxCopy.en).sort());
    expect(Object.keys(actionCopy.fr).sort()).toEqual(Object.keys(actionCopy.en).sort());
  });
});

describe('resolve with undo', () => {
  let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const mount = (locale: 'en' | 'fr' = 'en') => act(async () => root.render(createElement(ToastProvider, null, createElement(ThreadToolbar, { id: 'thread-1', kind: 'comment', resolved: false, hidden: false, canResolve: true, canHide: true, canDelete: false, platformName: 'Example', listHref: '/inbox', locale }))));
  const bodies = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));

  it('resolves immediately, offers Undo, and undo reopens through the same service', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetcher);
    await mount();
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Mark resolved')!.click());
    expect(bodies(fetcher)).toEqual([{ action: 'resolve', id: 'thread-1', kind: 'comment', resolved: true }]);
    const undo = [...document.querySelectorAll('button')].find(button => button.textContent === 'Undo')!;
    expect(undo).toBeTruthy();
    await act(async () => undo.click());
    expect(bodies(fetcher)[1]).toEqual({ action: 'resolve', id: 'thread-1', kind: 'comment', resolved: false });
    expect(state.refresh).toHaveBeenCalled();
  });

  it('keeps a failed resolve retryable from the toast without losing the page', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetcher);
    await mount();
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Mark resolved')!.click());
    expect(container.querySelector('[role=alert]')?.textContent).toBe(actionCopy.en.uncertain);
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent === 'Try again')!;
    await act(async () => retry.click());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('speaks French in the toolbar', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mount('fr');
    expect(container.textContent).toContain('Marquer comme résolue');
    expect(container.textContent).toContain('Masquer le commentaire');
  });
});

describe('saved replies', () => {
  let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const productivity = { ok: true, assignment: { assigneeId: null, members: [{ id: 'm1', name: 'Samir' }] }, notes: [], limits: { noteMaxCharacters: 100, savedReplyNameMaxCharacters: 40, savedReplyBodyMaxCharacters: 300 } };
  const stub = (replies: unknown[]) => vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=saved-replies') ? { ok: true, replies } : productivity })));

  it('explains the empty state and still allows creating the first saved reply', async () => {
    stub([]);
    await act(async () => root.render(createElement(ToastProvider, null, createElement(ThreadProductivity, { kind: 'comment', id: 'c1' }))));
    expect(container.textContent).toContain('No saved replies yet');
    expect(container.querySelector('[aria-label="Saved reply name"]')).not.toBeNull();
  });

  it('keeps Use reply visible and tucks Edit and Delete into a labelled row menu, in French too', async () => {
    stub([{ id: 'r1', name: 'Merci', body: 'Merci pour votre message' }]);
    const use = vi.fn();
    await act(async () => root.render(createElement(ToastProvider, null, createElement(ThreadProductivity, { kind: 'comment', id: 'c1', locale: 'fr', onUseSavedReply: use }))));
    expect(container.textContent).toContain('Réponses enregistrées');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Utiliser la réponse')!.click());
    expect(use).toHaveBeenCalledWith('Merci pour votre message');
    const menu = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Actions pour Merci');
    await act(async () => menu.click());
    expect([...document.querySelectorAll('[role="menuitem"]')].map(entry => entry.textContent)).toEqual(['Modifier', 'Supprimer']);
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });
});
