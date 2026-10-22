'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCommand, IconSearch } from '@tabler/icons-react';
import type { CommandCopy } from '@/modules/home/command-copy';
import type { CommandItem } from '@/modules/home/server/commands';
import { Dialog } from './Dialog';

const isList = (value: unknown): value is { items: CommandItem[] } => !!value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items);

/** Global page finder: Ctrl/⌘-K anywhere, type to filter, arrows and Enter to open. Items come from the same service as the REST and MCP surfaces, already limited to pages the member may use. */
export function CommandPalette({ copy: t }: { copy: CommandCopy }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CommandItem[]>([]);
  const [active, setActive] = useState(0);
  const loaded = useRef(false);
  const load = useCallback(async () => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const response = await fetch('/api/home/commands', { cache: 'no-store' });
      const result: unknown = await response.json();
      if (response.ok && isList(result)) setItems(result.items);
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
  const q = query.trim().toLowerCase();
  const matches = q ? items.filter(item => `${item.title} ${item.moduleTitle} ${item.id}`.toLowerCase().includes(q)) : items;
  const go = (item: CommandItem) => { setOpen(false); router.push(item.href); };
  return <>
    <button type="button" className="shell-palette-trigger" onClick={() => setOpen(true)} aria-keyshortcuts="Control+k Meta+k" title={t.trigger}>
      <IconSearch size={15} aria-hidden="true" /><span>{t.trigger}</span><kbd aria-hidden="true"><IconCommand size={12} aria-hidden="true" />K</kbd>
    </button>
    <Dialog open={open} title={t.trigger} closeLabel={t.close} onClose={() => setOpen(false)}>
      <input ref={input} type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={matches[Math.min(active, Math.max(matches.length - 1, 0))]?.id ? `${listId}-${matches[Math.min(active, Math.max(matches.length - 1, 0))].id}` : undefined} autoComplete="off" placeholder={t.placeholder} aria-label={t.placeholder} value={query}
        onChange={event => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); return; }
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => matches.length ? (index + 1) % matches.length : 0); return; }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => matches.length ? (index + matches.length - 1) % matches.length : 0); return; }
          if (event.key === 'Enter' && matches[Math.min(active, Math.max(matches.length - 1, 0))]) { event.preventDefault(); go(matches[Math.min(active, Math.max(matches.length - 1, 0))]); }
        }} />
      <p>{t.hint}</p>
      {matches.length ? <ul id={listId} role="listbox" aria-label={t.placeholder}>
        {matches.map((item, index) => <li key={item.id} id={`${listId}-${item.id}`} role="option" aria-selected={index === Math.min(active, Math.max(matches.length - 1, 0))} onMouseDown={event => { event.preventDefault(); go(item); }} onMouseMove={() => setActive(index)}><span>{item.title}</span> <span>{item.moduleTitle}</span></li>)}
      </ul> : <p role="status">{t.noResults}</p>}
    </Dialog>
  </>;
}
