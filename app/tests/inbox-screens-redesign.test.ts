// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxHeader, PersonAvatar } from '@/modules/inbox/ui/InboxChrome';
import { InboxShortcuts } from '@/modules/inbox/ui/InboxShortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('inbox chrome', () => {
  it('renders the inbox module header and a stable initials avatar', () => {
    const header = renderToStaticMarkup(createElement(InboxHeader, { title: 'Conversations', count: 12 }));
    expect(header).toContain('data-module="inbox"');
    expect(header).toContain('Conversations');
    expect(header).toContain('>12<');
    const avatar = renderToStaticMarkup(createElement(PersonAvatar, { name: 'Amina Benali' }));
    expect(avatar).toContain('>AB<');
    expect(avatar).toBe(renderToStaticMarkup(createElement(PersonAvatar, { name: 'Amina Benali' })));
  });

  it('keeps the shortcut copy in both languages, but no always-visible legend', async () => {
    const chrome = await import('@/modules/inbox/ui/InboxChrome');
    expect('ShortcutHint' in chrome).toBe(false);
    expect(chrome.SHORTCUT_COPY.en.resolve).toContain('esolve or reopen');
    expect(chrome.SHORTCUT_COPY.fr.resolve).toContain('résoudre ou rouvrir');
  });
});

describe('inbox keyboard shortcuts', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

  function mount() {
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = `<a href="#1" data-inbox-item>One</a><a href="#2" data-inbox-item>Two</a><a href="#3" data-inbox-item>Three</a>
      <button data-inbox-resolve>Mark resolved</button><textarea data-inbox-reply></textarea><div id="host"></div>`;
    root = createRoot(document.getElementById('host')!);
    act(() => root!.render(createElement(InboxShortcuts)));
  }
  const press = (key: string, target: EventTarget = document.body) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

  it('moves focus with j and k and stays within the list', () => {
    mount();
    press('j'); expect(document.activeElement?.textContent).toBe('One');
    press('j'); expect(document.activeElement?.textContent).toBe('Two');
    press('j'); press('j'); expect(document.activeElement?.textContent).toBe('Three');
    press('k'); expect(document.activeElement?.textContent).toBe('Two');
  });

  it('focuses the reply box with r and resolves with e', () => {
    mount();
    const click = vi.fn();
    document.querySelector('button')!.addEventListener('click', click);
    press('r'); expect(document.activeElement?.tagName).toBe('TEXTAREA');
    (document.activeElement as HTMLElement).blur();
    press('e'); expect(click).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into fields and shortcuts with modifiers', () => {
    mount();
    const click = vi.fn();
    document.querySelector('button')!.addEventListener('click', click);
    press('e', document.querySelector('textarea')!);
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true })); });
    expect(click).not.toHaveBeenCalled();
  });
});
