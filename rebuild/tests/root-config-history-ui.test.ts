// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigHistory } from '../src/app/root/config/ConfigHistory';
import { ROOT_INTERFACE_COPY } from '../src/lib/config/root-interface-copy';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(ConfigHistory, { copy: ROOT_INTERFACE_COPY.en })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const click = async (label: string) => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); };
it('loads only on opening, renders sanitized configuration history and pages through the same service', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ id: 'a', action: 'config.changed', createdAt: '2026-10-20T12:00:00.000Z', actor: { name: 'Owner', email: 'owner@example.test' } }], olderCursor: 'next-page' })).mockResolvedValueOnce(Response.json({ items: [], olderCursor: null }));
  vi.stubGlobal('fetch', fetch); expect(fetch).not.toHaveBeenCalled();
  await click('Change history');
  expect(fetch.mock.calls[0][0]).toBe('/api/root/activity?q=config.changed');
  expect(document.querySelector('dialog')?.textContent).toContain('Owner');
  expect(document.querySelector('dialog')?.textContent).not.toContain('owner@example.test');
  await click('Older changes');
  expect(fetch.mock.calls[1][0]).toBe('/api/root/activity?q=config.changed&cursor=next-page');
  expect(document.querySelector('dialog')?.textContent).toContain('No configuration changes recorded.');
});
it('keeps the drawer open with a retry action when history is unavailable', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('private details')).mockResolvedValueOnce(Response.json({ items: [], olderCursor: null })); vi.stubGlobal('fetch', fetch);
  await click('Change history');
  expect(document.querySelector('dialog')?.textContent).toContain('Change history could not be loaded.');
  expect(document.body.textContent).not.toContain('private details');
  await click('Try again'); expect(fetch).toHaveBeenCalledTimes(2);
  expect(document.querySelector('dialog')?.textContent).toContain('No configuration changes recorded.');
});
it('cancels an in-flight read on close and cannot fill a later drawer with old history', async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
  await click('Change history'); const signal = fetch.mock.calls[0][1].signal!;
  await click('Close'); expect(signal.aborted).toBe(true);
  await act(async () => resolve(Response.json({ items: [], olderCursor: null })));
  expect(document.querySelector('dialog')).toBeNull();
});
