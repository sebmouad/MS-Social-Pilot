// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateRootWorkspace } from '../src/app/root/workspaces/RootWorkspaceControls';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const inputValue = async (name: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Owner email is unavailable.' }) }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(CreateRootWorkspace, { defaultTimezone: 'Africa/Casablanca', maxName: 80 })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Root workspace creation form', () => {
  it('shows first-field errors before confirmation and blocks malformed timezone input', async () => {
    const submit = container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    await act(async () => submit.click());
    const name = container.querySelector<HTMLInputElement>('[name=name]')!;
    expect(document.activeElement).toBe(name); expect(document.querySelector('dialog')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toContain('workspace name');
    await inputValue('name', 'Example client'); await inputValue('email', 'owner@example.test'); await inputValue('timezone', 'Invalid/Timezone');
    await act(async () => submit.click());
    expect(document.activeElement).toBe(container.querySelector('[name=timezone]')); expect(document.querySelector('dialog')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    expect(name.value).toBe('Example client');
  });
  it('keeps exact confirmation and entered workspace fields after a server refusal', async () => {
    await inputValue('name', 'Example client'); await inputValue('email', 'owner@example.test');
    await act(async () => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    const field = dialog.querySelector<HTMLInputElement>('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'CREATE Example client FOR owner@example.test'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Create workspace')!.click());
    expect(fetch).toHaveBeenCalledOnce(); expect(dialog.open).toBe(true); expect(field.value).toBe('CREATE Example client FOR owner@example.test');
    expect(dialog.querySelector('[role=alert]')?.textContent).toBe('Owner email is unavailable.'); expect(container.querySelector<HTMLInputElement>('[name=name]')!.value).toBe('Example client');
  });
});
