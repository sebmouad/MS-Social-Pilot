// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
import { rootUserConfirmation } from '../src/lib/root-user-controls';
import { RootUserControls } from '../src/app/root/users/RootUserControls';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openSignOut() {
  await act(async () => root.render(createElement(RootUserControls, { id: 'user-1', email: 'person@example.test', disabled: false, root: false, self: false })));
  const opener = container.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
  await act(async () => { opener.focus(); opener.click(); });
  const item = [...container.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(button => button.textContent === 'Sign out')!;
  await act(async () => item.click());
  const dialog = document.querySelector('dialog')!;
  const input = dialog.querySelector('input')!;
  const phrase = rootUserConfirmation('sign-out', 'person@example.test');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, phrase); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return { dialog, input, phrase, opener, submit: [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Sign out sessions')! };
}

describe('Root user account confirmation', () => {
  it('keeps the dialog and confirmation after a recoverable failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Account access changed; reload the directory.' }, { status: 409 })));
    const { dialog, input, phrase, submit } = await openSignOut();
    await act(async () => submit.click());
    expect(dialog.open).toBe(true);
    expect(input.value).toBe(phrase);
    expect(dialog.querySelector('[role=alert]')?.textContent).toContain('reload the directory');
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('blocks a duplicate submit while the request is pending', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const { submit } = await openSignOut();
    await act(async () => { submit.click(); submit.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    await act(async () => resolve(Response.json({ ok: true, userId: 'user-1', action: 'sign-out' })));
    expect(deps.refresh).toHaveBeenCalledOnce();
  });

  it('does not treat a malformed or redirected success as a confirmed change', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>signed in elsewhere</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const { dialog, input, phrase, submit } = await openSignOut();
    await act(async () => submit.click());
    expect(dialog.open).toBe(true);
    expect(input.value).toBe(phrase);
    expect(dialog.querySelector('[role=alert]')?.textContent).toContain('did not confirm');
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('shows a successful receipt, refreshes, and restores focus after dismissing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, userId: 'user-1', action: 'sign-out' })));
    const { dialog, submit, opener } = await openSignOut();
    expect(document.activeElement).toBe(dialog.querySelector('[data-dialog-cancel]'));
    await act(async () => submit.click());
    expect(document.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Active sessions ended.');
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps a cancellable dialog before submission and blocks self controls', async () => {
    await act(async () => root.render(createElement(RootUserControls, { id: 'user-1', email: 'person@example.test', disabled: false, root: false, self: false })));
    const opener = container.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
    await act(async () => { opener.focus(); opener.click(); });
    const item = [...container.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(button => button.textContent === 'Sign out')!;
    await act(async () => item.click());
    const dialog = document.querySelector('dialog')!;
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]')!;
    await act(async () => cancel.click());
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    await act(async () => root.render(createElement(RootUserControls, { id: 'user-1', email: 'person@example.test', disabled: false, root: true, self: true })));
    expect(container.textContent).toContain('Your account');
    expect(container.querySelector('button')).toBeNull();
  });
});
