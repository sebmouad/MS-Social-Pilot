'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { Avatar } from '@/modules/publishing/ui/kit/kit';
import styles from './channel-select.module.css';

export type SelectableChannel = { id: string; name: string; pictureUrl?: string | null; platformName?: string | null };

/**
 * « Post to » for many channels (2026-11-14), like Meta's composer: the chosen channels as removable chips and an
 * « Add channels » button that opens a searchable checklist under the field. Choices apply at once (nothing is
 * sent until the post is saved), so the list can stay open while several channels are ticked.
 */
export function ChannelSelect({ channels, selected, onToggle, onSetAll, disabled = false, locale = 'en', labelledBy }: {
  channels: SelectableChannel[]; selected: readonly string[]; onToggle: (id: string) => void; onSetAll: (ids: string[]) => void;
  disabled?: boolean; locale?: 'en' | 'fr'; labelledBy?: string;
}) {
  const fr = locale === 'fr';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const sorted = useMemo(() => [...channels].sort((a, b) => a.name.localeCompare(b.name, locale)), [channels, locale]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle ? sorted.filter(channel => channel.name.toLocaleLowerCase().includes(needle)) : sorted;
  const chosen = sorted.filter(channel => selected.includes(channel.id));
  const allOn = channels.length > 0 && channels.every(channel => selected.includes(channel.id));

  return <div className={styles.root} ref={root}>
    <div className={styles.field} role="group" aria-labelledby={labelledBy}>
      {chosen.map(channel => <span key={channel.id} className={styles.chip}>
        <Avatar name={channel.name} src={channel.pictureUrl} size={20} /><span className={styles.chipName}>{channel.name}</span>
        <button type="button" disabled={disabled} aria-label={fr ? `Retirer ${channel.name}` : `Remove ${channel.name}`} onClick={() => onToggle(channel.id)}><IconX size={13} stroke={2.2} aria-hidden="true" /></button>
      </span>)}
      <button type="button" className={styles.add} disabled={disabled} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(value => !value)}>
        <IconPlus size={15} stroke={2.2} aria-hidden="true" />{chosen.length ? (fr ? 'Ajouter' : 'Add') : (fr ? 'Choisir des canaux' : 'Choose channels')}
      </button>
    </div>
    {open ? <div className={styles.panel}>
      <label className={styles.search}><IconSearch size={15} aria-hidden="true" /><input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={fr ? `Rechercher parmi ${channels.length} canaux` : `Search ${channels.length} channels`} aria-label={fr ? 'Rechercher un canal' : 'Search channels'} /></label>
      <div className={styles.panelHead}>
        <span>{fr ? `${selected.length} sélectionné(s)` : `${selected.length} selected`}</span>
        <button type="button" disabled={disabled} onClick={() => onSetAll(allOn ? [] : channels.map(channel => channel.id))}>{allOn ? (fr ? 'Tout retirer' : 'Clear all') : (fr ? 'Tout sélectionner' : 'Select all')}</button>
      </div>
      <ul className={styles.list}>
        {matches.map(channel => { const on = selected.includes(channel.id); return <li key={channel.id}>
          <label className={styles.row} data-on={on || undefined}>
            <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(channel.id)} />
            <Avatar name={channel.name} src={channel.pictureUrl} size={24} />
            <span className={styles.rowName}>{channel.name}</span>
            {channel.platformName ? <span className={styles.rowPlatform}>{channel.platformName}</span> : null}
          </label>
        </li>; })}
        {matches.length === 0 ? <li className={styles.empty}>{fr ? 'Aucun canal ne correspond.' : 'No channel matches.'}</li> : null}
      </ul>
      <div className={styles.panelFoot}><button type="button" className="ui-button ui-button--primary ui-button--sm" onClick={() => setOpen(false)}>{fr ? 'Terminé' : 'Done'}</button></div>
    </div> : null}
  </div>;
}
