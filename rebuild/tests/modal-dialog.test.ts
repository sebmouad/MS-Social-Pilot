// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalDialog } from '../src/components/ModalDialog';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let opener: HTMLButtonElement;
const dismiss = vi.fn();
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
  // Native dialogs are programmatically focusable; JSDOM needs this shim.
  this.tabIndex = -1;
});
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });

async function render(busy = false, initialFocus?: string) {
  await act(async () => root.render(createElement(ModalDialog, { busy, initialFocus, labelledBy: 'example-title', onDismiss: dismiss, children: createElement('div', null,
    createElement('h2', { id: 'example-title' }, 'Example confirmation'),
    createElement('button', { 'data-dialog-cancel': '', disabled: busy }, 'Cancel'),
    createElement('button', { 'data-dialog-confirm': '', disabled: busy }, 'Confirm'),
  ) })));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
  opener = document.createElement('button'); opener.textContent = 'Open'; document.body.append(opener); opener.focus();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); opener.remove(); });

describe('shared modal focus', () => {
  it('keeps focus inside while controls are disabled and recovers to Cancel after failure', async () => {
    await render();
    const dialog = container.querySelector('dialog')!;
    const confirm = container.querySelector<HTMLButtonElement>('[data-dialog-confirm]')!;
    confirm.focus();
    await render(true);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    await render(false);
    expect(document.activeElement).toBe(container.querySelector('[data-dialog-cancel]'));
    expect(dialog.open).toBe(true);
  });

  it('changes the initial-focus target without closing and reopening the modal', async () => {
    await render();
    await render(false, '[data-dialog-confirm]');
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('returns focus to the original opener after closing', async () => {
    await render();
    expect(document.activeElement).toBe(container.querySelector('[data-dialog-cancel]'));
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });
});
