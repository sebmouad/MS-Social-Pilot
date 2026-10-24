// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
import { WorkspaceAccessControl } from '../src/app/root/workspaces/WorkspaceAccessControl';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  await act(async () => root.render(createElement(WorkspaceAccessControl, { id: 'ws', name: 'Studio', suspended: false, deleting: false })));
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  const dialog = document.querySelector('dialog')!;
  const input = dialog.querySelector('input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, 'SUSPEND WORKSPACE ws'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return { dialog, submit: [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Suspend workspace')! };
}
describe('workspace access confirmation', () => {
  it('retains confirmation and a usable retry after a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline transport detail')));
    const { dialog, submit } = await open();
    await act(async () => submit.click());
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input')!.value).toBe('SUSPEND WORKSPACE ws');
    expect(dialog.querySelector('[role=alert]')?.textContent).toContain('could not be confirmed');
    expect(submit.disabled).toBe(false);
    expect(dialog.textContent).not.toContain('transport detail');
  });
  it('blocks duplicate requests while pending and refreshes after confirmation', async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const { submit } = await open();
    await act(async () => { submit.click(); submit.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    await act(async () => resolve(Response.json({ ok: true, suspended: true })));
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(document.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Workspace suspended.');
  });
});
