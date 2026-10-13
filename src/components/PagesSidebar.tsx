'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';
import { PageMenu } from './PageMenu';
import { NetworkMark } from './NetworkMark';
import { paletteOf } from '@/lib/palette';
import type { PageGroupView } from '@/lib/page-groups';
import type { SidebarPage } from '@/lib/page-filter';
import { networkOfType, networksOfPlatform, platformOf, rememberSelection, selectionQuery } from '@/lib/selection';
import { useDocked } from './SidebarDock';

interface Props {
  pages: SidebarPage[];
  groups: PageGroupView[];
  group: string | null;
  /** Ids left visible, or null for all of the group (or of everything). */
  visible: string[] | null;
  /** Admins get the way to make and edit groups. */
  canManageGroups: boolean;
  /** Inside a column that already has its own width and stickiness. */
  inline?: boolean;
  /** Editors and up: shuffle, clear the queue and drafts from a Page's ⋮. */
  canManageQueue?: boolean;
  /** Remembers the selection for this workspace (src/lib/selection.ts). */
  workspaceId?: string;
  /** The platform (`meta`, `linkedin`…) the column is narrowed to. */
  platform?: string | null;
  /** The screen's own filters and actions, shown above the channels. */
  tools?: ReactNode;
}

/**
 * The column of Pages beside the calendar, the queue and the post list.
 *
 * Somebody running twenty Pages works on a few at a time. The eye beside each
 * Page hides or shows it on the screen; clicking a Page's name shows that
 * Page alone (and clicking it again brings the others back); the menu at the
 * top narrows the column to a group. All of it lives in the address — `group`
 * and `pages` — so a filtered calendar can be bookmarked or sent to a
 * colleague, and the back button undoes a click.
 *
 * On a phone the column folds into one line above the screen it filters.
 */
const FOLD_KEY = 'msp_pages_column_folded';

export function PagesSidebar({ pages, groups, group, visible, canManageGroups, inline = false, canManageQueue = false, workspaceId, platform = null, tools }: Props) {
  const t = useTranslations('pagesSidebar');
  const tNav = useTranslations('nav');
  const docked = useDocked();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Folded to a rail of pictures on wide screens, remembered in this browser.
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      setFolded(localStorage.getItem(FOLD_KEY) === '1');
    } catch {
      // Storage blocked: the column simply starts open.
    }
  }, []);
  function fold(next: boolean) {
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? '1' : '0');
    } catch {
      // Remembering is a convenience only.
    }
  }

  const activeGroup = groups.find((entry) => entry.id === group) ?? null;
  const universe = useMemo(
    () =>
      pages.filter(
        (page) => (!activeGroup || activeGroup.targetIds.includes(page.id)) && (!platform || networksOfPlatform(platform).includes(networkOfType(page.type))),
      ),
    [activeGroup, pages, platform],
  );
  const shown = new Set(visible ?? universe.map((page) => page.id));
  const shownCount = universe.filter((page) => shown.has(page.id)).length;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  function navigate(next: { group?: string | null; pages?: string[] | null; net?: string | null }) {
    const params = new URLSearchParams(search.toString());
    // Paging through a filtered list starts again from its first page.
    params.delete('page');
    if (next.group !== undefined) {
      if (next.group) params.set('group', next.group);
      else params.delete('group');
    }
    if (next.net !== undefined) {
      if (next.net) params.set('net', next.net);
      else params.delete('net');
    }
    if (next.pages !== undefined) {
      if (next.pages) params.set('pages', next.pages.join(','));
      else params.delete('pages');
    }
    const qs = params.toString();
    // The same selection the bar above every screen uses: remember it.
    if (workspaceId) rememberSelection(workspaceId, selectionQuery(params));
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  /** Every Page of the current set showing again is the same as no filter. */
  function setShown(ids: string[]) {
    const all = universe.every((page) => ids.includes(page.id));
    navigate({ pages: all ? null : ids });
  }

  function toggle(id: string) {
    const current = universe.filter((page) => shown.has(page.id)).map((page) => page.id);
    setShown(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function solo(id: string) {
    const alone = shownCount === 1 && shown.has(id);
    setShown(alone ? universe.map((page) => page.id) : [id]);
  }

  // Channels by platform, Meta holding Facebook, Instagram and Threads.
  const platforms = useMemo(() => {
    const byKey = new Map<string, SidebarPage[]>();
    for (const page of pages) {
      if (activeGroup && !activeGroup.targetIds.includes(page.id)) continue;
      const key = platformOf(networkOfType(page.type));
      byKey.set(key, [...(byKey.get(key) ?? []), page]);
    }
    return [...byKey].map(([key, items]) => ({ key, items }));
  }, [pages, activeGroup]);

  const needle = query.trim().toLowerCase();
  const listed = needle ? universe.filter((page) => page.name.toLowerCase().includes(needle)) : universe;

  // No channels yet: nothing to pick, but the screen's own tools (views, downloads) still belong here.
  if (pages.length === 0) {
    return tools ? (
      <aside aria-label={t('label')} className="min-w-0 lg:sticky lg:top-20 lg:w-[264px] lg:shrink-0 lg:self-start">
        <div className="card space-y-3 p-3">{tools}</div>
      </aside>
    ) : null;
  }

  const body = (
    <div className="space-y-2">
      {/* The group menu. */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-start text-[15px] font-semibold text-slate-900 hover:bg-slate-200"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {activeGroup ? (
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${paletteOf(activeGroup.color).dot}`} />
          ) : (
            <Icon name="folders" size={18} className="shrink-0 text-slate-600" />
          )}
          <span className="min-w-0 flex-1 truncate">{activeGroup?.name ?? t('allPages')}</span>
          <Icon name="chevronDown" size={16} className="shrink-0 text-slate-500" />
        </button>

        {menuOpen && (
          <div
            role="listbox"
            aria-label={t('chooseGroup')}
            className="absolute start-0 end-0 z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            <GroupOption
              selected={!activeGroup}
              label={t('allPages')}
              count={pages.length}
              onSelect={() => {
                setMenuOpen(false);
                navigate({ group: null, pages: null });
              }}
            />
            {groups.map((entry) => (
              <GroupOption
                key={entry.id}
                selected={entry.id === activeGroup?.id}
                label={entry.name}
                count={entry.targetIds.length}
                dot={paletteOf(entry.color).dot}
                onSelect={() => {
                  setMenuOpen(false);
                  navigate({ group: entry.id, pages: null });
                }}
              />
            ))}
            {groups.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">{t('noGroups')}</p>}
            {canManageGroups && (
              <Link
                href="/settings/pages"
                className="mt-1 flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm font-semibold text-brand-600 hover:bg-slate-50"
              >
                <Icon name={groups.length ? 'pencil' : 'plus'} size={15} />
                {groups.length ? t('manageGroups') : t('newGroup')}
              </Link>
            )}
          </div>
        )}
      </div>

      {pages.length > 3 && (
        <label className="relative block">
          <span className="sr-only">{t('search')}</span>
          <Icon name="search" size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input rounded-full bg-slate-100 py-1.5 ps-8 text-sm"
            placeholder={t('search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 text-xs text-slate-500">
        <span className="nums whitespace-nowrap">{t('showing', { shown: shownCount, total: universe.length })}</span>
        <span className="flex flex-wrap gap-x-2 gap-y-1">
          <button
            type="button"
            className="font-semibold text-brand-600 hover:underline disabled:text-slate-400 disabled:no-underline"
            disabled={shownCount === universe.length}
            onClick={() => setShown(universe.map((page) => page.id))}
          >
            {t('selectAll')}
          </button>
          <button
            type="button"
            className="font-semibold text-slate-600 hover:underline disabled:text-slate-400 disabled:no-underline"
            disabled={shownCount <= 1}
            title={t('deselectAllHint')}
            onClick={() => setShown(universe.slice(0, 1).map((page) => page.id))}
          >
            {t('deselectAll')}
          </button>
        </span>
      </div>

      <div className="pages-sidebar-list -mx-1 max-h-[60vh] overflow-y-auto">
        {platforms.map(({ key, items }) => {
          const open = !platform || platform === key;
          const rows = items.filter((page) => listed.includes(page));
          return (
            <section key={key} aria-label={tNav(`platform.${key}` as 'platform.meta')} className="pt-1 first:pt-0">
              <button
                type="button"
                aria-expanded={open && platform === key}
                className={`flex h-9 w-full items-center gap-2 rounded-lg px-1.5 text-start text-sm font-semibold ${
                  platform === key ? 'bg-brand-50 text-brand-700' : 'text-slate-800 hover:bg-slate-100'
                }`}
                onClick={() => navigate({ net: platform === key ? null : key, pages: null })}
              >
                <NetworkMark network={key === 'meta' ? 'page' : key} size={18} />
                <span className="min-w-0 flex-1 truncate">{tNav(`platform.${key}` as 'platform.meta')}</span>
                <span className="nums text-xs font-normal text-slate-500">{items.length}</span>
                <Icon name={platform === key ? 'chevronDown' : 'chevronRight'} size={15} className="text-slate-400" />
              </button>
              {open && rows.length > 0 && (
                <ul className="space-y-0.5 ps-2">
                  {rows.map((page) => {
            const on = shown.has(page.id);
            const alone = on && shownCount === 1;
            return (
              <li key={page.id} className="group flex min-w-0 items-center gap-0.5 rounded-lg hover:bg-slate-100">
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-start ${on ? '' : 'opacity-45'}`}
                  title={alone ? t('showOthers') : t('onlyThis', { page: page.name })}
                  aria-pressed={alone}
                  onClick={() => solo(page.id)}
                >
                  <span className="relative shrink-0">
                    <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
                    {page.type !== 'page' && (
                      <NetworkMark network={page.type} size={13} className="absolute -bottom-0.5 -end-0.5 ring-2 ring-white" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${alone ? 'text-brand-700' : 'text-slate-900'}`}>
                      {page.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {page.enabled ? page.category ?? t(`type.${page.type}` as 'type.page') : t('paused')}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    on ? 'text-slate-600 hover:bg-slate-200' : 'text-slate-400 hover:bg-slate-200'
                  }`}
                  aria-pressed={on}
                  aria-label={on ? t('hide', { page: page.name }) : t('show', { page: page.name })}
                  onClick={() => toggle(page.id)}
                >
                  <Icon name={on ? 'eye' : 'eyeOff'} size={17} />
                </button>
                <PageMenu page={page} canManageQueue={canManageQueue} canSettings={canManageGroups} />
              </li>
            );
          })}
                </ul>
              )}
            </section>
          );
        })}
        {listed.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">{t('noMatch')}</p>}
      </div>
    </div>
  );

  // A column carrying the screen's filters stays open: folding would hide them.
  const collapsible = !inline && !tools;
  const isFolded = collapsible && folded;

  if (docked) {
    return (
      <aside aria-label={t('label')} className="space-y-3">
        {tools && <div className="space-y-3 border-b border-slate-200 pb-3">{tools}</div>}
        {body}
      </aside>
    );
  }

  return (
    <aside
      aria-label={t('label')}
      className={`min-w-0 ${inline ? '' : `lg:sticky lg:top-20 lg:shrink-0 lg:self-start ${isFolded ? 'lg:w-14' : 'lg:w-[264px]'}`}`}
    >
      {tools && <div className="card mb-3 space-y-3 p-3">{tools}</div>}
      {/* One line on a phone, opened when wanted. */}
      <details className="card group/details p-0 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
          <Icon name="folders" size={18} className="text-slate-600" />
          <span className="min-w-0 flex-1 truncate">
            {activeGroup?.name ?? t('allPages')} · <span className="nums font-normal text-slate-600">{t('showing', { shown: shownCount, total: universe.length })}</span>
          </span>
          <Icon name="chevronDown" size={16} className="text-slate-500 transition-transform group-open/details:rotate-180" />
        </summary>
        <div className="border-t border-slate-200 p-3">{body}</div>
      </details>
      {isFolded ? (
        <div className="card hidden flex-col items-center gap-1 px-1.5 py-2 lg:flex">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
            aria-expanded={false}
            aria-label={t('expand')}
            title={t('expand')}
            onClick={() => fold(false)}
          >
            <Icon name="chevronRight" size={18} />
          </button>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {universe.map((page) => {
              const on = shown.has(page.id);
              const alone = on && shownCount === 1;
              return (
                <li key={page.id}>
                  <button
                    type="button"
                    className={`rounded-full p-0.5 ${alone ? 'ring-2 ring-brand-500' : ''} ${on ? '' : 'opacity-45'}`}
                    title={alone ? t('showOthers') : t('onlyThis', { page: page.name })}
                    aria-label={alone ? t('showOthers') : t('onlyThis', { page: page.name })}
                    aria-pressed={alone}
                    onClick={() => solo(page.id)}
                  >
                    <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="card hidden p-3 lg:block">
          {collapsible && (
            <div className="-mt-1 mb-1 flex justify-end">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                aria-expanded
                aria-label={t('collapse')}
                title={t('collapse')}
                onClick={() => fold(true)}
              >
                <Icon name="chevronLeft" size={17} />
              </button>
            </div>
          )}
          {body}
        </div>
      )}
    </aside>
  );
}

function GroupOption({
  selected,
  label,
  count,
  dot,
  onSelect,
}: {
  selected: boolean;
  label: string;
  count: number;
  dot?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm ${
        selected ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-800 hover:bg-slate-50'
      }`}
      onClick={onSelect}
    >
      {dot ? (
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      ) : (
        <Icon name="folders" size={15} className="shrink-0 text-slate-500" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="nums text-xs text-slate-500">{count}</span>
      {selected && <Icon name="check" size={15} className="text-brand-600" />}
    </button>
  );
}
