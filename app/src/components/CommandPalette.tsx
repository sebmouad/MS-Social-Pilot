'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCommand, IconPlus, IconSearch } from '@tabler/icons-react';
import type { CommandCopy } from '@/modules/home/command-copy';
import type { CommandAction, CommandChannel, CommandItem } from '@/modules/home/server/commands';
import { Avatar } from './Avatar';
import { Dialog } from './Dialog';

type PaletteRow = { kind: 'action' | 'page' | 'channel'; key: string; title: string; sub: string; href: string };

const isList = (value: unknown): value is { items: CommandItem[]; actions?: CommandAction[]; channels?: CommandChannel[] } => {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) return false;
  const { actions, channels } = value as { actions?: unknown; channels?: unknown };
  return (actions === undefined || Array.isArray(actions)) && (channels === undefined || Array.isArray(channels));
};

/** Global command bar: Ctrl/⌘-K anywhere, type to filter, arrows and Enter to open. Creation shortcuts, openable pages and channel jumps come from the same service as the REST surface, already limited to what the member may use. */
export function CommandPalette({ copy: t }: { copy: CommandCopy }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [actions, setActions] = useState<CommandAction[]>([]);
  const [items, setItems] = useState<CommandItem[]>([]);
  const [channels, setChannels] = useState<CommandChannel[]>([]);
  const [active, setActive] = useState(0);
  const loaded = useRef(false);
  const load = useCallback(async () => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const response = await fetch('/api/home/commands', { cache: 'no-store' });
      const result: unknown = await response.json();
      if (response.ok && isList(result)) {
        setActions(result.actions ?? []);
        setItems(result.items);
        setChannels(result.channels ?? []);
      }
    } catch { loaded.current = false; }
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(was => !was); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) { setQuery(''); setActive(0); void load(); requestAnimationFrame(() => input.current?.focus()); } }, [open, load]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);
    return [
      { kind: 'action' as const, label: t.sectionActions, rows: actions.filter(item => match(`${item.title} ${item.id}`)).map((item): PaletteRow => ({ kind: 'action', key: item.id, title: item.title, sub: '', href: item.href })) },
      { kind: 'page' as const, label: t.sectionPages, rows: items.filter(item => match(`${item.title} ${item.moduleTitle} ${item.id}`)).map((item): PaletteRow => ({ kind: 'page', key: item.id, title: item.title, sub: item.moduleTitle, href: item.href })) },
      { kind: 'channel' as const, label: t.sectionChannels, rows: channels.filter(item => match(`${item.title} ${item.id}`)).map((item): PaletteRow => ({ kind: 'channel', key: item.id, title: item.title, sub: '', href: item.href })) },
    ].filter(group => group.rows.length > 0);
  }, [query, actions, items, channels, t.sectionActions, t.sectionPages, t.sectionChannels]);
  const flat = useMemo(() => groups.flatMap(group => group.rows), [groups]);
  const current = flat[Math.min(active, Math.max(flat.length - 1, 0))];
  const go = (row: PaletteRow) => { setOpen(false); router.push(row.href); };
  return <>
    <button type="button" className="shell-palette-trigger" aria-label={t.trigger} onClick={() => setOpen(true)} aria-keyshortcuts="Control+k Meta+k" title={t.trigger}>
      <IconSearch size={15} aria-hidden="true" /><span>{t.trigger}</span><kbd aria-hidden="true"><IconCommand size={12} aria-hidden="true" />K</kbd>
    </button>
    <Dialog open={open} title={t.trigger} closeLabel={t.close} onClose={() => setOpen(false)}>
      <input ref={input} type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={current ? `${listId}-${current.kind}-${current.key}` : undefined} autoComplete="off" placeholder={t.placeholder} aria-label={t.placeholder} value={query}
        onChange={event => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); return; }
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => flat.length ? (index + 1) % flat.length : 0); return; }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => flat.length ? (index + flat.length - 1) % flat.length : 0); return; }
          if (event.key === 'Enter' && current) { event.preventDefault(); go(current); }
        }} />
      <p>{t.hint}</p>
      {flat.length ? <div id={listId} role="listbox" aria-label={t.placeholder} className="ui-palette__list">
        {groups.map(group => <div key={group.kind} role="group" aria-label={group.label} className="ui-palette__group">
          <p className="ui-palette__group-label" aria-hidden="true">{group.label}</p>
          <ul>
            {group.rows.map(row => {
              const selected = row === current;
              return <li key={`${row.kind}-${row.key}`} id={`${listId}-${row.kind}-${row.key}`} role="option" aria-selected={selected} className={`ui-palette__option${selected ? ' is-active' : ''}`}
                onMouseDown={event => { event.preventDefault(); go(row); }} onMouseMove={() => setActive(flat.indexOf(row))}>
                {row.kind === 'action' && <IconPlus size={15} aria-hidden="true" />}
                {row.kind === 'channel' && <Avatar name={row.title} size="sm" decorative />}
                <span className="ui-palette__title">{row.title}</span>
                {row.sub && <span className="ui-palette__sub">{row.sub}</span>}
              </li>;
            })}
          </ul>
        </div>)}
      </div> : <p role="status">{t.noResults}</p>}
    </Dialog>
  </>;
}
