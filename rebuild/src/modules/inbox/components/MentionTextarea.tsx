'use client';
import { useId, useRef, useState } from 'react';
import styles from './ThreadProductivity.module.css';

export type Mentionable = { id: string; name: string };

/** Note composer with an @mention listbox. Picked ids whose @name leaves the text stop being reported. */
export function MentionTextarea({ value, onChange, mentionable, listLabel, emptyLabel, maxLength, placeholder, ariaLabel, disabled }: {
  value: string; onChange: (value: string, mentionIds: string[]) => void; mentionable: Mentionable[];
  listLabel: string; emptyLabel: string; maxLength?: number; placeholder?: string; ariaLabel: string; disabled?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const matches = query === '' ? mentionable : mentionable.filter(member => member.name.toLowerCase().includes(query.toLowerCase()));
  const report = (next: string, ids: string[]) => {
    const byId = new Map(mentionable.map(member => [member.id, member.name]));
    onChange(next, ids.filter(id => { const name = byId.get(id); return !!name && next.includes(`@${name}`); }));
  };
  const syncToken = () => {
    const element = area.current;
    if (!element) return;
    const before = value.slice(0, element.selectionStart ?? value.length);
    const at = before.search(/(^|[\s\n])@[^\s@]{0,60}$/);
    if (at === -1 || !mentionable.length) { setOpen(false); return; }
    setQuery(before.slice(at).replace(/^[\s\n]@/, ''));
    setActive(0);
    setOpen(true);
  };
  const choose = (member: Mentionable) => {
    const element = area.current;
    const caret = element?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const at = before.search(/(^|[\s\n])@[^\s@]{0,60}$/);
    const head = at === -1 ? before : before.slice(0, at) + (at > 0 && !/\s/.test(before[at] ?? '') ? '' : before[at] === '@' ? '' : before[at] ?? '');
    const next = `${head}@${member.name} ${value.slice(caret)}`;
    const ids = picked.includes(member.id) ? picked : [...picked, member.id];
    setPicked(ids);
    setOpen(false);
    report(next, ids);
    requestAnimationFrame(() => { element?.focus(); const position = head.length + member.name.length + 2; element?.setSelectionRange(position, position); });
  };
  return <div className={styles.mentionWrap}>
    <textarea ref={area} className={styles.textarea} aria-label={ariaLabel} aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined} role="combobox" autoComplete="off" maxLength={maxLength} value={value} disabled={disabled} placeholder={placeholder}
      onChange={event => { const next = event.target.value; report(next, picked.filter(id => { const name = mentionable.find(member => member.id === id)?.name; return !!name && next.includes(`@${name}`); })); setPicked(ids => ids.filter(id => { const name = mentionable.find(member => member.id === id)?.name; return !!name && next.includes(`@${name}`); })); }}
      onKeyUp={event => { if (event.key !== 'Escape') syncToken(); }} onClick={syncToken}
      onKeyDown={event => {
        if (!open) return;
        if (event.key === 'Escape') { setOpen(false); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => matches.length ? (index + 1) % matches.length : 0); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => matches.length ? (index + matches.length - 1) % matches.length : 0); return; }
        if ((event.key === 'Enter' || event.key === 'Tab') && matches[active]) { event.preventDefault(); choose(matches[active]); }
      }} />
    {open ? <ul id={listId} role="listbox" aria-label={listLabel} className={styles.mentionList}>
      {matches.length ? matches.map((member, index) => <li key={member.id} id={`${listId}-${member.id}`} role="option" aria-selected={index === active} className={index === active ? styles.mentionActive : undefined} onMouseDown={event => { event.preventDefault(); choose(member); }}>{member.name}</li>) : <li aria-disabled="true" className={styles.mentionEmpty}>{emptyLabel}</li>}
    </ul> : null}
  </div>;
}

/** Render a saved note with its stored mentions emphasized; unknown ids render as plain text. */
export function MentionedBody({ body, mentionIds, mentionable }: { body: string; mentionIds: readonly string[]; mentionable: readonly Mentionable[] }) {
  if (!mentionIds.length) return <>{body}</>;
  const names = mentionable.filter(member => mentionIds.includes(member.id)).map(member => member.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{body}</>;
  const pattern = new RegExp(`(@(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))(?![\\p{L}\\p{N}_])`, 'gu');
  const parts = body.split(pattern);
  return <>{parts.map((part, index) => index % 2 === 1 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>)}</>;
}
