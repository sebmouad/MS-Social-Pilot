'use client';

import { IconBookmark, IconChevronDown } from '@tabler/icons-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Popover } from '@/components/Popover';
import { deleteInboxSavedViewConfirmation, INBOX_SAVED_VIEW_BOUNDS, inboxSavedViewCopy, normalizeInboxSavedViewQuery, type InboxSavedViewRecord } from '@/modules/inbox/saved-views';
import styles from './inbox-round3.module.css';

/** Saved triage-filter views dropdown beside the Inbox filter row. The sidebar channel scope re-applies when a view opens. */
export function InboxSavedViews({ locale, currentQuery }: { locale: string; currentQuery: string }) {
  const copy = inboxSavedViewCopy(locale);
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<InboxSavedViewRecord[] | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<InboxSavedViewRecord | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback((restore: boolean) => { setOpen(false); if (restore) triggerRef.current?.focus(); }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/inbox/saved-views', { cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ views: InboxSavedViewRecord[]; unavailable?: boolean }>; })
      .then(body => { if (!active) return; setViews(body.views); if (body.unavailable) setMessage({ text: copy.saveFailed, error: true }); })
      .catch(() => { if (active) { setViews([]); setMessage({ text: copy.saveFailed, error: true }); } });
    return () => { active = false; };
  }, [copy.saveFailed]);

  const current = normalizeInboxSavedViewQuery(currentQuery);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setMessage({ text: copy.nameRequired, error: true }); return; }
    if (current === null) { setMessage({ text: copy.saveFailed, error: true }); return; }
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/inbox/saved-views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), query: current }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.view) { setMessage({ text: copy.saveFailed, error: true }); return; }
      setViews(list => [...(list ?? []), body.view as InboxSavedViewRecord].sort((a, b) => a.name.localeCompare(b.name)));
      setName(''); setMessage({ text: copy.saved, error: false });
    } catch { setMessage({ text: copy.saveFailed, error: true }); }
    finally { setPending(false); }
  }
  async function remove(view: InboxSavedViewRecord) {
    setMessage(null);
    try {
      const response = await fetch(`/api/inbox/saved-views/${encodeURIComponent(view.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: deleteInboxSavedViewConfirmation(view.id) }) });
      if (!response.ok) { setMessage({ text: copy.deleteFailed, error: true }); return; }
      setViews(list => (list ?? []).filter(item => item.id !== view.id)); setRemoving(null); setMessage({ text: copy.deleted, error: false });
    } catch { setMessage({ text: copy.deleteFailed, error: true }); }
  }

  const count = views?.length ?? 0;
  return <>
    <button ref={triggerRef} type="button" className={`ui-filter-button${count > 0 ? ' is-active' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-pop` : undefined} onClick={() => setOpen(v => !v)}>
      <IconBookmark size={16} stroke={1.9} aria-hidden="true" />
      <span>{copy.views}</span>
      {count > 0 ? <span className="ui-filter-button__badge" aria-hidden="true">{count}</span> : null}
      <IconChevronDown size={14} stroke={2} aria-hidden="true" />
    </button>
    <Popover open={open} anchorRef={triggerRef} onClose={close} sheetOnPhone role="dialog" id={`${id}-pop`} label={copy.views} className="ui-filter-button__pop">
      <section className={styles.savedViews} aria-labelledby={`${id}-heading`}>
        <h2 id={`${id}-heading`} className="ui-filter-button__title">{copy.views}</h2>
        {views === null ? <p aria-busy="true">…</p> : views.length ? <ul>
          {views.map(view => <li key={view.id}>
            <a href={view.href} aria-current={current === view.query ? 'page' : undefined}>{view.name}</a>
            {removing?.id === view.id
              ? <span><span>{copy.deleteTitle} </span><button type="button" onClick={() => remove(view)}>{copy.delete}</button> <button type="button" onClick={() => setRemoving(null)}>{copy.cancel}</button></span>
              : <button type="button" aria-label={`${copy.delete}: ${view.name}`} onClick={() => setRemoving(view)}>{copy.delete}</button>}
          </li>)}
        </ul> : <p>{copy.noViews}</p>}
        <form onSubmit={save} noValidate>
          <label htmlFor={`${id}-name`}>{copy.viewName}</label>
          <input id={`${id}-name`} value={name} maxLength={INBOX_SAVED_VIEW_BOUNDS.maxName} onChange={event => setName(event.target.value)} aria-invalid={message?.error && !name.trim() ? true : undefined} />
          <button type="submit" disabled={pending}>{pending ? copy.saving : copy.save}</button>
        </form>
        {message ? <p role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
      </section>
    </Popover>
  </>;
}
