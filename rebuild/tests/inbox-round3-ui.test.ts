// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bulk: vi.fn(), refresh: vi.fn(),
  viewer: vi.fn(), list: vi.fn(), thread: vi.fn(), manage: vi.fn(), workflow: vi.fn(), details: vi.fn(), language: 'en',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh, replace: vi.fn() }) }));
vi.mock('../src/modules/inbox/ui/bulk-action', () => ({ runBulkInboxAction: state.bulk }));
vi.mock('@/modules/shell/server/chrome', () => ({ shellChrome: async () => ({ copy: { moreTabs: 'More' }, policy: {}, locale: 'en' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'inbox.progressivePageLimit' ? 3 : 180 }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/inbox/ui/scope', () => ({ inboxScope: async (viewer: { permissions: { pageScope: { all: boolean; ids: string[] } } }) => ({ ids: [], constraints: viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids }, param: undefined }) }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children }: { children: import('react').ReactNode }) => h('main', null, children) }));
vi.mock('@/modules/inbox/server/read', async importOriginal => ({ ...await importOriginal<typeof import('../src/modules/inbox/server/read')>(), readInboxList: state.list, readInboxThread: state.thread }));
vi.mock('@/modules/inbox/server/details', () => ({ readInboxContactDetails: state.details }));
vi.mock('@/modules/inbox/server/actions', () => ({ canManageInbox: state.manage, canManageInboxWorkflow: state.workflow }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: async () => ({ reply: true, hide: true, remove: true }) }));
vi.mock('@/modules/inbox/server/policy', () => ({ inboxReplyPolicy: async () => ({ allowed: true, headline: 'Replies are open' }) }));
vi.mock('../src/modules/inbox/ui/ThreadTools', () => ({ ThreadTools: () => null }));

import InboxPage from '../src/modules/inbox/ui/InboxScreen';
import { BulkBar } from '../src/modules/inbox/ui/BulkBar';
import { InboxSelectionProvider, SelectBox, type SelectableItem } from '../src/modules/inbox/ui/InboxSelection';
import { SavedRepliesManager } from '../src/modules/inbox/ui/SavedRepliesManager';
import { InboxShortcuts } from '../src/modules/inbox/ui/InboxShortcuts';
import { ContactDetails } from '../src/modules/inbox/ui/ContactDetails';
import { ToastProvider } from '../src/components/Toast';
import { round3Copy } from '../src/modules/inbox/ui/round3-copy';
import { sentimentTrend, type InboxContactDetails } from '../src/modules/inbox/details';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

let root: Root | null = null; let host: HTMLElement | null = null;
async function mount(node: import('react').ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(h(ToastProvider, null, node)); });
}
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const click = (element: Element | null) => act(async () => { (element as HTMLElement).click(); });
const text = () => document.body.textContent ?? '';
// Exact name first; a button that also carries a keycap ("Clear selectionEsc") matches by its leading text.
const button = (label: string) => {
  const all = [...document.querySelectorAll('button')];
  return all.find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label) ?? all.find(item => item.textContent?.trim().startsWith(label)) ?? null;
};

const selectable = (id: string, over: Partial<SelectableItem> = {}): SelectableItem => ({ key: `comment:${id}`, kind: 'comment', id, label: `Person ${id}`, platformName: 'Facebook', resolved: false, hidden: false, can: { resolve: true, hide: true, remove: true, assign: true }, ...over });
const bar = (items: SelectableItem[], max = 5) => h(InboxSelectionProvider, { pageItems: items, children: [...items.map(item => h(SelectBox, { key: item.key, item, label: `Select ${item.label}` })), h(BulkBar, { key: 'bar', locale: 'en', maxItems: max })] });

beforeEach(() => {
  vi.clearAllMocks(); state.language = 'en';
  state.bulk.mockImplementation(async (input: { action: string; items: Array<{ kind: string; id: string }> }) => ({ ok: true, action: input.action, requested: input.items.length, succeeded: input.items.length, failed: 0, results: input.items.map(item => ({ ...item, ok: true })) }));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; });

describe('bulk bar', () => {
  it('lists only actions that fit the whole selection and resolves at once with an exact confirmation and Undo', async () => {
    await mount(bar([selectable('c1'), selectable('c2')]));
    expect(button('Resolve')).toBeNull();
    await click(document.querySelector('input[aria-label="Select Person c1"]'));
    expect(text()).toContain('1 selected');
    await click(button('Resolve'));
    expect(state.bulk).toHaveBeenCalledWith({ action: 'resolve', items: [{ kind: 'comment', id: 'c1' }], confirmation: 'BULK RESOLVE 1 INBOX ITEMS' });
    expect(text()).toContain('Resolved 1 item.');
    expect(state.refresh).toHaveBeenCalled();
    await click(button('Undo'));
    expect(state.bulk).toHaveBeenLastCalledWith({ action: 'reopen', items: [{ kind: 'comment', id: 'c1' }], confirmation: 'BULK REOPEN 1 INBOX ITEMS' });
    expect(text()).toContain('Undone.');
  });

  it('asks before hiding, names the platform and consequence, and offers Undo after', async () => {
    await mount(bar([selectable('c1'), selectable('c2')]));
    await click(document.querySelector('input[aria-label="Select all on this page"]'));
    expect(text()).toContain('2 selected');
    await click(button('Hide'));
    expect(state.bulk).not.toHaveBeenCalled();
    expect(text()).toContain('2 comments will be hidden on Facebook. You can show them again.');
    expect(document.activeElement?.textContent).toBe('Cancel');
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Hide comments') ?? null);
    expect(state.bulk).toHaveBeenCalledWith({ action: 'hide', items: [{ kind: 'comment', id: 'c1' }, { kind: 'comment', id: 'c2' }], confirmation: 'BULK HIDE 2 INBOX ITEMS' });
    await flush();
    expect(text()).toContain('Hid 2 comments.');
    expect(button('Undo')).not.toBeNull();
  });

  it('warns that deletion cannot be undone and offers no Undo', async () => {
    await mount(bar([selectable('c1')]));
    await click(document.querySelector('input[aria-label="Select Person c1"]'));
    await click(button('Delete'));
    expect(text()).toContain('This cannot be undone.');
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Delete comments') ?? null);
    await flush();
    expect(state.bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', confirmation: 'BULK DELETE 1 INBOX ITEMS' }));
    expect(text()).toContain('Deleted 1 comment.');
    expect(button('Undo')).toBeNull();
  });

  it('keeps the confirmation open with the reason when nothing could be applied', async () => {
    state.bulk.mockResolvedValue({ ok: true, action: 'hide', requested: 1, succeeded: 0, failed: 1, results: [{ kind: 'comment', id: 'c1', ok: false, code: 'forbidden', error: 'You cannot moderate this channel.' }] });
    await mount(bar([selectable('c1')]));
    await click(document.querySelector('input[aria-label="Select Person c1"]'));
    await click(button('Hide'));
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Hide comments') ?? null);
    await flush();
    expect(document.querySelector('dialog')?.textContent).toContain('You cannot moderate this channel.');
    expect(text()).toContain('1 selected');
  });

  it('keeps failed items selected after a partial result', async () => {
    state.bulk.mockResolvedValue({ ok: true, action: 'resolve', requested: 2, succeeded: 1, failed: 1, results: [{ kind: 'comment', id: 'c1', ok: true }, { kind: 'comment', id: 'c2', ok: false, code: 'not_found', error: 'Gone.' }] });
    await mount(bar([selectable('c1'), selectable('c2')]));
    await click(document.querySelector('input[aria-label="Select all on this page"]'));
    await click(button('Resolve'));
    expect(text()).toContain('1 done, 1 could not be updated.');
    expect(text()).toContain('1 selected');
    expect((document.querySelector('input[aria-label="Select Person c2"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[aria-label="Select Person c1"]') as HTMLInputElement).checked).toBe(false);
  });

  it('shows a mixed-selection note instead of actions that do not apply, and enforces the Root limit', async () => {
    const message = selectable('m1', { key: 'message:m1', kind: 'message', can: { resolve: true, hide: false, remove: false, assign: true } });
    await mount(bar([selectable('c1', { can: { resolve: false, hide: true, remove: false, assign: false } }), message], 1));
    await click(document.querySelector('input[aria-label="Select all on this page"]'));
    expect(text()).toContain('2 selected');
    expect(text()).toContain('You can act on up to 1 items at a time.');
    expect(button('Hide')).toBeNull();
    expect(text()).toContain('The selection mixes items this action does not apply to.');
    await click(button('Clear selection'));
    expect(text()).not.toContain('selected');
  });

  it('reports an unreachable server instead of claiming success', async () => {
    state.bulk.mockRejectedValue(new Error('network'));
    await mount(bar([selectable('c1')]));
    await click(document.querySelector('input[aria-label="Select Person c1"]'));
    await click(button('Resolve'));
    expect(text()).toContain('Could not update the selection');
    expect(button('Retry')).not.toBeNull();
    expect(text()).toContain('1 selected');
  });

  it('assigns the selection to a chosen teammate with one exact confirmation and no Undo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, assignment: { assigneeId: null, members: [{ id: 'u1', name: 'Nadia' }, { id: 'u2', name: null }] } })));
    await mount(bar([selectable('c1'), selectable('c2')]));
    await click(document.querySelector('input[aria-label="Select all on this page"]'));
    await click(button('Assign'));
    expect(state.bulk).not.toHaveBeenCalled();
    expect(text()).toContain('2 items will be unassigned.');
    await click(document.querySelector('[role="combobox"]'));
    await click([...document.querySelectorAll('[role="option"]')].find(item => item.textContent === 'Nadia') ?? null);
    expect(text()).toContain('2 items will be assigned to Nadia.');
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Assign') ?? null);
    await flush();
    expect(state.bulk).toHaveBeenCalledWith({ action: 'assign', items: [{ kind: 'comment', id: 'c1' }, { kind: 'comment', id: 'c2' }], assigneeId: 'u1', confirmation: 'BULK ASSIGN 2 INBOX ITEMS TO u1' });
    expect(text()).toContain('Assigned 2 items.');
    expect(button('Undo')).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
    expect(text()).not.toContain('selected');
    vi.unstubAllGlobals();
  });

  it('hides Assign unless every selected item can be assigned', async () => {
    const review = selectable('r1', { key: 'review:r1', kind: 'review', can: { resolve: true, hide: false, remove: false, assign: false } });
    await mount(bar([selectable('c1'), review]));
    await click(document.querySelector('input[aria-label="Select all on this page"]'));
    expect(button('Assign')).toBeNull();
    expect(button('Resolve')).not.toBeNull();
  });

  it('keeps failed assignments selected after a partial result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, assignment: { assigneeId: null, members: [{ id: 'u1', name: 'Nadia' }] } })));
    state.bulk.mockResolvedValue({ ok: true, action: 'assign', requested: 2, succeeded: 1, failed: 1, results: [{ kind: 'comment', id: 'c1', ok: true, assigneeId: 'u1' }, { kind: 'comment', id: 'c2', ok: false, code: 'not_found', error: 'Gone.' }] });
    await mount(bar([selectable('c1'), selectable('c2')]));
    await click(document.querySelector('input[aria-label="Select all on this page"]'));
    await click(button('Assign'));
    await flush();
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Assign') ?? null);
    await flush();
    expect(state.bulk).toHaveBeenCalledWith(expect.objectContaining({ action: 'assign', assigneeId: null, confirmation: 'BULK ASSIGN 2 INBOX ITEMS TO UNASSIGNED' }));
    expect(text()).toContain('1 done, 1 could not be updated.');
    expect(text()).toContain('1 selected');
    expect((document.querySelector('input[aria-label="Select Person c2"]') as HTMLInputElement).checked).toBe(true);
    vi.unstubAllGlobals();
  });

  it('explains an unreachable team directory and refuses to confirm', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await mount(bar([selectable('c1')]));
    await click(document.querySelector('input[aria-label="Select Person c1"]'));
    await click(button('Assign'));
    await flush();
    expect(text()).toContain('Team members could not be loaded.');
    expect(([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Assign') as HTMLButtonElement).disabled).toBe(true);
    expect(state.bulk).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the assign dialog open with the reason when nothing could be applied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, assignment: { assigneeId: null, members: [] } })));
    state.bulk.mockResolvedValue({ ok: true, action: 'assign', requested: 1, succeeded: 0, failed: 1, results: [{ kind: 'comment', id: 'c1', ok: false, code: 'forbidden', error: 'You cannot assign this channel.' }] });
    await mount(bar([selectable('c1')]));
    await click(document.querySelector('input[aria-label="Select Person c1"]'));
    await click(button('Assign'));
    await flush();
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Assign') ?? null);
    await flush();
    expect(document.querySelector('dialog')?.textContent).toContain('You cannot assign this channel.');
    expect(text()).toContain('1 selected');
    vi.unstubAllGlobals();
  });

  it('speaks French', async () => {
    expect(round3Copy.fr.bulk.count(2)).toBe('2 sélectionnés');
    expect(round3Copy.fr.bulk.confirm.deleteSentence(1, 'Facebook')).toContain('irréversible');
    expect(round3Copy.fr.bulk.assignSentence(2, 'Nadia')).toBe('2 éléments seront attribués à Nadia.');
    expect(round3Copy.fr.bulk.unassignSentence(1)).toBe('1 élément ne sera plus attribué.');
    expect(round3Copy.fr.bulk.done.assign(1)).toBe('1 élément attribué.');
  });
});

describe('saved replies manager', () => {
  const listing = (replies: unknown[], total = replies.length, max = 3) => ({ ok: true, replies, total, maxCount: max, limits: { nameMaxCharacters: 40, bodyMaxCharacters: 200 } });
  it('shows usage against the Root limit, lists replies and creates one with the exact confirmation', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let data = listing([{ id: 'r1', name: 'Hours', body: 'Open 9 to 5' }]);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); if (init?.method === 'POST') { data = listing([...data.replies, { id: 'r2', name: 'Shipping', body: 'Free' }] as never, 2); return Response.json({ ok: true, action: 'reply.create', id: 'r2' }); } return Response.json(data); }));
    await mount(h(SavedRepliesManager, { locale: 'en', canWrite: true }));
    await click(button('Saved replies'));
    await flush();
    expect(text()).toContain('1 of 3 saved replies used');
    expect(text()).toContain('Open 9 to 5');
    const name = document.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    expect(name.getAttribute('maxlength')).toBeDefined();
    const setValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
    await setValue(document.querySelector('dialog form input') as HTMLInputElement, 'Shipping');
    await setValue(document.querySelector('dialog form textarea') as HTMLTextAreaElement, 'Free');
    await click(button('Create saved reply'));
    await flush();
    const post = calls.find(call => call.init?.method === 'POST')!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ action: 'reply.create', name: 'Shipping', body: 'Free', confirmation: 'CREATE SAVED REPLY Shipping' });
    expect(text()).toContain('Saved reply created.');
    expect(text()).toContain('2 of 3 saved replies used');
  });

  it('hides the create form and explains the limit when the library is full', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(listing([{ id: 'r1', name: 'A', body: 'a' }], 3, 3))));
    await mount(h(SavedRepliesManager, { locale: 'en', canWrite: true }));
    await click(button('Saved replies'));
    await flush();
    expect(text()).toContain('You have reached the limit of 3 saved replies. Delete one to add another.');
    expect(button('Create saved reply')).toBeNull();
  });

  it('is read-only for people who cannot reply, and shows an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(listing([]))));
    await mount(h(SavedRepliesManager, { locale: 'en', canWrite: false }));
    await click(button('Saved replies'));
    await flush();
    expect(text()).toContain('No saved replies yet');
    expect(text()).toContain('only teammates who can reply can change them');
    expect(button('Create saved reply')).toBeNull();
  });

  it('asks before deleting and sends the exact confirmation', async () => {
    const calls: Array<RequestInit | undefined> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { calls.push(init); return init?.method === 'POST' ? Response.json({ ok: true, action: 'reply.delete', id: 'r1' }) : Response.json(listing([{ id: 'r1', name: 'Hours', body: 'Open' }])); }));
    await mount(h(SavedRepliesManager, { locale: 'en', canWrite: true }));
    await click(button('Saved replies'));
    await flush();
    await click(button('Actions for Hours'));
    await click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Delete') ?? null);
    expect(text()).toContain('This removes it for your whole team. This cannot be undone.');
    expect(calls.some(init => init?.method === 'POST')).toBe(false);
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Delete saved reply') ?? null);
    await flush();
    expect(JSON.parse(String(calls.find(init => init?.method === 'POST')!.body))).toEqual({ action: 'reply.delete', id: 'r1', confirmation: 'DELETE SAVED REPLY r1' });
  });

  it('shows the server reason and keeps the form when a save is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ error: 'You can keep up to 3 saved replies. Delete one to add another.', code: 'conflict' }, { status: 409 }) : Response.json(listing([]))));
    await mount(h(SavedRepliesManager, { locale: 'en', canWrite: true }));
    await click(button('Saved replies'));
    await flush();
    const set = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
    await set(document.querySelector('dialog form input') as HTMLInputElement, 'Hours');
    await set(document.querySelector('dialog form textarea') as HTMLTextAreaElement, 'Open');
    await click(button('Create saved reply'));
    await flush();
    expect(document.querySelector('dialog')?.textContent).toContain('You can keep up to 3 saved replies.');
    expect((document.querySelector('dialog form textarea') as HTMLTextAreaElement).value).toBe('Open');
  });
});

describe('keyboard shortcuts', () => {
  const press = (key: string, target: EventTarget = document.body) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  it('opens a guide with ? that lists every key, and closes it with its button', async () => {
    await mount(h(InboxShortcuts, { locale: 'en' }));
    expect(button('Keyboard shortcuts')).not.toBeNull();
    await press('?');
    const dialog = document.querySelector('dialog')!;
    for (const label of ['Next conversation', 'Previous conversation', 'Write a reply', 'Select or unselect the focused conversation', 'Search the Inbox', 'Clear the selection']) expect(dialog.textContent).toContain(label);
    expect(dialog.querySelectorAll('kbd').length).toBeGreaterThanOrEqual(8);
  });

  it('x toggles the checkbox beside the focused row, and / focuses the search field', async () => {
    document.body.innerHTML = '<ul><li id="row"><input type="checkbox" data-inbox-select aria-label="pick"><a href="#" data-inbox-item>One</a></li></ul><input name="q">';
    await mount(h(InboxShortcuts, { locale: 'en' }));
    (document.querySelector('[data-inbox-item]') as HTMLElement).focus();
    const box = document.querySelector('input[data-inbox-select]') as HTMLInputElement;
    await press('x', document.querySelector('[data-inbox-item]')!);
    expect(box.checked).toBe(true);
    await press('/');
    expect(document.activeElement).toBe(document.querySelector('input[name="q"]'));
  });

  it('ignores keys while typing in a field', async () => {
    await mount(h(InboxShortcuts, { locale: 'en' }));
    const field = document.createElement('input'); document.body.appendChild(field); field.focus();
    await press('?', field);
    expect(document.querySelector('dialog')).toBeNull();
  });
});

describe('conversation details panel', () => {
  const details = (over: Partial<InboxContactDetails> = {}): InboxContactDetails => ({
    kind: 'comment', id: 'c1', person: { name: 'Amina', remoteId: 'p1' }, channel: { id: 't1', name: 'Atelier', provider: 'facebook' }, firstSeen: new Date('2026-09-01T10:00:00Z'), messageCount: 6, identityKnown: true,
    relatedPosts: [{ id: 'post1', text: 'Autumn menu', comments: 3, lastCommentAt: new Date('2026-10-10T10:00:00Z') }], relatedPostsMore: false,
    state: { resolved: false, hidden: false, unread: 0, assignee: { id: 'u1', name: 'Nadia' } },
    sentiment: sentimentTrend([{ time: new Date('2026-10-01T10:00:00Z'), sentiment: 'negative' }, { time: new Date('2026-10-05T10:00:00Z'), sentiment: null }, { time: new Date('2026-10-09T10:00:00Z'), sentiment: 'positive' }]), ...over,
  });
  const render = (value: InboxContactDetails | null, locale: 'en' | 'fr' = 'en') => renderToStaticMarkup(h(ContactDetails, { details: value, locale, timeZone: 'UTC' }));

  it('shows the person, channel, first seen, message count, labels, related posts and sentiment trend', () => {
    const html = render(details());
    for (const expected of ['Amina', 'Atelier', 'Sep 1, 2026', '>6<', 'Open', 'Assigned to Nadia', 'Autumn menu', '3 comments', 'Getting more positive', 'Not classified', '1 positive · 0 neutral · 1 negative · 1 not classified']) expect(html, expected).toContain(expected);
    expect(html).toContain('<details open');
    expect(html.match(/data-sentiment="(positive|negative|unknown)"/g)).toHaveLength(3);
  });

  it('explains missing data instead of showing zeros: no posts, no classification, no identity', () => {
    const html = render(details({ identityKnown: false, firstSeen: null, relatedPosts: [], sentiment: sentimentTrend([]) }));
    expect(html).toContain('Unknown');
    expect(html).toContain('They have not commented on any of your posts yet.');
    expect(html).toContain('No classified comments yet');
    expect(html).toContain('only this conversation is described');
  });

  it('renders French and a recoverable message when the details could not be read', () => {
    expect(render(details(), 'fr')).toContain('Étiquettes');
    expect(render(null)).toContain('The details could not be loaded.');
  });
});

describe('Inbox screen: quick filters, selection and details', () => {
  const item = (key: string, over: Record<string, unknown> = {}) => ({ key, kind: 'comment', id: key.split(':')[1], author: 'Amina', preview: 'Love it', time: new Date('2026-10-20T09:00:00Z'), rating: null, recommendation: null, target: { id: 'channel', name: 'Atelier', provider: 'facebook' }, unread: 0, needsReply: false, resolved: false, hidden: false, context: null, sentiment: null, ...over });
  const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, total: items.length, limit: 25, cursor: null, olderCursor: null, newerCursor: null, filters: { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '' }, channels: [{ id: 'channel', name: 'Atelier' }], lastSynced: null, timeZone: 'UTC', limits: { listPageSize: 25, threadPageSize: 50, searchMaxCharacters: 200, cursorMaxCharacters: 4096, bulkMaxItems: 10 }, ...extra });
  const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(h(ToastProvider, null, await InboxPage({ searchParams: Promise.resolve(params) })));
  beforeEach(() => {
    state.viewer.mockResolvedValue({ user: { id: 'reader' }, workspaceId: 'workspace', permissions: { pageScope: { all: true, ids: [] } }, membership: { workspace: { timezone: 'UTC' } } });
    state.manage.mockResolvedValue(true); state.workflow.mockResolvedValue(true); state.details.mockResolvedValue(null);
    state.list.mockResolvedValue(page([item('comment:1')]));
  });

  it('offers the four quick filters as a row of links above the list, with the applied one marked current', async () => {
    state.list.mockResolvedValue(page([item('comment:1')], { quick: ['negative'] }));
    const html = await render({ quick: 'negative' });
    for (const label of ['Unread', 'Unanswered', 'Negative', 'Mentions']) expect(html).toContain(`>${label}</a>`);
    expect(html).toMatch(/aria-current="true"[^>]*>Negative</);
    expect(html).not.toMatch(/aria-current="true"[^>]*>Unread</);
    // Choosing another keeps the applied one; choosing the applied one removes it.
    expect(html).toMatch(/href="\/inbox\?[^"]*quick=negative%2Cunread"[^>]*>Unread</);
    expect(html).toMatch(/href="\/inbox\?limit=25"[^>]*aria-current="true"/);
    expect(html).toContain('name="quick" value="negative"');
    expect(state.list.mock.calls[0]![1]).toMatchObject({ quick: ['negative'] });
  });

  it('shows each active quick filter as a removable chip that keeps the others', async () => {
    state.list.mockResolvedValue(page([item('comment:1')], { quick: ['unread', 'negative'] }));
    const html = await render({ quick: 'unread,negative' });
    expect(html).toContain('Quick filter:');
    expect(html).toContain('aria-label="Remove filter: Quick filter Unread"');
  });

  it('explains an empty quick-filter result and offers a reset', async () => {
    state.list.mockResolvedValue(page([], { quick: ['mentions'], total: 0 }));
    const html = await render({ quick: 'mentions' });
    expect(html).toContain('Nothing matches these quick filters');
  });

  it('adds a selection box and the bulk bar only for items this person may act on', async () => {
    const html = await render();
    expect(html).toContain('aria-label="Select Amina"');
    expect(html).toContain('Select all on this page');
    state.manage.mockResolvedValue(false); state.workflow.mockResolvedValue(false);
    const readOnly = await render();
    expect(readOnly).not.toContain('aria-label="Select Amina"');
    expect(readOnly).not.toContain('Select all on this page');
  });

  it('offers saved reply management and the shortcut guide, in French too', async () => {
    expect(await render()).toContain('Saved replies');
    state.language = 'fr';
    const html = await render();
    expect(html).toContain('Réponses enregistrées');
    expect(html).toContain('Raccourcis clavier');
    expect(html).toContain('Filtres rapides');
  });

  it('renders the details panel beside the open conversation, and survives details failing', async () => {
    state.thread.mockResolvedValue({ thread: { kind: 'comment', id: '1', rating: null, recommendation: null, target: { id: 'channel', name: 'Atelier', providerId: 'page', provider: 'facebook' }, resolved: false, hidden: false, postText: 'Post', entries: [{ id: '1', author: 'Amina', text: 'Love it', time: new Date('2026-10-20T09:00:00Z'), fromChannel: false, sentBy: null, parentId: null, depth: 0, hidden: false }], lastInbound: null }, history: { total: 0, shown: 0, limit: 50, cursor: null, olderCursor: null, newerCursor: null } });
    state.details.mockResolvedValue({ kind: 'comment', id: '1', person: { name: 'Amina', remoteId: 'p1' }, channel: { id: 'channel', name: 'Atelier', provider: 'facebook' }, firstSeen: new Date('2026-09-01T10:00:00Z'), messageCount: 4, identityKnown: true, relatedPosts: [], relatedPostsMore: false, state: { resolved: false, hidden: false, unread: 0, assignee: null }, sentiment: sentimentTrend([]) });
    const html = await render({ thread: 'comment:1' });
    expect(html).toContain('aria-label="Conversation details"');
    expect(state.details).toHaveBeenCalledWith({ userId: 'reader', workspaceId: 'workspace' }, { key: 'comment:1' }, undefined);
    state.details.mockRejectedValue(new Error('down'));
    const degraded = await render({ thread: 'comment:1' });
    expect(degraded).toContain('The details could not be loaded.');
    expect(degraded).toContain('Love it');
  });

  it('links the open comment thread to its origin post', async () => {
    state.thread.mockResolvedValue({ thread: { kind: 'comment', id: '1', rating: null, recommendation: null, target: { id: 'channel', name: 'Atelier', providerId: 'page', provider: 'facebook' }, resolved: false, hidden: false, postText: 'Post', postId: 'post-9', entries: [{ id: '1', author: 'Amina', text: 'Love it', time: new Date('2026-10-20T09:00:00Z'), fromChannel: false, sentBy: null, parentId: null, depth: 0, hidden: false }], lastInbound: null }, history: { total: 0, shown: 0, limit: 50, cursor: null, olderCursor: null, newerCursor: null } });
    const html = await render({ thread: 'comment:1' });
    expect(html).toContain('href="/content/post/post-9"');
    expect(html).toContain('Open post');
  });
});
