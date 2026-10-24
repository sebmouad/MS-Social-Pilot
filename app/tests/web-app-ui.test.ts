// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebAppProvider } from '@/modules/settings/web-app/Registration';
import { InstallControl } from '@/modules/settings/web-app/InstallControl';
import { WEB_APP_DEFAULTS } from '@/modules/settings/web-app/config';
const copy = WEB_APP_DEFAULTS.copy;
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const register = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', fetchMock);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  register.mockResolvedValue({}); fetchMock.mockResolvedValue({ ok: true, json: async () => ({ prepared: true }) });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(locale: 'en' | 'fr' = 'en', canWrite = true) {
  await act(async () => root.render(createElement(WebAppProvider, null, createElement(InstallControl, { copy: copy[locale], canWrite, requestTimeoutMs: WEB_APP_DEFAULTS.requestTimeoutMs }))));
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text);
  expect(button, text).toBeTruthy(); await act(async () => button!.click());
}
it('registers once, prepares through REST and keeps native installation separate from reported success', async () => {
  await render(); expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  const event = new Event('beforeinstallprompt', { cancelable: true }); const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await act(async () => { window.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true);
  await click(copy.en.prepare); expect(document.querySelector('dialog')).not.toBeNull();
  await click(copy.en.confirm);
  expect(fetchMock).toHaveBeenCalledWith('/api/settings/web-app', expect.objectContaining({ body: JSON.stringify({ confirmation: 'PREPARE WEB APP INSTALLATION' }) }));
  expect(prompt).not.toHaveBeenCalled(); await click(copy.en.install); expect(prompt).toHaveBeenCalledOnce();
  expect(host.textContent).toContain(copy.en.dismissed); expect(host.textContent).not.toContain(copy.en.installed);
  await act(async () => { window.dispatchEvent(new Event('appinstalled')); }); expect(host.textContent).toContain(copy.en.installed);
});
it('keeps an early browser prompt across a route-like child replacement', async () => {
  await act(async () => root.render(createElement(WebAppProvider, null, createElement('p', null, 'Other screen'))));
  const prompt = vi.fn(async () => {}); const event = new Event('beforeinstallprompt', { cancelable: true }); Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await act(async () => { window.dispatchEvent(event); }); await render();
  await click(copy.en.prepare); await click(copy.en.confirm); await click(copy.en.install); expect(prompt).toHaveBeenCalledOnce();
});
it('preserves a localized retry after failure and cancellation never calls REST', async () => {
  await render('fr'); await click(copy.fr.prepare); await click(copy.fr.cancel); expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await click(copy.fr.prepare); await click(copy.fr.confirm); expect(host.textContent).toContain(copy.fr.failed);
  await click(copy.fr.prepare); await click(copy.fr.confirm); expect(host.textContent).toContain(copy.fr.prepared);
});
it('shows guidance without writable controls to readers and tolerates registration refusal', async () => {
  register.mockRejectedValueOnce(new Error('browser policy')); await render('fr', false);
  expect(host.textContent).toContain(copy.fr.unsupported); expect(host.querySelector('button')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});

it('ends a stalled preparation using the Root deadline and keeps retry available', async () => {
  vi.useFakeTimers();
  try {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await render(); await click(copy.en.prepare); await click(copy.en.confirm);
    expect(host.textContent).toContain(copy.en.preparing);
    await act(async () => { await vi.advanceTimersByTimeAsync(WEB_APP_DEFAULTS.requestTimeoutMs); });
    expect(host.textContent).toContain(copy.en.failed);
    expect([...host.querySelectorAll('button')].some(button => button.textContent === copy.en.prepare && !button.disabled)).toBe(true);
  } finally { vi.useRealTimers(); }
});
