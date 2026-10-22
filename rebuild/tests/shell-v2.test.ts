// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextChannelScope, parseChannelScope, withChannelScope } from '../src/lib/channel-scope';
import { SHELL_COPY, SHELL_POLICY, fill, shellCopySchema, shellPolicySchema } from '../src/modules/shell/copy';
import { PAGES, areaForPath, areaPages, pageForPath } from '../src/lib/product';
import { ChannelScopeList, DateRangePicker, FilterButton, InfoTip, LinkTabs, ListRow, BottomBar, ActionBar, SplitButton, SidePanel } from '../src/components';

describe('channel scope parsing', () => {
  const allowed = ['a', 'b', 'c'];
  it('reads the URL first, maps legacy names and drops unknown ids', () => {
    expect(parseChannelScope({ search: new URLSearchParams('channel=a,b'), cookie: 'c', allowed })).toEqual({ ids: ['a', 'b'], dropped: 0, source: 'url' });
    expect(parseChannelScope({ search: { channelId: 'b' }, allowed }).ids).toEqual(['b']);
    expect(parseChannelScope({ search: { targetIds: 'a,zzz,a' }, allowed })).toEqual({ ids: ['a'], dropped: 1, source: 'url' });
  });
  it('falls back to the cookie, and to all channels when nothing is set or everything is gone', () => {
    expect(parseChannelScope({ cookie: 'c,x', allowed })).toEqual({ ids: ['c'], dropped: 1, source: 'cookie' });
    expect(parseChannelScope({ allowed })).toEqual({ ids: [], dropped: 0, source: 'none' });
    expect(parseChannelScope({ search: { channel: 'gone' }, allowed })).toEqual({ ids: [], dropped: 1, source: 'url' });
  });
  it('rewrites the URL keeping other parameters, dropping paging and old names', () => {
    expect(withChannelScope('/inbox?status=open&page=3&channelId=a', ['b', 'c'])).toBe('/inbox?status=open&channel=b%2Cc');
    expect(withChannelScope('/inbox?channel=a', [])).toBe('/inbox');
  });
  it('click selects one, modifier toggles, clicking the only one resets', () => {
    expect(nextChannelScope([], 'a', false)).toEqual(['a']);
    expect(nextChannelScope(['a'], 'a', false)).toEqual([]);
    expect(nextChannelScope(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextChannelScope(['a', 'b'], 'a', true)).toEqual(['b']);
  });
});

describe('shell catalog and areas', () => {
  it('has English and French with identical keys, placeholders and valid defaults', () => {
    expect(shellCopySchema.safeParse(SHELL_COPY).success).toBe(true);
    expect(shellPolicySchema.safeParse(SHELL_POLICY).success).toBe(true);
    const flat = (value: unknown, prefix = ''): Record<string, string> => typeof value === 'string' ? { [prefix]: value } : Object.entries(value as object).reduce((all, [key, item]) => ({ ...all, ...flat(item, `${prefix}.${key}`) }), {});
    const en = flat(SHELL_COPY.en), fr = flat(SHELL_COPY.fr);
    expect(Object.keys(fr)).toEqual(Object.keys(en));
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(en)) expect(holes(fr[key]!), key).toEqual(holes(en[key]!));
    expect(fill('{count} channels', { count: 3 })).toBe('3 channels');
  });
  it('names every navigable page in both languages', () => {
    for (const page of PAGES) {
      expect((SHELL_COPY.en.pageTitles as Record<string, string>)[page.id], `${page.id} en`).toBeTruthy();
      expect((SHELL_COPY.fr.pageTitles as Record<string, string>)[page.id], `${page.id} fr`).toBeTruthy();
    }
  });
  it('places every page in an area, Ads and Analytics in Insights, Publishing in Content', () => {
    expect(areaForPath('/insights/ads/campaigns')).toBe('insights');
    expect(areaForPath('/insights/posts')).toBe('insights');
    expect(areaForPath('/insights/compare/ads')).toBe('insights');
    expect(areaForPath('/create', 'publishing')).toBe('content');
    expect(areaForPath('/content/library/templates')).toBe('content');
    // Post details and Library sections belong to Content; their own tab, when they have none, is the parent route.
    expect(pageForPath('/content/post/abc')?.id).toBe('publishing/posts');
    expect(pageForPath('/content/library/labels')?.id).toBe('publishing/labels');
    expect(areaPages('insights', PAGES.map(page => page.id)).map(page => page.module)).toEqual(expect.arrayContaining(['analytics', 'ads']));
    expect(areaPages('home', [])).toEqual([]);
  });
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = (node: ReactNode) => act(async () => root.render(node));
const click = (target: Element | null) => act(async () => { (target as HTMLElement).click(); });

describe('shared shell components', () => {
  it('InfoTip opens a labelled dialog with its blocks, closes on Escape and returns focus', async () => {
    await render(h(InfoTip, { name: 'Reach', blocks: [{ label: 'Period', text: 'Sep 22 – Oct 21' }, { text: undefined }], warning: true }));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="About Reach"]')!;
    expect(container.querySelector('.ui-infotip.is-warning')).not.toBeNull();
    await click(trigger);
    const pop = container.querySelector('[role=dialog]')!;
    expect(pop.textContent).toContain('Period');
    expect(pop.querySelectorAll('.ui-infotip__block')).toHaveLength(1);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('FilterButton shows the active count in its name and clears through the footer', async () => {
    const clear = vi.fn();
    await render(h(FilterButton, { activeCount: 2, onClear: clear, children: h('p', null, 'Status') }));
    const button = container.querySelector<HTMLButtonElement>('.ui-filter-button')!;
    expect(button.getAttribute('aria-label')).toBe('Filter, 2 active');
    await click(button);
    expect(container.querySelector('.ui-filter-pop')?.textContent).toContain('Status');
    const clearAll = [...container.querySelectorAll('button')].find(item => item.textContent === 'Clear all')!;
    await click(clearAll);
    expect(clear).toHaveBeenCalled();
    await click([...container.querySelectorAll('button')].find(item => item.textContent === 'Done')!);
    expect(container.querySelector('.ui-filter-pop')).toBeNull();
  });

  it('ChannelScopeList collapses long lists, searches, and exposes additive selection', async () => {
    const channels = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, name: `Channel ${index}`, health: 'connected' as const }));
    const onSelect = vi.fn();
    await render(h(ChannelScopeList, { channels, selectedIds: ['c1'], onSelect, onReset: vi.fn(), collapsedCount: 8, searchThreshold: 15, manageHref: '/settings/connections' }));
    expect(container.querySelectorAll('.ui-scope__row')).toHaveLength(8);
    expect(container.querySelector('.ui-scope__more')?.textContent).toBe('Show all (20)');
    expect(container.querySelector('input[type=search]')).not.toBeNull();
    await click(container.querySelector('.ui-scope__more'));
    expect(container.querySelectorAll('.ui-scope__row')).toHaveLength(20);
    await click(container.querySelector('input[type=checkbox]'));
    expect(onSelect).toHaveBeenCalledWith('c0', true);
    expect(container.querySelector('.ui-scope__manage')?.getAttribute('href')).toBe('/settings/connections');
  });

  it('LinkTabs keeps the current tab visible when the rest overflows into More', async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, href: `/x/${index}`, label: `Page ${index}` }));
    await render(h(LinkTabs, { items, activeId: 'p9', label: 'Sections', maxVisible: 4, moreLabel: 'More' }));
    const links = [...container.querySelectorAll('a.ui-tabs__link')];
    expect(links).toHaveLength(4);
    expect(links.at(-1)?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.ui-tabs__more button')?.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('DateRangePicker picks a preset and applies only a valid custom range', async () => {
    const onChange = vi.fn();
    await render(h(DateRangePicker, { presets: [{ id: '7', label: 'Last 7 days' }, { id: '28', label: 'Last 28 days' }], value: { preset: '28' }, onChange }));
    const trigger = container.querySelector<HTMLButtonElement>('.ui-daterange')!;
    expect(trigger.getAttribute('aria-label')).toBe('Date range: Last 28 days');
    await click(trigger);
    await click([...container.querySelectorAll('.ui-daterange__preset')].find(item => item.textContent === 'Last 7 days')!);
    expect(onChange).toHaveBeenCalledWith({ preset: '7' });
  });

  it('BottomBar puts Create in the middle; ListRow, ActionBar, SplitButton and SidePanel render their parts', async () => {
    const onClose = vi.fn();
    await render(h('div', null,
      h(BottomBar, { label: 'Main', items: [{ id: 'home', href: '/home', label: 'Home', icon: null, active: true }, { id: 'content', href: '/c', label: 'Content', icon: null }, { id: 'inbox', href: '/i', label: 'Inbox', icon: null, badge: 120 }, { id: 'insights', href: '/s', label: 'Insights', icon: null }], create: { href: '/create', label: 'Create post' } }),
      h(ListRow, { title: 'A post', meta: 'Draft', href: '/p', trailing: h('span', null, '…') }),
      h(ActionBar, { label: 'Actions', status: 'Saved', children: h('button', null, 'Save') }),
      h(SplitButton, { label: 'Schedule', onClick: vi.fn(), menuLabel: 'More ways', items: [{ key: 'now', label: 'Publish now', onSelect: vi.fn() }] }),
      h(SidePanel, { open: true, title: 'Post', onClose, closeLabel: 'Close', actions: h('button', null, 'Edit'), children: 'Details' }),
    ));
    const bar = container.querySelector('nav.ui-bottombar')!;
    expect([...bar.querySelectorAll('a')].map(link => link.getAttribute('aria-label') ?? link.querySelector('.ui-bottombar__label')?.textContent)).toEqual(['Home', 'Content', 'Create post', 'Inbox', 'Insights']);
    expect(bar.textContent).toContain('99+');
    expect(container.querySelector('.ui-list-row__main')?.getAttribute('href')).toBe('/p');
    expect(container.querySelector('.ui-action-bar [role=status]')?.textContent).toBe('Saved');
    expect(container.querySelector('.ui-split button[aria-haspopup=menu]')?.getAttribute('aria-label')).toBe('More ways');
    await click(container.querySelector('.ui-side-panel__head button'));
    expect(onClose).toHaveBeenCalled();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
