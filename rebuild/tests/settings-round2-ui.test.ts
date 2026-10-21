// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AccountSecurity } from '@/modules/settings/ui/account/security';
import { WebhookManager } from '@/modules/integrations/ui/WebhookManager';
import { SettingsCopyProvider } from '@/modules/settings/ui/copy-context';
import { settingsUiCopy, settingsUiCopySchema } from '@/modules/settings/ui/copy-catalog';
import { integrationsCopy } from '@/modules/integrations/copy';
import { ToastProvider } from '@/components/Toast';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const response = (value: unknown, ok = true) => ({ ok, json: async () => value } as Response);
const render = (children: ReactNode) => act(async () => root.render(createElement(ToastProvider, { children })));
const click = (item: HTMLElement) => act(async () => item.click());
function button(label: string, parent: ParentNode = container) { const item = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label); if (!item) throw new Error(`Missing ${label}`); return item; }
async function input(item: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(item, value); item.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('validates exact bilingual catalog shape and consumes a Root label override in a live control', async () => {
  const copy = settingsUiCopySchema.parse(settingsUiCopy); copy.security.fr.title = 'Protection personnalisée';
  expect(settingsUiCopySchema.safeParse({ ...copy, account: { en: copy.account.en } }).success).toBe(false);
  expect(settingsUiCopySchema.safeParse({ ...copy, unknown: {} }).success).toBe(false);
  expect(settingsUiCopySchema.safeParse({ ...copy, roles: { ...copy.roles, fr: { ...copy.roles.fr, admin: '' } } }).success).toBe(false);
  vi.mocked(fetch).mockResolvedValue(response({ passkeys: [], required: false, twoStepEnabled: false }));
  await render(createElement(SettingsCopyProvider, { copy, children: createElement(AccountSecurity, { canWrite: true, accountName: 'Synthetic account', locale: 'fr' }) }));
  expect(container.textContent).toContain('Protection personnalisée'); expect(container.textContent).toContain('Aucune clé d’accès enregistrée.');
});
it('names a passkey and retains failed removal for retry without exposing a typed protocol prompt', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ passkeys: [{ id: 'key', name: 'Studio laptop', lastUsedAt: null }], required: false, twoStepEnabled: false })).mockResolvedValueOnce(response({}, false));
  await render(createElement(AccountSecurity, { canWrite: true, accountName: 'Synthetic account', locale: 'en' }));
  await input(container.querySelector<HTMLInputElement>('input[type=password]')!, 'private-password');
  await click(button('Remove passkey')); const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('Studio laptop'); expect(dialog.querySelector('input')).toBeNull();
  await click(button('Remove passkey', dialog));
  expect(dialog.open).toBe(true); expect(dialog.querySelector('[role=alert]')?.textContent).toContain('Could not update');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ currentPassword: 'private-password', code: '', id: 'key', confirmation: 'REMOVE ACCOUNT PASSKEY key' });
});
it('sets up an authenticator, enables it and clears reveal-once recovery codes', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ passkeys: [], required: false, twoStepEnabled: false })).mockResolvedValueOnce(response({ ok: true, secret: 'PRIVATESETUP' })).mockResolvedValueOnce(response({ ok: true, recoveryCodes: ['private-recovery'] })).mockResolvedValueOnce(response({ passkeys: [], required: false, twoStepEnabled: true }));
  await render(createElement(AccountSecurity, { canWrite: true, accountName: 'Synthetic account', locale: 'en' }));
  await input(container.querySelector<HTMLInputElement>('input[type=password]')!, 'private-password');
  await click(container.querySelector('[role=switch]')!); let dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('Synthetic account'); await click(button('Set up authenticator', dialog));
  expect(container.textContent).not.toContain('PRIVATESETUP'); await click(button('Show')); expect(container.textContent).toContain('PRIVATESETUP');
  await input(container.querySelector<HTMLInputElement>('input[autocomplete=one-time-code]')!, '123456'); await click(button('Enable authenticator')); dialog = container.querySelector('dialog')!; await click(button('Enable authenticator', dialog));
  expect(container.textContent).not.toContain('private-recovery'); await click(button('Show')); expect(container.textContent).toContain('private-recovery'); await click(button('I have saved them')); expect(container.textContent).not.toContain('private-recovery');
  expect(container.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('true');
});
const hook = { id: 'hook', name: 'Studio receiver', urlDisplay: 'hooks.example.test/events', events: ['post.published'], enabled: true, source: 'dashboard' as const, lastError: null, lastSentAt: null, pending: 0, failed: 0 };
it('uses shared webhook table/menu, names the tested endpoint and emits success toast', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ delivered: true })).mockResolvedValueOnce(response({ webhooks: [hook] }));
  await render(createElement(WebhookManager, { initial: [hook], events: [], emitted: [], maxEndpoints: 5, nameMaxLength: 60, urlMaxLength: 500, copy: integrationsCopy.en, locale: 'en' }));
  expect(container.querySelector('table.ui-table--stack')).not.toBeNull(); expect(container.querySelector('[aria-haspopup=menu]')).not.toBeNull();
  await click(button('Test')); const dialog = container.querySelector('dialog')!; expect(dialog.textContent).toContain('Studio receiver'); expect(fetch).not.toHaveBeenCalled();
  await click(button('Test', dialog)); expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ confirmation: 'TEST WEBHOOK hook' });
  expect(container.textContent).toContain('The receiver accepted the test.'); expect(container.querySelector('dialog')).toBeNull();
});
it('keeps a failed test dialog and uses configured French copy', async () => {
  vi.mocked(fetch).mockResolvedValue(response({}, false));
  await render(createElement(WebhookManager, { initial: [hook], events: [], emitted: [], maxEndpoints: 5, nameMaxLength: 60, urlMaxLength: 500, copy: integrationsCopy.fr, locale: 'fr' }));
  await click(button('Tester')); const dialog = container.querySelector('dialog')!; await click(button('Tester', dialog));
  expect(dialog.open).toBe(true); expect(dialog.querySelector('[role=alert]')?.textContent).toContain('Cela n’a pas fonctionné');
});
it('reveals a webhook secret only after named confirmation, then clears it from the view', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ secret: 'private-hook-secret' }));
  await render(createElement(WebhookManager, { initial: [hook], events: [], emitted: [], maxEndpoints: 5, nameMaxLength: 60, urlMaxLength: 500, copy: integrationsCopy.en, locale: 'en' }));
  await click(container.querySelector('[aria-haspopup=menu]')!); await click(button('Show secret'));
  const dialog = container.querySelector('dialog')!; expect(dialog.textContent).toContain('Studio receiver'); await click(button('Show secret', dialog));
  expect(container.textContent).not.toContain('private-hook-secret'); await click(button('Show')); expect(container.textContent).toContain('private-hook-secret'); await click(button('I have saved it')); expect(container.textContent).not.toContain('private-hook-secret');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ confirmation: 'REVEAL WEBHOOK SECRET hook' });
});
it('ignores late delivery-history responses after history is closed', async () => {
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockResolvedValueOnce(response({ deliveries: [], hasMore: true })).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(createElement(WebhookManager, { initial: [hook], events: [], emitted: [], maxEndpoints: 5, nameMaxLength: 60, urlMaxLength: 500, copy: integrationsCopy.en, locale: 'en' }));
  await click(container.querySelector('[aria-haspopup=menu]')!); await click(button('History')); await click(button('Show older')); await click(button('Close history'));
  await act(async () => resolve(response({ deliveries: [{ id: 'late', createdAt: '2026-10-20', event: 'ping', status: 'delivered', attempts: 1 }], hasMore: false })));
  expect(container.querySelector('section[aria-label="Delivery history"]')).toBeNull();
});
it('refreshes active sessions after enabling a verification method', async () => {
  const { AccountSettings } = await import('@/modules/settings/ui/account/settings');
  const { accountConfirmationCopy } = await import('@/modules/settings/account-confirmation-copy');
  let enabled = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/sessions')) return response({ sessions: [{ id: 'current', expiresAt: '2099-01-01', current: true }, ...(!enabled ? [{ id: 'old', expiresAt: '2099-01-01', current: false }] : [])], nextOffset: null });
    if (String(url).endsWith('/setup')) return response({ ok: true, secret: 'private-setup' });
    if (String(url).endsWith('/enable') && init?.method === 'POST') { enabled = true; return response({ ok: true, recoveryCodes: ['private-recovery'] }); }
    return response({ passkeys: [], required: false, twoStepEnabled: enabled });
  });
  await render(createElement(AccountSettings, { canWrite: true, nameMaxLength: 100, confirmationCopy: accountConfirmationCopy.en, initialName: 'Synthetic owner', email: 'owner@example.test', passwordPolicy: { minLength: 12, maxBytes: 800 } }));
  expect(container.textContent).toContain('Signed-in session');
  const section = [...container.querySelectorAll('section')].find(item => item.textContent?.includes('Sign-in security'))!;
  await input(section.querySelector<HTMLInputElement>('input[type=password]')!, 'private-password'); await click(section.querySelector('[role=switch]')!); await click(button('Set up authenticator', container.querySelector('dialog')!));
  await input(section.querySelector<HTMLInputElement>('input[autocomplete=one-time-code]')!, '123456'); await click(button('Enable authenticator')); await click(button('Enable authenticator', container.querySelector('dialog')!));
  expect(container.textContent).not.toContain('Signed-in session'); expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/sessions'))).toHaveLength(2);
});
it('disables an authenticator only after confirmation and refreshes its switch and sessions', async () => {
  const changed = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce(response({ passkeys: [], required: false, twoStepEnabled: true }))
    .mockResolvedValueOnce(response({ ok: true }))
    .mockResolvedValueOnce(response({ passkeys: [], required: false, twoStepEnabled: false }));
  await render(createElement(AccountSecurity, { canWrite: true, accountName: 'Synthetic owner', locale: 'en', onChanged: changed }));
  await input(container.querySelector<HTMLInputElement>('input[type=password]')!, 'private-password');
  expect(container.querySelector<HTMLButtonElement>('[role=switch]')!.disabled).toBe(true);
  await input(container.querySelector<HTMLInputElement>('input[autocomplete=one-time-code]')!, '123456');
  await click(container.querySelector('[role=switch]')!);
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('Synthetic owner');
  expect(fetch).toHaveBeenCalledTimes(1);
  await click(button('Disable authenticator', dialog));
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/settings/account/security/disable');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ currentPassword: 'private-password', code: '123456', confirmation: 'DISABLE ACCOUNT TWO STEP' });
  expect(container.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
  expect(changed).toHaveBeenCalledOnce();
});
