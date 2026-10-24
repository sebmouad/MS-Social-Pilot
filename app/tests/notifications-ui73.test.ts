// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from '../src/modules/settings/ui/notifications/NotificationCenter';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const item = { id: 'private-row-id', kind: 'note_mention' as const, createdAt: new Date('2026-10-18T12:00:00.000Z'), updatedAt: new Date('2026-10-18T12:00:00.000Z'), readAt: null, emailSentAt: null, emailState: 'uncertain' as const, title: 'A teammate mentioned you', body: 'Review a note in your workspace.', available: true, postId: null, noteId: null, targetId: null, labelId: null };
const preferences = {
  preferences: { onNoteMention: true, onQueueEmpty: false },
  configured: false,
  mutes: [],
  channels: [{ id: 'private-channel-id', name: 'Studio channel' }],
  maxMutes: 4,
};
const page = { items: [item], page: 1, pageSize: 25, hasMore: true };
const respond = (body: unknown, ok = true) => ({ ok, json: async () => body });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(NotificationCenter, { initialPreferences: preferences, initialPage: page }))); }
function button(label: string, parent: ParentNode = document.body) {
  const found = Array.from(parent.querySelectorAll('button')).find(element => element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}
async function click(target: HTMLElement) { await act(async () => target.click()); }
async function check(target: HTMLInputElement, value: boolean) {
  if (target.checked !== value) await act(async () => target.click());
}

describe('notification inbox and personal settings', () => {
  it('saves Switch changes immediately, preserves a failed draft, and retries the reviewed values', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(respond({ error: 'Preferences could not be saved.' }, false)).mockResolvedValueOnce(respond({ preferences: { ...preferences, preferences: { onNoteMention: false, onQueueEmpty: false }, mutes: [] } }));
    vi.stubGlobal('fetch', fetch);
    await render();
    const mention = container.querySelector<HTMLButtonElement>('[role=switch]')!;
    expect(mention.getAttribute('aria-checked')).toBe('true');
    await click(mention);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mention.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('Preferences could not be saved.');
    await click(button('Review changes', container));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('Note mention email: Off');
    await click(button('Save preferences', dialog));
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, request] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({ onNoteMention: false, onQueueEmpty: false, mutes: [], confirmation: 'UPDATE NOTIFICATION PREFERENCES' });
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role=status]')?.textContent).toContain('saved');
  });

  it('places list filters in-page and sends one confirmed read action while pending', async () => {
    let finish!: (value: ReturnType<typeof respond>) => void;
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<ReturnType<typeof respond>>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    await render();
    expect(container.textContent).toContain('Email outcome needs review');
    expect(container.textContent).not.toContain('private-row-id');
    const unread = Array.from(container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).at(-1)!;
    await check(unread, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain('unreadOnly=true');
    await act(async () => finish(respond({ preferences, notifications: page })));
    await click(button('Mark read'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('The alert will stay in your inbox');
    const action = button('Mark read', dialog);
    await act(async () => { action.click(); action.click(); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(action.disabled).toBe(true);
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain('id=private-row-id');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ confirmation: 'READ NOTIFICATION private-row-id' });
    await act(async () => finish(respond({ id: 'private-row-id', read: true, readAt: '2026-10-18T12:01:00.000Z' })));
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('A teammate mentioned you');
    expect(container.querySelector('[role=status]')?.textContent).toContain('marked as read');
  });

  it('requires a review click before deleting and preserves the confirmation dialog on failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(respond({ error: 'Try again.' }, false)).mockResolvedValueOnce(respond({ id: 'private-row-id', deleted: true }));
    vi.stubGlobal('fetch', fetch);
    await render();
    await click(button('Delete'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('It does not change the post, note or channel.');
    await click(button('Delete alert', dialog));
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role=alert]')?.textContent).toContain('Try again');
    await click(button('Delete alert', dialog));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('DELETE');
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).not.toContain('A teammate mentioned you');
  });

  it('shows a safe unavailable state when an alert source is no longer reachable', async () => {
    await act(async () => root.render(createElement(NotificationCenter, {
      initialPreferences: preferences,
      initialPage: { ...page, items: [{ ...item, available: false, title: 'Notification source unavailable', body: 'This alert source is no longer available.', postId: null, noteId: null, targetId: null, labelId: null }] },
    })));
    expect(container.textContent).toContain('Source no longer available');
    expect(container.textContent).not.toContain('Teammate note mention');
    expect(container.textContent).not.toContain('private-row-id');
  });
});
