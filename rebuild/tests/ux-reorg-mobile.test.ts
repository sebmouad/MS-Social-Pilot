// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const nav = vi.hoisted(() => ({ path: '/content', search: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { AppShell } from '../src/components/AppShell';
import { SHELL_COPY, SHELL_POLICY, type ShellCopy, type ShellPolicy } from '../src/modules/shell/copy';
import { FeedManager } from '../src/modules/feeds/ui/FeedManager';
import { feedsCopy } from '../src/modules/feeds/copy';

const copy = SHELL_COPY.en as unknown as ShellCopy;
const policy = SHELL_POLICY as unknown as ShellPolicy;
const channels = [{ id: 'c1', name: 'North Market', pictureUrl: null, health: 'connected' as const }];
const read = (path: string) => readFileSync(path, 'utf8');

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  nav.path = '/content'; nav.search = '';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const FEATURES = ['home/overview', 'publishing/posts', 'publishing/calendar', 'inbox/conversations', 'analytics/overview', 'ads/overview', 'settings/account', 'settings/connections'];
async function renderShell(extra: Partial<ComponentProps<typeof AppShell>> = {}, enabledFeatures: string[] = FEATURES) {
  await act(async () => root.render(createElement(AppShell, {
    activeModule: 'publishing', enabledModules: ['home', 'publishing', 'inbox', 'analytics', 'ads', 'settings'], enabledFeatures, writableFeatures: ['publishing/posts'],
    rootAccess: false, userName: 'Preview', workspaceName: 'Example workspace', workspaceId: 'w1', copy, policy, channels,
    children: createElement('div', null, 'Example content'),
    ...extra,
  })));
}
const barOrder = () => [...container.querySelectorAll('nav.ui-bottombar a')].map(link => link.getAttribute('aria-label') ?? link.textContent);

describe('reorganized navigation on phones (2026-10-22)', () => {
  it.each([
    ['/content/feeds', 'publishing', 'content', '/content/feeds'],
    ['/content/ai-studio', 'publishing', 'content', '/content/ai-studio'],
    ['/insights/tests', 'analytics', 'insights', '/insights/tests'],
  ])('BottomBar marks %s under %s and keeps Create raised central', async (path, activeModule, area, tabHref) => {
    nav.path = path;
    await renderShell({ activeModule: activeModule as ComponentProps<typeof AppShell>['activeModule'] }, [...FEATURES, 'publishing/queue', 'publishing/approvals', 'publishing/media', 'publishing/feeds', 'publishing/ai-studio', 'analytics/posts', 'analytics/tests']);
    expect(barOrder()).toEqual(['Home', 'Content', 'Inbox', 'Create post', 'Insights', 'Ads']);
    const current = container.querySelector(`nav.ui-bottombar a[data-area="${area}"]`)!;
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('is-active');
    expect(container.querySelector(`nav.ui-tabs--links a[href="${tabHref}"]`)?.getAttribute('aria-current')).toBe('page');
  });

  it('folds the 8th Content tab into the More menu with a touch-sized trigger', async () => {
    await renderShell({}, [...FEATURES, 'publishing/queue', 'publishing/approvals', 'publishing/media', 'publishing/feeds', 'publishing/ai-studio', 'agents/library']);
    expect([...container.querySelectorAll('nav.ui-tabs--links a')].map(link => link.getAttribute('href'))).toEqual([
      '/content', '/content/calendar', '/content/queue', '/content/approvals', '/content/library', '/content/feeds', '/content/ai-studio',
    ]);
    const more = container.querySelector<HTMLButtonElement>('.ui-tabs__more button')!;
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => more.click());
    expect([...container.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['Writing agents']);
    expect(read('src/styles/shell.css')).toMatch(/\.ui-tabs__more \.ui-menu__trigger \{[^}]*min-height: 44px/);
  });

  it('keeps the raised central Create button and a fixed safe-area bottom bar below 760px', () => {
    const shell = read('src/styles/shell.css');
    expect(shell).toMatch(/\.ui-bottombar__create \{[^}]*width: 56px; height: 56px; margin: -14px 6px 0/);
    expect(shell).toMatch(/\.ui-bottombar \{ position: fixed[^}]*env\(safe-area-inset-bottom\)/);
    expect(shell).toMatch(/\.ui-side-panel \{ position: fixed; z-index: 30; inset: 0; width: 100%/);
  });
});

describe('promoted screens on phones', () => {
  const feed = { id: 'f1', name: 'Example feed', url: 'https://example.com/feed', kind: 'rss' as const, enabled: true, messageTemplate: '{title}', hashtags: '', targetIds: ['c1'], handling: 'review' as const, spreadMinutes: 0, failureCount: 0, lastPolledAt: null, lastError: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
  const limits = { maxNameCharacters: 100, maxMessageCharacters: 1000, maxTargets: 10, maxSpreadMinutes: 60 };

  it('renders the feeds table with bounded scroll, touch-sized pagination and a dialog composer', async () => {
    await act(async () => root.render(createElement(FeedManager, { initialFeeds: [feed], channels: [{ id: 'c1', name: 'North Market' }], page: 2, hasMore: true, limits, locale: 'en', automaticMinutes: null })));
    expect(container.querySelector('table')).not.toBeNull();
    const pager = container.querySelector('nav[aria-label]')!;
    expect(pager.querySelector('a[href="/content/feeds?page=1"]')?.textContent).toBe(feedsCopy.en.previous);
    expect(pager.querySelector('a[href="/content/feeds?page=3"]')?.textContent).toBe(feedsCopy.en.next);
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === feedsCopy.en.add)!.click(); });
    expect(container.querySelector('dialog[open] #feed-form')).not.toBeNull();
    const css = read('src/modules/feeds/ui/feeds.module.css');
    expect(css).toMatch(/\.tableWrap \{[^}]*overflow-x: auto; overscroll-behavior-x: contain/);
    expect(css).toMatch(/\.table \{[^}]*min-width: 46rem/);
    const phone = css.slice(css.indexOf('@media (max-width: 47.5rem)'));
    expect(phone).toMatch(/\.form textarea[^}]*font-size: 1rem; min-height: 2\.75rem/);
    expect(phone).toMatch(/\.checks label, \.inline \{ min-height: 2\.75rem/);
    expect(phone).toMatch(/\.pagination a \{ display: inline-flex; align-items: center; min-height: 2\.75rem/);
  });

  it('keeps AI studio and caption tests in single-column phone layouts with 40px+ targets', () => {
    const studio = read('src/modules/ai/content-tools/ui/ai-studio.module.css');
    expect(studio).toMatch(/@media \(max-width: 720px\) \{ \.panel \{ padding: 1rem; \} \.preview \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
    expect(studio).toMatch(/\.channel \{[^}]*min-height: 2\.5rem/);
    const tests = read('src/modules/caption-tests/ui/caption-tests.module.css');
    expect(tests).toMatch(/@media \(max-width: 720px\) \{[\s\S]*\.figures \{ grid-column: 1 \/ -1;[^}]*text-align: left/);
  });

  it('uses fullscreen dialogs and confirmations on promoted screens, never side panels', () => {
    for (const file of ['src/modules/feeds/ui/FeedsScreen.tsx', 'src/modules/feeds/ui/FeedManager.tsx', 'src/modules/ai/content-tools/ui/AiStudioScreen.tsx', 'src/modules/caption-tests/ui/CaptionTestsScreen.tsx']) {
      expect(read(file), file).not.toContain('SidePanel');
    }
    expect(read('src/modules/feeds/ui/FeedManager.tsx')).toContain("from '@/components/Dialog'");
    expect(read('src/modules/ai/content-tools/ui/AiStudioScreen.tsx')).toContain("from '@/components/useConfirm'");
    expect(read('src/modules/caption-tests/ui/CaptionTestsScreen.tsx')).toContain("from '@/components/useConfirm'");
    expect(read('src/styles/responsive.css')).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.ui-dialog \{[^}]*height: 100dvh/);
  });
});
