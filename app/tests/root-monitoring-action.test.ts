// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { MonitoringAction } from '@/modules/root/ui/MonitoringAction';
import { ROOT_MONITORING_COPY } from '@/modules/root/monitoring-config';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function open(locale: 'en' | 'fr') {
  const copy = ROOT_MONITORING_COPY[locale];
  await act(async () => root.render(createElement(MonitoringAction, { copy, confirmation: 'EVALUATE ROOT MONITORING', testConfirmation: 'TEST ROOT MONITORING' })));
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === copy.test)!.click());
  const dialog = document.querySelector('dialog')!;
  const submit = [...dialog.querySelectorAll('button')].find(b => b.textContent === copy.test)!;
  const input = dialog.querySelector('input')!;
  async function type(text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
  return { dialog, submit, input, type, copy };
}
it('preserves exact confirmation and refuses malformed delivery receipts without showing private failures', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ queued: true })); vi.stubGlobal('fetch', fetch);
  const { dialog, submit, input, type, copy } = await open('en');
  expect(dialog.textContent).toContain(copy.testReview);
  expect(submit.disabled).toBe(true);
  await type('TEST ROOT MONITORING'); await act(async () => submit.click());
  expect(fetch).toHaveBeenCalledWith('/api/root/monitoring/test', expect.objectContaining({ body: JSON.stringify({ confirmation: 'TEST ROOT MONITORING' }) }));
  expect(dialog.open).toBe(true); expect(input.value).toBe('TEST ROOT MONITORING');
  expect(dialog.querySelector('[role=alert]')?.textContent).toBe(copy.testFailure);
  expect(m.refresh).not.toHaveBeenCalled();
});
it('shows and focuses a French queued receipt without claiming delivery', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ queued: true, id: 'receipt' })));
  const { dialog, submit, type, copy } = await open('fr');
  await type('TEST ROOT MONITORING'); await act(async () => submit.click());
  expect(dialog.open).toBe(false); expect(m.refresh).toHaveBeenCalledOnce();
  const feedback = container.querySelector('[role=status]');
  expect(feedback?.textContent).toBe(copy.testSuccess);
  expect(document.activeElement).toBe(feedback);
});
