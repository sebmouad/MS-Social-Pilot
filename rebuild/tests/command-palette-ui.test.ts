// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { CommandPalette } from '../src/components/CommandPalette';
import { COMMAND_COPY } from '../src/modules/home/command-copy';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const items = [
  { id: 'home/overview', title: 'Overview', href: '/home', module: 'home', moduleTitle: 'Home' },
  { id: 'inbox/conversations', title: 'Conversations', href: '/inbox', module: 'inbox', moduleTitle: 'Inbox' },
];

beforeEach(() => {
  if (!window.HTMLDialogElement.prototype.showModal) {
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items }) })));
  push.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function open() {
  await act(async () => root.render(createElement(CommandPalette, { copy: COMMAND_COPY.en })));
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); });
}
function search() { return container.querySelector<HTMLInputElement>('input[type="search"]')!; }

describe('command palette', () => {
  it('opens on Ctrl-K and lists the member’s pages', async () => {
    await open();
    expect(search().placeholder).toBe('Search pages…');
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain('Overview');
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain('Conversations');
  });

  it('filters as you type and opens the picked page on Enter', async () => {
    await open();
    const element = search();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(element, 'inbox');
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain('Conversations');
    expect(container.querySelector('[role="listbox"]')?.textContent).not.toContain('Overview');
    await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(push).toHaveBeenCalledWith('/inbox');
  });

  it('closes on Escape', async () => {
    await open();
    expect(search()).toBeTruthy();
    await act(async () => { search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });
});
