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
const FEATURES = ['home/overview', 'publishing/posts', 'publishing/calendar', 'inbox/conversations', 'analytics/overview', 'ads/overview', 'settings/account', 'settings/connections'];
async function render(extra: Partial<ComponentProps<typeof AppShell>> = {}, enabledFeatures: string[] = FEATURES) {
  await act(async () => root.render(createElement(AppShell, {
    activeModule: 'publishing', enabledModules: ['home', 'publishing', 'inbox', 'analytics', 'ads', 'settings'], enabledFeatures, writableFeatures: ['publishing/posts'],
    rootAccess: false, userName: 'Preview', workspaceName: 'Example workspace', workspaceId: 'w1', copy, policy, channels,
    children: createElement('div', null, 'Example posts', createElement('input', { 'aria-label': 'Route setting' })),
    ...extra,
  })));
}
const text = (selector: string) => container.querySelector(selector)?.textContent ?? '';

describe('single-sidebar app shell', () => {
  it('lists the five hubs in fixed order with the current one marked', async () => {
    await render();
    const labels = [...container.querySelectorAll('.shell-hubs .shell-hub')].map(link => link.querySelector('.shell-hub__label')?.textContent);
    expect(labels).toEqual(['Create', 'Plan', 'Engage', 'Measure', 'Grow']);
    expect(container.querySelector('.shell-hubs [data-hub="plan"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.shell-hubs [data-hub="measure"]')?.getAttribute('aria-current')).toBeNull();
    expect(container.querySelector('a.shell-create')?.getAttribute('href')).toBe('/create');
  });

  it('marks no hub on the Home landing and keeps Settings in the footer', async () => {
    nav.path = '/home';
    await render({ activeModule: 'home' }, [...FEATURES]);
    expect(container.querySelector('.shell-hubs [aria-current]')).toBeNull();
    expect(container.querySelector('nav.ui-tabs--links')).toBeNull();
    nav.path = '/settings/team';
    await render({ activeModule: 'settings' }, [...FEATURES, 'settings/team', 'settings/workspace']);
    expect(container.querySelector('.shell-hubs [aria-current]')).toBeNull();
    expect(container.querySelector('.shell-sidebar__foot [aria-current="page"]')?.textContent).toBe('Settings');
    expect([...container.querySelectorAll('.shell-settings__list a')].map(link => link.getAttribute('href'))).toEqual(['/settings/workspace', '/settings/channels', '/settings/team', '/settings/account']);
  });

  it('joins Tasks to Plan and Agency to Grow only when the workspace uses them', async () => {
    const features = [...FEATURES, 'tasks/board', 'agency/overview', 'agency/clients'];
    await render({}, features);
    expect([...container.querySelectorAll('nav.ui-tabs--links a')].map(link => link.getAttribute('href'))).toEqual(['/content', '/content/calendar']);
    nav.path = '/ads';
    await render({ activeModule: 'ads' }, features);
    expect(container.querySelector('nav.ui-tabs--links')).toBeNull();
    await render({ activeModule: 'ads', optionalAreas: ['tasks', 'agency'] }, features);
    expect([...container.querySelectorAll('nav.ui-tabs--links a')].map(link => link.getAttribute('href'))).toEqual(['/ads', '/agency', '/agency/clients']);
    nav.path = '/tasks';
    await render({ activeModule: 'tasks', optionalAreas: ['tasks'] }, features);
    expect(container.querySelector('.shell-hubs [data-hub="plan"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('renders the pages of the current hub as link tabs and hides unavailable pages', async () => {
    await render();
    const tabs = container.querySelector('nav.ui-tabs--links')!;
    expect(tabs.getAttribute('aria-label')).toBe('Plan sections');
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

  it('badges the hubs with mentions, approvals and alerts, named for assistive technology', async () => {
    await render({ hubCounts: { engage: 2, plan: 3, measure: 101 } });
    expect(container.querySelector('.shell-hubs [data-hub="plan"] .shell-hub__badge')?.textContent).toBe('3');
    expect(container.querySelector('.shell-hubs [data-hub="plan"]')?.getAttribute('aria-label')).toBe('Plan, 3 waiting for review');
    expect(container.querySelector('.shell-hubs [data-hub="engage"]')?.getAttribute('aria-label')).toBe('Engage, 2 mentions');
    expect(container.querySelector('.shell-hubs [data-hub="measure"] .shell-hub__badge')?.textContent).toBe('99+');
    expect(container.querySelector('.shell-hubs [data-hub="create"] .shell-hub__badge')).toBeNull();
    expect(container.querySelector('.shell-hubs [data-hub="create"]')?.getAttribute('aria-label')).toBeNull();
    const bar = container.querySelector('nav.ui-bottombar')!;
    expect(bar.querySelector('a[data-hub="engage"] .ui-bottombar__badge')?.textContent).toBe('2');
    expect(bar.querySelector('a[data-hub="engage"]')?.getAttribute('aria-label')).toBe('Engage, 2 mentions');
    expect(bar.querySelector('a[data-hub="grow"] .ui-bottombar__badge')).toBeNull();
  });

  it('shows the Feeds Plan tab, the Create hub tabs and the Caption tests Measure tab', async () => {
    await render({}, [...FEATURES, 'publishing/queue', 'publishing/approvals', 'publishing/media', 'publishing/feeds']);
    expect([...container.querySelectorAll('nav.ui-tabs--links a')].map(link => link.getAttribute('href'))).toEqual([
      '/content', '/content/calendar', '/content/queue', '/content/approvals', '/content/library', '/content/feeds',
    ]);
    nav.path = '/content/feeds';
    await render({}, [...FEATURES, 'publishing/feeds']);
    expect(container.querySelector('nav.ui-tabs--links [aria-current="page"]')?.getAttribute('href')).toBe('/content/feeds');
    expect(container.querySelector('.shell-hubs [data-hub="plan"]')?.getAttribute('aria-current')).toBe('true');
    nav.path = '/content/ai-studio';
    await render({ activeModule: 'studio' }, [...FEATURES, 'studio/ai-studio', 'studio/agents']);
    expect([...container.querySelectorAll('nav.ui-tabs--links a')].map(link => link.getAttribute('href'))).toEqual(['/content/ai-studio', '/content/agents']);
    expect(container.querySelector('nav.ui-tabs--links')?.getAttribute('aria-label')).toBe('Create sections');
    expect(container.querySelector('.shell-hubs [data-hub="create"]')?.getAttribute('aria-current')).toBe('page');
    nav.path = '/insights/tests';
    await render({ activeModule: 'studio' }, [...FEATURES, 'analytics/posts', 'studio/tests']);
    expect([...container.querySelectorAll('nav.ui-tabs--links a')].map(link => link.getAttribute('href'))).toEqual(['/insights', '/insights/posts', '/insights/tests']);
    expect(container.querySelector('nav.ui-tabs--links [aria-current="page"]')?.getAttribute('href')).toBe('/insights/tests');
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
    expect(container.querySelector('.shell-hubs a[href="/root"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.shell-root-badge')?.textContent).toContain('Root');
    expect(container.querySelector('.shell-channels')).toBeNull();
  });

  it('shows the phone bottom bar with the four page hubs and a Create button between them', async () => {
    await render();
    const bar = container.querySelector('nav.ui-bottombar')!;
    const order = [...bar.querySelectorAll('a')].map(link => link.getAttribute('aria-label') ?? link.textContent);
    expect(order).toEqual(['Plan', 'Engage', 'Create post', 'Measure', 'Grow']);
  });

  it('reports a failed sign-out through the account menu and keeps it retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('.shell-user button[aria-haspopup=menu]')!.click());
    const signOut = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(item => item.textContent === 'Sign out')!;
    await act(async () => signOut.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not sign out');
  });

  it('switches workspaces from a colour-coded menu with the exact service confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await render({ workspaces: [{ id: 'w1', name: 'Current' }, { id: 'b', name: 'Another' }] });
    const trigger = container.querySelector<HTMLButtonElement>('.shell-workspace__menu button[aria-haspopup=menu]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Workspace: Current');
    expect(trigger.querySelector('.ui-avatar')).not.toBeNull();
    await act(async () => trigger.click());
    const items = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')];
    expect(items.map(item => item.querySelector('.ui-menu__label')?.textContent)).toEqual(['Current', 'Another']);
    expect(items[0]!.querySelector('.shell-workspace__current')).not.toBeNull();
    await act(async () => items[1]!.click());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ workspaceId: 'b', confirmation: 'SELECT WORKSPACE b' });
    expect(container.querySelector('.shell-workspace__name')?.textContent).toBe('Current');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be switched');
  });

  it('names a single workspace with its colour next to it', async () => {
    await render({ workspaceName: 'Only', workspaces: [{ id: 'w1', name: 'Only' }] });
    expect(container.querySelector('.shell-workspace__menu')).toBeNull();
    expect(container.querySelector('.shell-workspace-name .ui-avatar')).not.toBeNull();
    expect(text('.shell-workspace-name')).toContain('Only');
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
    expect(container.querySelector('.shell-hub')?.getAttribute('title')).toBe('Create');
  });
});
