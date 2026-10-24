// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { FirstCommentRetry, firstCommentRetryCopy } from '../src/modules/publishing/ui/posts/FirstCommentRetry';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const settled = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  document.documentElement.lang = 'en';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function button(text: string, parent: ParentNode = container) {
  const result = [...parent.querySelectorAll('button')].find(node => node.textContent === text);
  if (!result) throw new Error(`Missing ${text}`); return result;
}
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function type(value: string) {
  const input = container.querySelector('dialog input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render() { await act(async () => root.render(createElement(FirstCommentRetry, { postId: 'post', postTargetId: 'destination', destinationName: 'Synthetic channel', onSettled: settled }))); }
function response(state = 'sent', extra = {}) { return { ok: true, json: async () => ({ ok: true, postId: 'post', postTargetId: 'destination', state, ...extra }) }; }

it('uses shared exact confirmation, cancels without a send, and verifies the matching sent receipt', async () => {
  const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
  await render(); await click(button(firstCommentRetryCopy.en.retry));
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('Synthetic channel'); expect(dialog.textContent).toContain('overriding its saved delay');
  expect(button(firstCommentRetryCopy.en.retry, dialog).disabled).toBe(true);
  await click(button('Cancel', dialog)); expect(fetch).not.toHaveBeenCalled();
  await click(button(firstCommentRetryCopy.en.retry)); await type('RETRY FIRST COMMENT destination');
  await click(button(firstCommentRetryCopy.en.retry, container.querySelector('dialog')!));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ postId: 'post', postTargetId: 'destination', confirmation: 'RETRY FIRST COMMENT destination' });
  expect(settled).toHaveBeenCalledWith('sent'); expect(container.textContent).toContain(firstCommentRetryCopy.en.sent);
});

it.each(['offline', 'needs_review', 'malformed'])('retains confirmation and holds %s results without a second request', async kind => {
  const fetch = vi.fn();
  if (kind === 'offline') fetch.mockRejectedValue(new Error('offline'));
  else fetch.mockResolvedValue(kind === 'malformed' ? response('sent', { postTargetId: 'wrong' }) : response('needs_review'));
  vi.stubGlobal('fetch', fetch); await render();
  await click(button(firstCommentRetryCopy.en.retry)); await type('RETRY FIRST COMMENT destination');
  const dialog = container.querySelector('dialog')!;
  await click(button(firstCommentRetryCopy.en.retry, dialog));
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(firstCommentRetryCopy.en.held);
  expect(dialog.querySelector('input')!.value).toBe('RETRY FIRST COMMENT destination');
  await click(button(firstCommentRetryCopy.en.retry, dialog)); expect(fetch).toHaveBeenCalledTimes(1);
  await click(button('Cancel', dialog)); expect(settled).toHaveBeenCalledWith('needs_review');
});

it('retains recoverable errors and input, and uses French copy', async () => {
  document.documentElement.lang = 'fr';
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'unavailable', error: 'Internal English' }) }).mockResolvedValueOnce(response());
  vi.stubGlobal('fetch', fetch); await render();
  await click(button(firstCommentRetryCopy.fr.retry)); await type('RETRY FIRST COMMENT destination');
  const dialog = container.querySelector('dialog')!;
  await click(button(firstCommentRetryCopy.fr.retry, dialog));
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(firstCommentRetryCopy.fr.failed);
  expect(dialog.querySelector('input')!.value).toBe('RETRY FIRST COMMENT destination');
  await click(button(firstCommentRetryCopy.fr.retry, dialog));
  expect(fetch).toHaveBeenCalledTimes(2); expect(settled).toHaveBeenCalledWith('sent');
});

it('requires fresh confirmation after another definite rejection', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response('ready')).mockResolvedValueOnce(response());
  vi.stubGlobal('fetch', fetch); await render(); await click(button(firstCommentRetryCopy.en.retry));
  await type('RETRY FIRST COMMENT destination'); await click(button(firstCommentRetryCopy.en.retry, container.querySelector('dialog')!));
  expect(container.textContent).toContain(firstCommentRetryCopy.en.rejected); expect(settled).toHaveBeenCalledWith('ready');
  await click(button(firstCommentRetryCopy.en.retry));
  expect(container.querySelector<HTMLInputElement>('dialog input')!.value).toBe('');
  expect(button(firstCommentRetryCopy.en.retry, container.querySelector('dialog')!).disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
