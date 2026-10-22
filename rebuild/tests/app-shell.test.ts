// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const nav = vi.hoisted(() => ({ path: '/content', search: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { AppShell } from '../src/components/AppShell';
import { SHELL_COPY, SHELL_POLICY, type ShellCopy, type ShellPolicy } from '../src/modules/shell/copy';

const copy = SHELL_COPY.en as unknown as ShellCopy;
const policy = SHELL_POLICY as unknown as ShellPolicy;
const channels = [
  { id: 'c1', name: 'North Market', pictureUrl: null, health: 'connected' as const },
  { id: 'c2', name: 'South Market', pictureUrl: null, health: 'expired' as const },
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nav.path = '/content'; nav.search = '';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 1, height: 1 }] as unknown as DOMRectList);
  // jsdom has no modal dialog support: model open/close with the attribute.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  document.cookie = 'sp_scope_w1=; max-age=0; path=/';
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const FEATURES = ['home/overview', 'publishing/posts', 'publishing/calendar', 'inbox/conversations', 'analytics/overview', 'settings/account', 'settings/connections'];
async function render(extra: Partial<ComponentProps<typeof AppShell>> = {}, enabledFeatures: string[] = FEATURES) {
  await act(async () => root.render(createElement(AppShell, {
    activeModule: 'publishing', enabledModules: ['home', 'publishing', 'inbox', 'analytics', 'settings'], enabledFeatures, writableFeatures: ['publishing/posts'],
    rootAccess: false, userName: 'Preview', workspaceName: 'Example workspace', workspaceId: 'w1', copy, policy, channels,
    children: createElement('div', null, 'Example posts', createElement('input', { 'aria-label': 'Route setting' })),
    ...extra,
  })));
}
const text = (selector: string) => container.querySelector(selector)?.textContent ?? '';

describe('single-sidebar app shell', () => {
  it('lists the work areas in fixed order with the current one marked', async () => {
    await render();
    const labels = [...container.querySelectorAll('.shell-areas .shell-area')].map(link => link.textContent);
    expect(labels).toEqual(['Home', 'Content', 'Inbox', 'Insights']);
    expect(container.querySelector('.shell-areas [data-area="content"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.shell-areas [data-area="insights"]')?.getAttribute('aria-current')).toBeNull();
    expect(container.querySelector('a.shell-create')?.getAttribute('href')).toBe('/create');
  });

  it('shows Tasks and Agency only when the workspace uses them', async () => {
    await render({}, [...FEATURES, 'tasks/board', 'agency/overview']);
    expect([...container.querySelectorAll('.shell-areas .shell-area')].map(link => link.textContent)).not.toContain('Tasks');
    await render({ optionalAreas: ['tasks'] }, [...FEATURES, 'tasks/board', 'agency/overview']);
    const labels = [...container.querySelectorAll('.shell-areas .shell-area')].map(link => link.textContent);
    expect(labels).toContain('Tasks');
    expect(labels).not.toContain('Agency');
  });

  it('renders the pages of the current area as link tabs and hides unavailable pages', async () => {
    await render();
    const tabs = container.querySelector('nav.ui-tabs--links')!;
    expect(tabs.getAttribute('aria-label')).toBe('Content sections');
    expect([...tabs.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/content', '/content/calendar']);
    expect(tabs.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/content');
    await render({}, ['publishing/posts']);
    expect(container.querySelector('nav.ui-tabs--links')).toBeNull();
  });

  it('badges the Approvals tab with the pending count and keeps the parent tab current inside Library sections and post pages', async () => {
    const features = [...FEATURES, 'publishing/approvals', 'publishing/media', 'publishing/queue'];
    await render({ tabCounts: { 'publishing/approvals': 3 } }, features);
    const tabs = container.querySelector('nav.ui-tabs--links')!;
    expect([...tabs.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/content', '/content/calendar', '/content/queue', '/content/approvals', '/content/library']);
    expect(tabs.querySelector('a[href="/content/approvals"] .ui-tabs__count')?.textContent).toBe('3');
    expect(tabs.querySelector('a[href="/content/queue"] .ui-tabs__count')).toBeNull();
    nav.path = '/content/library/templates';
    await render({}, [...features, 'publishing/templates']);
    expect(container.querySelector('nav.ui-tabs--links [aria-current="page"]')?.getAttribute('href')).toBe('/content/library');
    nav.path = '/content/post/abc';
    await render({}, features);
    expect(container.querySelector('nav.ui-tabs--links [aria-current="page"]')?.getAttribute('href')).toBe('/content');
  });

  it('lists scoped channels with status, and sidebar and scope chip stay in sync with the URL', async () => {
    nav.search = 'channel=c2';
    await render();
    const items = [...container.querySelectorAll('.shell-sidebar .ui-scope__item')];
    expect(items.map(item => item.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(text('.shell-sidebar .ui-scope__list')).toContain('Reconnect needed');
    expect(text('.shell-scope-chip')).toBe('South Market');
  });

  it('removes unknown channels from the view and says so', async () => {
    nav.search = 'channel=c1,gone';
    await render();
    expect(text('.shell-notice')).toBe('1 channel is no longer available and was removed from the view.');
    expect(text('.shell-scope-chip')).toBe('North Market');
  });

  it('remembers a clicked channel in the scope cookie', async () => {
    await render();
    const north = [...container.querySelectorAll<HTMLButtonElement>('.shell-sidebar .ui-scope__item')].find(item => item.textContent?.includes('North Market'))!;
    await act(async () => north.click());
    expect(document.cookie).toContain('sp_scope_w1=c1');
  });

  it('renders route controls in-page with no Page tools sheet or toggle', async () => {
    await render();
    expect(container.querySelector('main [aria-label="Route setting"]')).not.toBeNull();
    expect(container.querySelector('.shell-tools-toggle')).toBeNull();
    expect(container.querySelector('dialog.shell-tools')).toBeNull();
  });

  it('provides a phone exit from private Root to the customer app', async () => {
    await render({ installationMode: true, rootAccess: true }, []);
    expect(container.querySelector('.ui-bottombar a[href="/home"]')).not.toBeNull();
    expect(container.querySelector('.shell-areas a[href="/root"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.shell-root-badge')?.textContent).toContain('Root');
    expect(container.querySelector('.shell-channels')).toBeNull();
  });

  it('shows the phone bottom bar with a Create button between the areas', async () => {
    await render();
    const bar = container.querySelector('nav.ui-bottombar')!;
    const order = [...bar.querySelectorAll('a')].map(link => link.getAttribute('aria-label') ?? link.textContent);
    expect(order).toEqual(['Home', 'Content', 'Create post', 'Inbox', 'Insights']);
  });

  it('reports a failed sign-out through the account menu and keeps it retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('.shell-user button[aria-haspopup=menu]')!.click());
    const signOut = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(item => item.textContent === 'Sign out')!;
    await act(async () => signOut.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not sign out');
  });

  it('sends the exact workspace confirmation and keeps the selection on refusal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await render({ workspaces: [{ id: 'w1', name: 'Current' }, { id: 'b', name: 'Another' }] });
    const select = container.querySelector<HTMLSelectElement>('#shell-workspace')!;
    await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ workspaceId: 'b', confirmation: 'SELECT WORKSPACE b' });
    expect(select.value).toBe('w1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be switched');
  });

  it('opens the overlay menu, traps nothing outside, and restores the opener on Escape', async () => {
    await render();
    const toggle = container.querySelector<HTMLButtonElement>('.shell-menu-toggle')!;
    toggle.focus(); await act(async () => toggle.click());
    const menu = container.querySelector('aside.shell-sidebar')!;
    expect(menu.getAttribute('role')).toBe('dialog');
    expect(menu.getAttribute('aria-modal')).toBe('true');
    expect(menu.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('.shell-main')?.hasAttribute('inert')).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('aside.shell-sidebar')?.getAttribute('role')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('leaves Escape to an open native dialog above the menu', async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('.shell-menu-toggle')!.click());
    const modal = document.createElement('dialog');
    const confirm = document.createElement('button');
    modal.append(confirm); modal.setAttribute('open', ''); document.body.append(modal); confirm.focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => confirm.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false);
    expect(container.querySelector('aside.shell-sidebar')?.getAttribute('role')).toBe('dialog');
    modal.remove();
  });

  it('collapses to the rail and remembers the choice', async () => {
    await render();
    expect(container.querySelector('.shell')?.getAttribute('data-rail')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('.shell-collapse')!.click());
    expect(container.querySelector('.shell')?.getAttribute('data-rail')).toBe('true');
    expect(document.cookie).toContain('sp_sidebar=1');
    expect(container.querySelector('.shell-area')?.getAttribute('title')).toBe('Home');
  });
});
