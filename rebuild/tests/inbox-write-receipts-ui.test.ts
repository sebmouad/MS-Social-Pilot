// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/app/inbox/inbox.module.css', () => ({ default: {} }));
vi.mock('../src/components', async () => ({ ...await import('../src/components/Button'), ...await import('../src/components/Dialog') }));
import { InboxSyncBar, ReplyBox, ThreadToolbar } from '../src/app/inbox/InboxActions';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const lost = () => Promise.reject(new TypeError('private transport detail'));
const uncertain = 'The outcome is unconfirmed. Check the current Inbox and platform state before repeating this action.';

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(element: React.ReactNode) { await act(async () => root.render(createElement(() => element))); }
async function sendReply() {
  await act(async () => { const field = container.querySelector<HTMLTextAreaElement>('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Keep this reply'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
}
async function showReply() { await render(createElement(ReplyBox, { id: 'comment-a', kind: 'comment', allowed: true, headline: 'Reply is available' })); }
async function showToolbar() {
  await render(createElement(ThreadToolbar, { id: 'comment-a', kind: 'comment', resolved: false, hidden: false, canResolve: true, canHide: true, canDelete: true, platformName: 'Example', listHref: '/inbox' }));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Delete comment')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('dialog button:not([data-dialog-cancel])')!.click());
}

describe('Inbox write receipts', () => {
  it('reports a lost reply response as unconfirmed, retains text, and reenables submission', async () => {
    vi.stubGlobal('fetch', vi.fn(lost)); await showReply(); await sendReply();
    expect(container.querySelector('[role=alert]')?.textContent).toBe(uncertain);
    expect(container.querySelector('textarea')?.value).toBe('Keep this reply');
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
    expect(container.textContent).not.toContain('private transport detail');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', { json: async () => { throw new SyntaxError('bad json'); } }],
    ['missing receipt', respond(200, {})],
    ['false receipt', respond(200, { ok: false })],
    ['array receipt', respond(200, [{ ok: true }])],
  ])('does not claim reply success for %s', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response)); await showReply(); await sendReply();
    expect(container.querySelector('[role=alert]')?.textContent).toBe(uncertain);
    expect(container.querySelector('textarea')?.value).toBe('Keep this reply');
    expect(container.textContent).not.toContain('Reply sent.');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('accepts an explicit success receipt and then clears the reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, { ok: true, itemId: 'reply-1' }))); await showReply(); await sendReply();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Reply sent.');
    expect(container.querySelector('textarea')?.value).toBe(''); expect(router.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ['negative count', { conversationCount: -1 }],
    ['unsafe count', { messageCount: Number.MAX_SAFE_INTEGER + 1 }],
    ['string count', { commentCount: '2' }],
    ['invalid date', { syncedAt: '2026-02-30T12:00:00.000Z' }],
    ['noncanonical date', { syncedAt: '2026-10-16T12:00:00Z' }],
  ])('does not report sync success for %s', async (_label, changed) => {
    const body = { ok: true, targetCount: 1, failedCount: 0, conversationCount: 2, messageCount: 3, commentCount: 4, syncedAt: '2026-10-16T12:00:00.000Z', ...changed };
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, body)));
    await render(createElement(InboxSyncBar, { lastSynced: null, timeZone: 'UTC' }));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role=alert]')?.textContent).toBe(uncertain);
    expect(container.querySelector('[role=status]')?.textContent).toBe('');
    expect(container.textContent).not.toContain('Checked'); expect(router.refresh).not.toHaveBeenCalled();
  });

  it('uses sync totals and time only after a complete valid receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, { ok: true, targetCount: 1, failedCount: 0, conversationCount: 2, messageCount: 3, commentCount: 4, syncedAt: '2026-10-16T12:00:00.000Z' })));
    await render(createElement(InboxSyncBar, { lastSynced: null, timeZone: 'UTC' }));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role=status]')?.textContent).toContain('Checked 1 channel: 2 conversations (3 messages) and 4 comments up to date.');
    expect(container.textContent).toContain('Last synced'); expect(router.refresh).toHaveBeenCalledOnce();
  });

  it('keeps deletion confirmation open after a missing receipt and re-enables controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, {}))); await showToolbar();
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog [role=alert]')?.textContent).toBe(uncertain);
    expect(container.querySelector<HTMLButtonElement>('dialog button:not([data-dialog-cancel])')?.disabled).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
