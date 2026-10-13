// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useModalFocus } from '../src/components/useModalFocus';
let root: Root;
function Modal({ close }: { close: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true, close);
  return createElement('div', { ref: panel, tabIndex: -1 }, createElement('button', { id: 'first' }, 'First'), createElement('button', { id: 'last' }, 'Last'));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
describe('shared modal behavior', () => {
  it('contains Tab, isolates siblings, restores focus and keeps focus through callback changes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 1 }] as unknown as DOMRectList);
    document.body.innerHTML = '<button id="opener">Open</button><div id="root"></div>';
    const opener = document.getElementById('opener')!;
    opener.focus();
    root = createRoot(document.getElementById('root')!);
    const close = vi.fn();
    await act(async () => root.render(createElement(Modal, { close })));
    expect(document.activeElement?.id).toBe('first');
    expect(opener.inert).toBe(true);
    document.getElementById('last')!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement?.id).toBe('first');
    document.getElementById('last')!.focus();
    await act(async () => root.render(createElement(Modal, { close: () => close() })));
    expect(document.activeElement?.id).toBe('last');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(opener.inert).toBeFalsy();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });
});
