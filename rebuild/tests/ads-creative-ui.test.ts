// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreativeCreateForm } from '@/modules/ads/ui/CreativeCreateForm';
const sources = { targets: [{ id: 'channel', name: 'Example shop' }], images: [{ id: 'stored-image', mimeType: 'image/png' }], nextTargetOffset: null, nextImageAfter: null, nameMaxCharacters: 100 };
const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const key = 'ads-creation-pending:v2:creative:user:workspace:account';
const props = { adAccountId: 'account', accountName: 'Example ads', ownerScope: { userId: 'user', workspaceId: 'workspace' } };
function value(element: HTMLInputElement | HTMLSelectElement, text: string) {
  Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, text);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
}
async function render(locale: 'en' | 'fr' = 'en') { await act(async () => root.render(createElement(CreativeCreateForm, { ...props, locale }))); }
async function review() {
  await act(async () => {
    value(container.querySelector('input[name="name"]')!, 'Summer');
    value(container.querySelector('select[name="targetId"]')!, 'channel');
    value(container.querySelector('select[name="mediaId"]')!, 'stored-image');
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
async function confirm() {
  await act(async () => value(container.querySelector('dialog input')!, 'EXACT'));
  await act(async () => container.querySelector<HTMLButtonElement>('dialog .ui-dialog__actions button:last-child')!.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (!init?.body) return reply(sources);
    const body = JSON.parse(String(init.body));
    if (body.action === 'preview') return reply({ operation: body.operation, confirmation: 'EXACT', spendChanging: false, blockedByOpenChange: false });
    return reply({ outcome: 'succeeded', recorded: true, created: { objectType: 'creative', remoteId: 'remote-creative' } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('reviews a neutral stored-image request through the shared exact confirmation dialog', async () => {
  await render(); await review();
  const button = container.querySelector<HTMLButtonElement>('dialog .ui-dialog__actions button:last-child')!;
  expect(button.disabled).toBe(true);
  expect(vi.mocked(fetch).mock.calls.filter(call => String(call[1]?.body).includes('"action":"apply"'))).toHaveLength(0);
  await confirm();
  const sent = vi.mocked(fetch).mock.calls.map(call => call[1]?.body ? JSON.parse(String(call[1].body)) : null).find(body => body?.action === 'apply');
  expect(sent).toMatchObject({ confirmation: 'EXACT', operation: { type: 'creative.create', objectType: 'creative', mediaId: 'stored-image', targetId: 'channel' } });
  expect(sent.operation.status).toBeUndefined();
  expect(container.textContent).toContain('Creative created, unattached');
  expect(window.sessionStorage.getItem(key)).toBeNull();
});
it('holds a lost response across reload and reuses the exact original request identity', async () => {
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => { if (String(args[1]?.body).includes('"action":"apply"')) throw new Error('offline'); return base(...args); });
  await render(); await review(); await confirm();
  expect(container.textContent).toContain('outcome is not confirmed');
  const original = JSON.parse(window.sessionStorage.getItem(key)!);
  await act(async () => root.unmount()); root = createRoot(container);
  vi.mocked(fetch).mockImplementation(base); await render();
  expect(container.textContent).toContain('outcome is not confirmed');
  const check = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('same request again'))!;
  await act(async () => check.click());
  const sends = vi.mocked(fetch).mock.calls.filter(call => String(call[1]?.body).includes('"action":"apply"')).map(call => JSON.parse(String(call[1]?.body)));
  expect(sends).toHaveLength(2); expect(sends[0]).toEqual(sends[1]); expect(sends[1].requestId).toBe(original.requestId);
});
it('shows French copy and keeps entered values when review fails', async () => {
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => args[1]?.body ? new Response('{}', { status: 403 }) : base(...args));
  await render('fr'); await review();
  expect(container.textContent).toContain('Créer un visuel publicitaire');
  expect(container.textContent).toContain('Cette demande n’a pas pu aboutir');
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe('Summer');
  expect(window.sessionStorage.getItem(key)).toBeNull();
});
