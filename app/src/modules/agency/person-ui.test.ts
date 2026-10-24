// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PersonKeysManager } from '@/modules/settings/person-keys/Manager';
import { personKeyCopy } from '@/modules/settings/person-keys/copy';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const directory = { keys: [{ id: 'pk', name: 'Desk', tokenPrefix: 'mcp_person_abc', expiresAt: '2027-01-01T00:00:00Z', createdAt: '2026-10-20T00:00:00Z' }], truncated: false, policy: { nameMaxLength: 100, maxLifetimeDays: 30 } };
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(b => b.textContent === text)! as HTMLButtonElement;
const click = async (element: HTMLElement) => act(async () => element.click());
async function fill(input: HTMLInputElement, value: string) {
 await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const render = (locale: 'en' | 'fr' = 'en') => act(async () => root.render(createElement(PersonKeysManager, { locale })));
beforeEach(() => {
 (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
 container = document.createElement('div'); document.body.append(container); root = createRoot(container);
 vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'POST' ? { token: 'one-time-person-secret' } : init?.method === 'DELETE' ? { revoked: true } : directory)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('requires exact name and lifetime confirmation, preserves the secret only in memory and hides it on demand', async () => {
 await render(); await fill(container.querySelector('input')!, 'Desk');
 await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
 const dialog = document.querySelector('dialog')!;
 expect(dialog.textContent).toContain('CREATE AGENCY KEY Desk 30 DAYS');
 expect(button('Confirm', dialog).disabled).toBe(true);
 await fill(dialog.querySelector('input')!, 'CREATE AGENCY KEY Desk 29 DAYS'); expect(button('Confirm', dialog).disabled).toBe(true);
 expect(vi.mocked(fetch).mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
 await fill(dialog.querySelector('input')!, 'CREATE AGENCY KEY Desk 30 DAYS'); await click(button('Confirm', dialog));
 const posted = vi.mocked(fetch).mock.calls.find(call => call[1]?.method === 'POST')!;
 expect(JSON.parse(posted[1]!.body as string)).toEqual({ name: 'Desk', expiresInDays: 30, confirmation: 'CREATE AGENCY KEY Desk 30 DAYS' });
 expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('one-time-person-secret');
 expect(button('Create Agency key').disabled).toBe(true);
 await click(button('Hide secret')); expect(container.querySelector('textarea')).toBeNull();
});
it('retains failed exact revocation in the dialog for retry and never sends on cancel', async () => {
 await render(); await click(button('Revoke'));
 let dialog = document.querySelector('dialog')!;
 await click(button('Cancel', dialog)); expect(vi.mocked(fetch).mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false);
 await click(button('Revoke')); dialog = document.querySelector('dialog')!;
 await fill(dialog.querySelector('input')!, 'REVOKE AGENCY KEY pk');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 403 }));
 await click(button('Confirm', dialog));
 expect(document.querySelector('dialog')).not.toBeNull(); expect(dialog.querySelector('input')!.value).toBe('REVOKE AGENCY KEY pk'); expect(dialog.querySelector('[role="alert"]')).not.toBeNull();
 await click(button('Confirm', dialog)); expect(document.querySelector('dialog')).toBeNull();
 expect(JSON.parse(vi.mocked(fetch).mock.calls.find(c => c[1]?.method === 'DELETE')![1]!.body as string)).toEqual({ id: 'pk', confirmation: 'REVOKE AGENCY KEY pk' });
});
it('shows localized load failure, retry and empty states and has matching en/fr copy', async () => {
 vi.mocked(fetch).mockRejectedValueOnce(new Error()); await render('fr'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Impossible');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...directory, keys: [] })); await click(button('Réessayer'));
 expect(container.textContent).toContain('Aucun identifiant Agence actif');
 expect(Object.keys(personKeyCopy.en).sort()).toEqual(Object.keys(personKeyCopy.fr).sort());
});
