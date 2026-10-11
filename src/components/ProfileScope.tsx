'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';
import { NetworkMark } from './NetworkMark';
import { paletteOf } from '@/lib/palette';
import type { PageGroupView } from '@/lib/page-groups';
import type { SidebarPage } from '@/lib/page-filter';
import { networkOfType, rememberSelection, selectionQuery, type SelectionNetwork } from '@/lib/selection';

interface Props {
  workspaceId: string;
  pages: SidebarPage[];
  groups: PageGroupView[];
  group: string | null;
  /** The profiles shown now (the server's clamped answer). */
  ids: string[];
  net: SelectionNetwork | null;
  networks: SelectionNetwork[];
}

/**
 * "Which profiles am I looking at", above the content of every screen that
 * shows Pages' data: stacked avatars and a count, opening a picker with
 * search, groups, networks, a checkbox per profile and "Only". Applying
 * changes the address and remembers the choice for the workspace, so the
 * next screen opens on the same profiles. Never empty.
 */
export function ProfileScope({ workspaceId, pages, groups, group, ids, net, networks }: Props) {
  const t = useTranslations('profileScope');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draftGroup, setDraftGroup] = useState<string | null>(group);
  const [draftNet, setDraftNet] = useState<SelectionNetwork | null>(net);
  const [picked, setPicked] = useState<Set<string>>(new Set(ids));
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Opening starts from what is on screen now.
  useEffect(() => {
    if (!open) return;
    setDraftGroup(group);
    setDraftNet(net);
    setPicked(new Set(ids));
    setQuery('');
  }, [open, group, net, ids]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const universe = useMemo(() => {
    const inGroup = draftGroup ? groups.find((entry) => entry.id === draftGroup)?.targetIds ?? [] : null;
    return pages.filter(
      (page) => (!inGroup || inGroup.includes(page.id)) && (!draftNet || networkOfType(page.type) === draftNet),
    );
  }, [pages, groups, draftGroup, draftNet]);

  const shownPages = pages.filter((page) => ids.includes(page.id));
  const all = ids.length === pages.length;
  const label = all
    ? t('all', { count: pages.length })
    : shownPages.length === 1
      ? shownPages[0]!.name
      : t('some', { count: shownPages.length });

  const selected = universe.filter((page) => picked.has(page.id));
  const needle = query.trim().toLowerCase();
  const listed = needle ? universe.filter((page) => page.name.toLowerCase().includes(needle)) : universe;

  function apply(next: { group: string | null; net: SelectionNetwork | null; ids: string[] }) {
    const whole = universe.length > 0 && universe.every((page) => next.ids.includes(page.id));
    const params = new URLSearchParams(search.toString());
    params.delete('page');
    for (const [key, value] of [
      ['group', next.group],
      ['net', next.net],
      ['pages', whole ? null : next.ids.join(',')],
    ] as const) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const selection = selectionQuery(params);
    rememberSelection(workspaceId, selection);
    const qs = params.toString();
    setOpen(false);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (pages.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        className="flex h-10 max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white pl-1.5 pr-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex shrink-0 -space-x-2">
          {shownPages.slice(0, 5).map((page) => (
            <span key={page.id} className="rounded-full ring-2 ring-white">
              <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="xs" />
            </span>
          ))}
        </span>
        {shownPages.length > 5 && <span className="shrink-0 text-xs text-slate-500">+{shownPages.length - 5}</span>}
        <span className="min-w-0 truncate">{label}</span>
        <Icon name="chevronDown" size={16} className="shrink-0 text-slate-500" />
      </button>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={t('title')}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-12 sm:max-h-[70vh] sm:w-[24rem] sm:rounded-2xl"
        >
          <div className="space-y-3">
            <label className="relative block">
              <span className="sr-only">{t('search')}</span>
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                value={query}
                placeholder={t('search')}
                autoComplete="off"
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('groups')}>
                {[{ id: null, name: t('allGroups'), color: null }, ...groups].map((entry) => (
                  <button
                    key={entry.id ?? 'all'}
                    type="button"
                    aria-pressed={draftGroup === entry.id}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                      draftGroup === entry.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                    onClick={() => {
                      setDraftGroup(entry.id);
                      const members = entry.id ? (groups.find((g) => g.id === entry.id)?.targetIds ?? []) : pages.map((page) => page.id);
                      setPicked(new Set(members));
                    }}
                  >
                    {entry.color && <span aria-hidden className={`h-2 w-2 rounded-full ${paletteOf(entry.color).dot}`} />}
                    {entry.name}
                  </button>
                ))}
              </div>
            )}

            {networks.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('networks')}>
                {[null, ...networks].map((network) => (
                  <button
                    key={network ?? 'all'}
                    type="button"
                    aria-pressed={draftNet === network}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                      draftNet === network ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                    onClick={() => setDraftNet(network)}
                  >
                    {network && <NetworkMark network={network === 'facebook' ? 'page' : network} size={14} />}
                    {network ? t(`network.${network}`) : t('allNetworks')}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{t('selected', { count: selected.length, total: universe.length })}</span>
              <span className="flex gap-2">
                <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setPicked(new Set(universe.map((page) => page.id)))}>
                  {t('selectAll')}
                </button>
                <button type="button" className="font-semibold text-slate-600 hover:underline" onClick={() => setPicked(new Set())}>
                  {t('clear')}
                </button>
              </span>
            </div>

            <ul className="max-h-72 space-y-0.5 overflow-y-auto" aria-label={t('profiles')}>
              {listed.map((page) => (
                <li key={page.id} className="group flex items-center gap-2 rounded-lg px-1 hover:bg-slate-50">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={picked.has(page.id)}
                      onChange={(event) => {
                        const next = new Set(picked);
                        if (event.target.checked) next.add(page.id);
                        else next.delete(page.id);
                        setPicked(next);
                      }}
                    />
                    <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="xs" />
                    <NetworkMark network={page.type} size={14} />
                    <span className={`min-w-0 truncate text-sm ${page.enabled ? 'text-slate-900' : 'text-slate-400'}`}>{page.name}</span>
                  </label>
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-brand-600 opacity-100 hover:bg-brand-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                    onClick={() => apply({ group: draftGroup, net: draftNet, ids: [page.id] })}
                  >
                    {t('only')}
                    <span className="sr-only"> {page.name}</span>
                  </button>
                </li>
              ))}
              {listed.length === 0 && <li className="px-1 py-2 text-sm text-slate-500">{t('noMatch')}</li>}
            </ul>

            {selected.length === 0 && <p role="alert" className="text-sm text-amber-800">{t('pickOne')}</p>}
            <div className="flex gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={selected.length === 0}
                onClick={() => apply({ group: draftGroup, net: draftNet, ids: selected.map((page) => page.id) })}
              >
                {t('show', { count: selected.length })}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
