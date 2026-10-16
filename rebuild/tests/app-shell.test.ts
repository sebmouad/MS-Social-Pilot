// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const path = vi.hoisted(() => ({ value: '/publishing/posts' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.value }));
import { AppShell } from '../src/components/AppShell';
import { SidebarDock } from '../src/components/SidebarDock';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 1, height: 1 }] as unknown as DOMRectList);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(enabledFeatures = ['publishing/posts', 'publishing/calendar'], extra: Partial<ComponentProps<typeof AppShell>> = {}) {
  await act(async () => root.render(createElement(AppShell, {
    activeModule: 'publishing', enabledModules: ['publishing', 'ads'], enabledFeatures,
    rootAccess: false, userName: 'Preview', workspaceName: 'Example workspace',
    sidebar: createElement('button', null, 'Apply filters'),
    children: createElement('div', null, 'Example posts', createElement(SidebarDock, { children: createElement('input', { 'aria-label': 'Route setting' }) })),
    ...extra,
  })));
}
describe('two-sidebar app shell', () => {
  it('provides a mobile exit from private Root to the customer app', async () => {
    await render([], { installationMode: true, rootAccess: true });
    expect(container.querySelector('.shell-nav--mobile a[href="/home"]')).not.toBeNull();
  });
  it('moves focus to visible contextual navigation when the drawer becomes desktop navigation', async () => {
    let listener: (() => void) | undefined;
    const media = { matches: false, addEventListener: (_event: string, callback: () => void) => { listener = callback; }, removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => media);
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('.shell-filter-toggle')!.click());
    media.matches = true;
    await act(async () => listener?.());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.shell-subnav [aria-current="page"]'));
  });
  it('reports a failed sign-out and keeps the action available for retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await render();
    const signOut = [...container.querySelectorAll('button')].find(button => button.textContent === 'Sign out')!;
    await act(async () => signOut.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not sign out');
    expect(signOut.disabled).toBe(false);
  });
  it('preserves the selected workspace and reports a failed switch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await render(undefined, { workspaceId: 'a', workspaces: [{ id: 'a', name: 'Current' }, { id: 'b', name: 'Another' }] });
    const select = container.querySelector<HTMLSelectElement>('#shell-workspace')!;
    await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(select.value).toBe('a');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be switched');
  });
  it('separates module navigation from contextual pages and docks route controls there', async () => {
    await render();
    const rail = container.querySelector('aside[aria-label="Modules"]');
    const context = container.querySelector('aside[aria-label="Publishing navigation"]');
    expect(rail).not.toBeNull(); expect(context).not.toBeNull();
    expect(rail?.querySelector('a[href="/ads"]')).toBeNull();
    expect(context?.querySelector('a[href="/publishing/calendar"]')).not.toBeNull();
    expect(context?.querySelector('[aria-label="Route setting"]')).not.toBeNull();
    expect(container.querySelector('main [aria-label="Route setting"]')).toBeNull();
  });
  it('does not render unavailable feature links', async () => {
    await render(['publishing/posts']);
    expect(container.querySelector('aside[aria-label="Publishing navigation"] a[href="/publishing/calendar"]')).toBeNull();
  });
  it('opens one contextual drawer, focuses its close control and restores the opener on Escape', async () => {
    await render();
    const toggle = container.querySelector<HTMLButtonElement>('.shell-filter-toggle')!;
    toggle.focus(); await act(async () => toggle.click());
    const drawer = container.querySelector('[role="dialog"]')!;
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.contains(document.activeElement)).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
});
