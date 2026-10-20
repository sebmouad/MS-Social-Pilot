// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
import { RefreshConnection } from '../src/app/root/connections/RefreshConnection';
import { rootCopy } from '../src/server/root/legacy/copy';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function open(locale: 'en' | 'fr' = 'en') {
  const t = rootCopy(locale);
  await act(async () => root.render(createElement(RefreshConnection, { id: 'c1', name: 'Synthetic connection', locale })));
  const opener = container.querySelector('button')!;
  await act(async () => { opener.focus(); opener.click(); });
  const dialog = document.querySelector('dialog')!;
  const submit = [...dialog.querySelectorAll('button')].find(b => b.textContent === t.refresh)!;
  const input = dialog.querySelector('input')!;
  const type = async (text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { opener, dialog, submit, input, type };
}
it('requires the exact phrase, retains context on unconfirmed failure and hides server text', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'secret-provider-url' }, { status: 500 })); vi.stubGlobal('fetch', fetch);
  const { dialog, submit, input, type } = await open();
  expect(dialog.textContent).toContain('Synthetic connection');
  expect(document.activeElement?.textContent).toBe('Cancel');
  expect(submit.disabled).toBe(true);
  await type('REFRESH CONNECTION other'); expect(submit.disabled).toBe(true);
  await type('REFRESH CONNECTION c1'); await act(async () => submit.click());
  expect(fetch).toHaveBeenCalledWith('/api/root/connections/c1/refresh', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirmation: 'REFRESH CONNECTION c1' }) }));
  expect(dialog.open).toBe(true); expect(input.value).toBe('REFRESH CONNECTION c1');
  expect(dialog.querySelector('[role=alert]')?.textContent).toBe(rootCopy('en').refreshUnconfirmed);
  expect(container.textContent).not.toContain('secret-provider-url'); expect(h.refresh).not.toHaveBeenCalled();
});
it.each(['renewed', 'not_renewable', 'failed'] as const)('shows the localized %s outcome and restores focus', async outcome => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, outcome })));
  const { dialog, submit, type, opener } = await open('fr');
  await type('REFRESH CONNECTION c1'); await act(async () => submit.click());
  expect(dialog.open).toBe(false); expect(document.activeElement).toBe(opener);
  expect(h.refresh).toHaveBeenCalledOnce();
  const t = rootCopy('fr');
  expect(container.querySelector('[role=status]')?.textContent).toBe(outcome === 'renewed' ? t.refreshRenewed : outcome === 'not_renewable' ? t.refreshNotRenewable : t.refreshFailed);
});
it('guards duplicate submits and refuses malformed success receipts', async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
  const { dialog, submit, type } = await open();
  await type('REFRESH CONNECTION c1'); await act(async () => { submit.click(); submit.click(); });
  expect(fetch).toHaveBeenCalledOnce(); expect(submit.disabled).toBe(true);
  await act(async () => resolve(Response.json({ ok: true, outcome: 'unexpected' })));
  expect(dialog.open).toBe(true); expect(h.refresh).not.toHaveBeenCalled();
});
