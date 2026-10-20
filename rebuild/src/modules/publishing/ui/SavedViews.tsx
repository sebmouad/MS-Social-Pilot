'use client';

import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deleteSavedViewConfirmation, normalizeSavedViewQuery, savedViewCopy, SAVED_VIEW_BOUNDS, type SavedViewRecord, type SavedViewScreen } from '@/modules/publishing/saved-views';
import styles from './publishing.module.css';

/** Sidebar list of the viewer's own saved filter combinations for Posts or Calendar. */
export function SavedViews({ screen }: { screen: SavedViewScreen }) {
  const params = useSearchParams();
  const [copy, setCopy] = useState(savedViewCopy('en'));
  const [views, setViews] = useState<SavedViewRecord[] | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const id = useId();

  useEffect(() => { setCopy(savedViewCopy(document.documentElement.lang || navigator.language)); }, []);
  useEffect(() => {
    let active = true;
    fetch(`/api/publishing/saved-views?screen=${screen}`, { cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ views: SavedViewRecord[]; unavailable?: boolean }>; })
      .then(body => { if (!active) return; setViews(body.views); if (body.unavailable) setMessage({ text: savedViewCopy(document.documentElement.lang).loadFailed, error: true }); })
      .catch(() => { if (active) { setViews([]); setMessage({ text: savedViewCopy(document.documentElement.lang).loadFailed, error: true }); } });
    return () => { active = false; };
  }, [screen]);

  const current = normalizeSavedViewQuery(screen, params.toString());
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setMessage({ text: copy.nameRequired, error: true }); return; }
    if (current === null) { setMessage({ text: copy.invalid, error: true }); return; }
    setPending(true); setMessage(null);
    try {
      const response = await fetch('/api/publishing/saved-views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screen, name: name.trim(), query: current }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ text: body.code === 'conflict' ? copy.limit : copy.saveFailed, error: true }); return; }
      setViews(list => [...(list ?? []), body.view].sort((a, b) => a.name.localeCompare(b.name)));
      setName(''); setMessage({ text: copy.saved, error: false });
    } catch { setMessage({ text: copy.saveFailed, error: true }); }
    finally { setPending(false); }
  }
  async function remove(view: SavedViewRecord) {
    setMessage(null);
    try {
      const response = await fetch(`/api/publishing/saved-views/${encodeURIComponent(view.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: deleteSavedViewConfirmation(view.id) }) });
      if (!response.ok) { setMessage({ text: copy.removeFailed, error: true }); return; }
      setViews(list => (list ?? []).filter(item => item.id !== view.id)); setMessage({ text: copy.removed, error: false });
    } catch { setMessage({ text: copy.removeFailed, error: true }); }
  }

  return <section className={styles.postFilters} aria-labelledby={`${id}-heading`}>
    <p className="shell-subnav__label" id={`${id}-heading`}>{copy.heading}</p>
    {views === null ? <p className={styles.help} aria-busy="true">…</p> : views.length ? <ul className={styles.savedViewList}>
      {views.map(view => <li key={view.id}>
        <a href={view.href} aria-current={current === view.query ? 'page' : undefined}>{view.name}</a>
        <button type="button" className="ui-button ui-button--secondary" aria-label={copy.removeLabel(view.name)} onClick={() => remove(view)}>{copy.remove}</button>
      </li>)}
    </ul> : <p className={styles.help}>{copy.empty}</p>}
    <form onSubmit={save} noValidate>
      <label htmlFor={`${id}-name`}>{copy.nameLabel}</label>
      <input id={`${id}-name`} value={name} maxLength={SAVED_VIEW_BOUNDS.maxName} onChange={event => setName(event.target.value)} aria-invalid={message?.error && !name.trim() ? true : undefined} />
      <button type="submit" disabled={pending}>{pending ? copy.saving : copy.save}</button>
    </form>
    {message ? <p role={message.error ? 'alert' : 'status'} className={message.error ? styles.errorNotice : styles.help}>{message.text}</p> : null}
  </section>;
}
