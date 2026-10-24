// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRedirect } from '../src/lib/route-redirects';
import { inboxManifest } from '../src/modules/inbox/manifest';
import { InboxCopyProvider } from '../src/modules/inbox/ui/copy-context';
import { inboxCustomerCopy } from '../src/modules/inbox/customer-copy';
import { round3Copy } from '../src/modules/inbox/ui/round3-copy';
import { ThreadDetailsLayout } from '../src/modules/inbox/ui/ThreadDetailsLayout';
import { InboxFilterRow } from '../src/modules/inbox/ui/InboxFilterRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let wide = true;
const listeners = new Set<() => void>();
beforeEach(() => {
  wide = true; listeners.clear();
  window.matchMedia = ((query: string) => ({ get matches() { return wide && query.includes('1280'); }, media: query, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) })) as unknown as typeof window.matchMedia;
});

describe('Inbox rules route', () => {
  it('moves the old moderation address to the Rules tab with a 308 source entry', () => {
    expect(resolveRedirect('/inbox/moderation', '', inboxManifest.redirects)).toBe('/inbox/rules');
  });
  it('serves Rules from /inbox/rules and no longer from /inbox/moderation', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/inbox/rules/page.tsx'), 'utf8');
    expect(page).toContain('ModerationScreen');
    expect(() => readFileSync(join(process.cwd(), 'src/app/inbox/moderation/page.tsx'), 'utf8')).toThrow();
  });
});

describe('Inbox copy', () => {
  it('has the same new screen keys in English and French, and in the Root catalog', () => {
    expect(Object.keys(round3Copy.fr.screen).sort()).toEqual(Object.keys(round3Copy.en.screen).sort());
    for (const key of Object.keys(round3Copy.en.screen)) expect(inboxCustomerCopy[`round3Copy.screen.${key}`]).toBeTruthy();
  });
});

describe('thread details pane', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });
  const mount = () => {
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    act(() => root!.render(createElement(InboxCopyProvider, { catalog: inboxCustomerCopy, children: createElement(ThreadDetailsLayout, { head: createElement('h2', null, 'Amina'), main: createElement('p', null, 'History'), details: createElement('aside', null, 'Contact') }) })));
    return host;
  };

  it('collapses on a wide screen and keeps the pane mounted', () => {
    const host = mount();
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-controls="inbox-details"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-collapsed]')).toBeTruthy();
    expect(host.textContent).toContain('Contact');
  });

  it('opens as a drawer below 1280 px and closes with Escape or the scrim', () => {
    wide = false;
    const host = mount();
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-controls="inbox-details"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    expect(host.querySelector('[data-drawer]')).toBeTruthy();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('[data-drawer]')).toBeNull();
    act(() => toggle.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close details"]')!.click());
    expect(host.querySelector('[data-drawer]')).toBeNull();
  });
});

describe('filter row', () => {
  it('keeps filters in one GET form with the Filter button and the search box', () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    act(() => root.render(createElement(InboxCopyProvider, { catalog: inboxCustomerCopy, children: createElement(InboxFilterRow, { action: '/inbox', resetHref: '/inbox', locale: 'fr', disabledLimit: false, activeCount: 2, quick: ['unread'], filters: { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: 'bonjour' } }) })));
    const form = host.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('get');
    expect(form.querySelector('button.ui-filter-button')?.textContent).toContain('2');
    expect(form.querySelector<HTMLInputElement>('input[name=q]')?.value).toBe('bonjour');
    expect(form.querySelector<HTMLInputElement>('input[name=quick]')?.value).toBe('unread');
    act(() => root.unmount()); host.remove();
  });
});

describe('legend and legacy sidebar', () => {
  it('no longer mounts the always-visible shortcut legend or the sidebar filter panel', () => {
    const screen = readFileSync(join(process.cwd(), 'src/modules/inbox/ui/InboxScreen.tsx'), 'utf8');
    expect(screen).not.toContain('ShortcutHint');
    expect(screen).not.toContain('sidebar=');
    expect(screen).toContain('ThreadDetailsLayout');
  });
});
