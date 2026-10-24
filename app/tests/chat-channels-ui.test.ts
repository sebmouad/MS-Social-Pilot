// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CHAT_COPY, CHAT_POLICY } from '@/modules/notifications/chat-channels/config';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { ChatChannels } from '@/modules/notifications/chat-channels/ui/ChatChannels';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const initial = [{ id: 'chat-a', kind: 'slack', name: 'Synthetic editorial team', events: ['publishFailure'], enabled: true, hasError: false, lastSentAt: null }];
async function open(locale: 'en' | 'fr' = 'en') {
  const copy = CHAT_COPY[locale];
  await act(async () => root.render(createElement(ChatChannels, { initial, policy: CHAT_POLICY, copy, locale, timeZone: 'UTC' })));
  const opener = [...container.querySelectorAll('button')].find(button => button.textContent === copy.test)!;
  await act(async () => opener.click());
  const dialog = document.querySelector('dialog')!;
  const input = dialog.querySelector('input')!;
  const submit = [...dialog.querySelectorAll('button')].find(button => button.textContent === copy.confirm)!;
  const type = (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return { dialog, input, submit, type };
}
it('requires exact confirmation and preserves dialog input when a test cannot be confirmed', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('network')); vi.stubGlobal('fetch', fetch);
  const { dialog, input, submit, type } = await open();
  expect(submit.disabled).toBe(true);
  await type('TEST CHAT CHANNEL another-tenant'); expect(submit.disabled).toBe(true);
  await type('TEST CHAT CHANNEL chat-a'); await act(async () => submit.click());
  expect(fetch).toHaveBeenCalledOnce(); expect(dialog.open).toBe(true);
  expect(input.value).toBe('TEST CHAT CHANNEL chat-a');
  expect(dialog.querySelector('[role=alert]')?.textContent).toBe(CHAT_COPY.en.error);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('deduplicates pending sends and reports uncertainty in French', async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
  const { dialog, submit, type } = await open('fr');
  await type('TEST CHAT CHANNEL chat-a'); await act(async () => { submit.click(); submit.click(); });
  expect(fetch).toHaveBeenCalledOnce(); expect(submit.disabled).toBe(true);
  await act(async () => resolve(Response.json({ id: 'chat-a', outcome: 'uncertain' })));
  expect(dialog.open).toBe(false);
  expect(container.querySelector('[role=status]')?.textContent).toBe(CHAT_COPY.fr.uncertain);
  expect(container.textContent).not.toContain(CHAT_COPY.fr.sent);
});
it('refuses a mismatched delivery receipt', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'another-tenant', outcome: 'accepted' })));
  const { dialog, submit, type } = await open(); await type('TEST CHAT CHANNEL chat-a'); await act(async () => submit.click());
  expect(dialog.open).toBe(true); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('shows French required-field feedback with first-invalid focus before opening confirmation', async () => {
  await act(async () => root.render(createElement(ChatChannels, { initial: [], policy: CHAT_POLICY, copy: CHAT_COPY.fr, locale: 'fr', timeZone: 'UTC' })));
  const form = container.querySelector('form')!;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(document.querySelector('dialog')).toBeNull();
  expect(container.querySelector('input[name=name]')?.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(container.querySelector('input[name=name]'));
  expect(container.querySelector('[role=alert]')?.textContent).toBeTruthy();
});
