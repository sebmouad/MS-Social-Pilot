// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
import { RegistrationAction } from '../src/app/root/registration/RegistrationAction';
import { registrationCopy } from '../src/app/root/registration/copy';
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
async function open(action: 'revoke' | 'resend' | 'delete', locale: 'en' | 'fr' = 'en') {
  const t = registrationCopy[locale];
  await act(async () => root.render(createElement(RegistrationAction, { id: 'id1', email: 'synthetic@example.invalid', action, workspaceId: 'w1', workspaceName: 'Example', copy: t })));
  const opener = container.querySelector('button')!;
  await act(async () => { opener.focus(); opener.click(); });
  const dialog = document.querySelector('dialog')!;
  const submit = [...dialog.querySelectorAll('button')].find(b => b.textContent === t[action])!;
  const input = dialog.querySelector('input')!;
  const phrase = action === 'revoke' ? 'REVOKE INVITATION id1' : action === 'resend' ? 'RESEND VERIFICATION id1' : 'DELETE UNVERIFIED ACCOUNT id1';
  const type = async (text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { opener, dialog, submit, input, phrase, type };
}
it('requires the exact invitation confirmation and retains input on failure', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: false }, { status: 409 })); vi.stubGlobal('fetch', fetch);
  const { dialog, input, submit, phrase, type } = await open('revoke');
  expect(submit.disabled).toBe(true);
  expect(document.activeElement?.textContent).toBe('Cancel');
  await type('REVOKE INVITATION other'); expect(submit.disabled).toBe(true);
  await type(phrase); await act(async () => submit.click());
  expect(fetch).toHaveBeenCalledWith('/api/root/registration/invitations/id1', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ confirmation: phrase, workspaceId: 'w1' }) }));
  expect(dialog.open).toBe(true); expect(input.value).toBe(phrase);
  expect(dialog.querySelector('[role=alert]')?.textContent).toBe(registrationCopy.en.failed);
  expect(h.refresh).not.toHaveBeenCalled();
});
it('prevents repeated submits and closes/refreshes only on a valid receipt', async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
  const { dialog, opener, submit, phrase, type } = await open('delete');
  await type(phrase); await act(async () => { submit.click(); submit.click(); });
  expect(fetch).toHaveBeenCalledOnce(); expect(submit.disabled).toBe(true);
  await act(async () => resolve(Response.json({ ok: true, deleted: true, userId: 'id1' })));
  expect(dialog.open).toBe(false); expect(h.refresh).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(opener);
  expect(container.querySelector('[role=status]')?.textContent).toBe('Account deleted.');
});
it('keeps uncertain email delivery visible in French without a success claim', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, delivery: 'uncertain', userId: 'id1' })));
  const { dialog, submit, phrase, type } = await open('resend', 'fr');
  expect(dialog.textContent).toContain('synthetic@example.invalid');
  await type(phrase); await act(async () => submit.click());
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('[role=alert]')?.textContent).toBe(registrationCopy.fr.uncertain);
  expect(h.refresh).not.toHaveBeenCalled();
});
it('does not accept malformed success and can cancel without making a request', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
  const { dialog, submit, phrase, type } = await open('delete');
  await type(phrase); await act(async () => submit.click());
  expect(dialog.open).toBe(true); expect(h.refresh).not.toHaveBeenCalled();
  await act(async () => (dialog.querySelector('[data-dialog-cancel]') as HTMLButtonElement).click());
  expect(dialog.open).toBe(false); expect(fetch).toHaveBeenCalledOnce();
});

it('preserves the original simple useConfirm contract', async () => {
  const { useConfirm } = await import('../src/components/useConfirm');
  const answer = vi.fn();
  function Simple() {
    const [ask, dialog] = useConfirm({ title: 'Simple', cancel: 'Cancel', confirm: 'Continue' });
    return createElement('div', {}, createElement('button', { onClick: () => void ask('Continue?').then(answer) }, 'Open'), dialog);
  }
  await act(async () => root.render(createElement(Simple)));
  await act(async () => container.querySelector('button')!.click());
  const submit = [...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Continue') as HTMLButtonElement;
  await act(async () => submit.click());
  expect(answer).toHaveBeenCalledWith(true);
  expect(document.querySelector('dialog')).toBeNull();
});
