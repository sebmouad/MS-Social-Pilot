// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldsManager } from '../src/app/publishing/collaboration/FieldsManager';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function button(label: string, parent: ParentNode = container) { const node = [...parent.querySelectorAll('button')].find(item => item.textContent?.trim() === label); if (!node) throw new Error(`Missing ${label}`); return node as HTMLButtonElement; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function enter(node: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }); }
describe('custom field review recovery', () => {
  it('keeps the draft and exact confirmation while displaying and focusing an offline error inside the dialog, then retries', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'field-a', name: 'Retry campaign', kind: 'text', options: [], position: 0 }) });
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(createElement(FieldsManager, { initialFields: [], canManage: true, limits: { fieldLimit: 20, nameMax: 60, optionMax: 60 } })));
    await click(button('New field'));
    await enter(container.querySelector<HTMLInputElement>('input')!, 'Retry campaign');
    await click(button('Review'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(button('Confirm save', dialog).disabled).toBe(true);
    await enter(dialog.querySelector<HTMLInputElement>('input')!, 'CREATE FIELD Retry campaign');
    await click(button('Confirm save', dialog));
    expect(dialog.getAttribute('open')).not.toBeNull();
    const alert = dialog.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('could not be confirmed');
    expect(document.activeElement).toBe(alert);
    expect(dialog.querySelector<HTMLInputElement>('input')!.value).toBe('CREATE FIELD Retry campaign');
    await click(button('Confirm save', dialog));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).toContain('Field created.');
    expect(container.textContent).toContain('Retry campaign');
  });
});
