// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { CommandPalette } from '../src/components/CommandPalette';
import { COMMAND_COPY } from '../src/modules/home/command-copy';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const payload = {
  actions: [{ id: 'create-publishing', title: 'New post', href: '/create' }],
  items: [
    { id: 'home/overview', title: 'Overview', href: '/home', module: 'home', moduleTitle: 'Home' },
    { id: 'inbox/conversations', title: 'Conversations', href: '/inbox', module: 'inbox', moduleTitle: 'Inbox' },
  ],
  channels: [{ id: 'c1', title: 'North Market', href: '/inbox?channel=c1', health: 'connected' }],
};

beforeEach(() => {
  if (!window.HTMLDialogElement.prototype.showModal) {
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
  push.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function open() {
  await act(async () => root.render(createElement(CommandPalette, { copy: COMMAND_COPY.en })));
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); });
}
function search() { return container.querySelector<HTMLInputElement>('input[type="search"]')!; }
async function type(text: string) {
  const element = search();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('command palette', () => {
  it('opens on Ctrl-K and groups actions, pages and channels', async () => {
    await open();
    expect(search().placeholder).toBe('Search pages, actions and channels…');
    const listbox = container.querySelector('[role="listbox"]')!;
    expect([...listbox.querySelectorAll('[role="group"]')].map(group => group.getAttribute('aria-label'))).toEqual(['Create', 'Pages', 'Channels']);
    expect(listbox.textContent).toContain('New post');
    expect(listbox.textContent).toContain('North Market');
  });

  it('filters every group as you type and hides empty groups', async () => {
    await open();
    await type('inbox');
    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox.textContent).toContain('Conversations');
    expect(listbox.textContent).not.toContain('Overview');
    expect(listbox.textContent).not.toContain('New post');
    expect([...listbox.querySelectorAll('[role="group"]')].map(group => group.getAttribute('aria-label'))).toEqual(['Pages']);
    await type('zzz-no-match');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Nothing matches.');
  });

  it('moves through every group with the arrows and opens the picked row on Enter', async () => {
    await open();
    const element = search();
    expect(element.getAttribute('aria-activedescendant')).toContain('action-create-publishing');
    await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    expect(search().getAttribute('aria-activedescendant')).toContain('page-inbox/conversations');
    await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(push).toHaveBeenCalledWith('/inbox');
  });

  it('jumps to a channel profile from the Channels group', async () => {
    await open();
    await type('north');
    expect(search().getAttribute('aria-activedescendant')).toContain('channel-c1');
    await act(async () => { search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(push).toHaveBeenCalledWith('/inbox?channel=c1');
  });

  it('closes on Escape', async () => {
    await open();
    expect(search()).toBeTruthy();
    await act(async () => { search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });
});
