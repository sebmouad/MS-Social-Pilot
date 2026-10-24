// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

import { ReplyBox } from '../src/modules/inbox/ui/InboxActions';
import { ThreadTools } from '../src/modules/inbox/ui/ThreadTools';
import { ToastProvider } from '../src/components/Toast';

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
const setValue = (element: HTMLTextAreaElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
const replies = [{ id: 'r1', name: 'Hours', body: 'Open 9 to 5' }, { id: 'r2', name: 'Shipping', body: 'Free over 30' }];
const productivity = { ok: true, assignment: { assigneeId: null, members: [] }, notes: [], mentionable: [], limits: { noteMaxCharacters: 100, savedReplyNameMaxCharacters: 40, savedReplyBodyMaxCharacters: 200 } };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('reply box saved-replies menu', () => {
  it('stays unchanged without an insert handler', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, replies }));
    vi.stubGlobal('fetch', fetch);
    await mount(h(ReplyBox, { id: 'c1', kind: 'comment', allowed: true, headline: 'Replies are open' }));
    await flush();
    expect(document.querySelector('button[aria-label="Saved replies"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists saved replies from the shared view and inserts without sending', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return Response.json({ ok: true, replies }); }));
    const inserted: string[] = [];
    await mount(h(ReplyBox, { id: 'c1', kind: 'comment', allowed: true, headline: 'Replies are open', value: '', onChange: () => {}, onInsertSavedReply: (body: string) => { inserted.push(body); } }));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/inbox/productivity?view=saved-replies');
    await click(document.querySelector('button[aria-label="Saved replies"]'));
    await click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Hours') ?? null);
    expect(inserted).toEqual(['Open 9 to 5']);
    expect(calls.some(call => call.init?.method === 'POST')).toBe(false);
  });

  it('explains an empty library and an unreachable one without breaking the reply box', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, replies: [] })));
    await mount(h(ReplyBox, { id: 'c1', kind: 'comment', allowed: true, headline: 'Replies are open', onInsertSavedReply: () => {} }));
    await flush();
    await click(document.querySelector('button[aria-label="Saved replies"]'));
    const empty = [...document.querySelectorAll('[role="menuitem"]')];
    expect(empty).toHaveLength(1);
    expect(empty[0]!.textContent).toBe('No saved replies yet');
    expect(empty[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('shows a load failure as an unavailable menu item', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Forbidden', code: 'forbidden' }, { status: 403 })));
    await mount(h(ReplyBox, { id: 'c1', kind: 'comment', allowed: true, headline: 'Replies are open', onInsertSavedReply: () => {} }));
    await flush();
    await click(document.querySelector('button[aria-label="Saved replies"]'));
    const failed = [...document.querySelectorAll('[role="menuitem"]')];
    expect(failed).toHaveLength(1);
    expect(failed[0]!.textContent).toBe('Saved replies could not be loaded.');
    expect(failed[0]!.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('thread tools wire the menu into the draft with replace confirmation', () => {
  const stub = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('view=saved-replies') ? Response.json({ ok: true, replies }) : Response.json(productivity)));
  const draft = () => document.querySelector('textarea[data-inbox-reply]') as HTMLTextAreaElement;
  const insert = async (name: string) => {
    await click(document.querySelector('button[aria-label="Saved replies"]'));
    await click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === name) ?? null);
    await flush();
  };

  it('fills an empty draft straight from the menu', async () => {
    stub();
    await mount(h(ThreadTools, { kind: 'comment', id: 'c1', canWrite: true, canReply: true, allowed: true, headline: 'Replies are open' }));
    await flush();
    await insert('Shipping');
    expect(draft().value).toBe('Free over 30');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('asks before replacing a draft, and keeps it on Keep', async () => {
    stub();
    await mount(h(ThreadTools, { kind: 'comment', id: 'c1', canWrite: true, canReply: true, allowed: true, headline: 'Replies are open' }));
    await flush();
    await setValue(draft(), 'My own words');
    await insert('Hours');
    expect(text()).toContain('Replace your draft?');
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Keep draft') ?? null);
    await flush();
    expect(draft().value).toBe('My own words');
    await insert('Hours');
    await click([...document.querySelectorAll('dialog button')].find(item => item.textContent === 'Replace') ?? null);
    await flush();
    expect(draft().value).toBe('Open 9 to 5');
  });

  it('offers no menu when replying is unavailable', async () => {
    stub();
    await mount(h(ThreadTools, { kind: 'comment', id: 'c1', canWrite: true, canReply: false, allowed: false, headline: '' }));
    await flush();
    expect(document.querySelector('button[aria-label="Saved replies"]')).toBeNull();
    expect(text()).toContain('replying is unavailable');
  });
});
