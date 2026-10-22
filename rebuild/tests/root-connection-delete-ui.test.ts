// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
import { DeleteConnectionData } from '../src/app/root/connections/DeleteConnectionData';
import { rootCopy } from '../src/modules/root/server/admin/copy';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const counts = { channels: 2, adAccounts: 1, postTargets: 7, orphanPosts: 3, comments: 9, conversations: 4, conversationMessages: 11, pageInsights: 30, adInsights: 5, scheduledRemote: 0 };
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
  await act(async () => root.render(createElement(DeleteConnectionData, { id: 'c1', name: 'Synthetic connection', locale })));
  await act(async () => { container.querySelector('button')!.click(); });
  const dialog = document.querySelector('dialog');
  const submit = dialog ? [...dialog.querySelectorAll('button')].find(b => b.textContent === t.deleteData) : undefined;
  const type = async (text: string) => act(async () => {
    const input = dialog!.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { dialog, submit, type, t };
}
const preview = (extra: Record<string, unknown> = {}) => Response.json({ ok: true, counts: { ...counts, ...extra } });

it('shows the counted consequences, needs the exact phrase and sends delete mode', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce(Response.json({ ok: true, mode: 'delete' })); vi.stubGlobal('fetch', fetch);
  const { dialog, submit, type, t } = await open();
  expect(fetch.mock.calls[0]).toEqual(['/api/root/connections/c1', { method: 'GET' }]);
  expect(dialog!.textContent).toContain('2 channels, 1 ad accounts, 7 post destinations (3 posts removed entirely), 9 comments');
  expect(dialog!.textContent).not.toContain('destinations are still scheduled');
  expect(submit!.disabled).toBe(true);
  await type('DELETE CONNECTION DATA other'); expect(submit!.disabled).toBe(true);
  await type('DELETE CONNECTION DATA c1'); await act(async () => submit!.click());
  expect(fetch.mock.calls[1]).toEqual(['/api/root/connections/c1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirmation: 'DELETE CONNECTION DATA c1', mode: 'delete' }) })]);
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(container.querySelector('[role=status]')?.textContent).toBe(t.deleteDataDone);
});

it('warns about provider-scheduled posts and keeps the dialog on an unconfirmed failure without leaking server text', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(preview({ scheduledRemote: 2 })).mockResolvedValueOnce(Response.json({ error: 'secret-sql-detail', code: 'internal' }, { status: 500 })));
  const { dialog, submit, type, t } = await open('fr');
  expect(dialog!.textContent).toContain('2 destinations sont encore programmées');
  await type('DELETE CONNECTION DATA c1'); await act(async () => submit!.click());
  expect(dialog!.open).toBe(true);
  expect(dialog!.querySelector('[role=alert]')?.textContent).toBe(t.deleteDataUnconfirmed);
  expect(container.textContent).not.toContain('secret-sql-detail'); expect(h.refresh).not.toHaveBeenCalled();
});

it('does not open the dialog when the preview cannot be read', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, counts: { channels: 'many' } })));
  const { dialog, t } = await open();
  expect(dialog).toBeNull();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(t.deleteDataPreviewFailed);
});
