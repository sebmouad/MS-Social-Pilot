'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { BULK_ACTIONS, bulkConfirmation, bulkCopy, type BulkAction, type BulkResult } from '@/modules/publishing/bulk';
import styles from '../publishing.module.css';

const FORM_ID = 'bulk-posts';

/** Checkbox for one post row; associated with the bulk toolbar by form id. */
export function BulkSelect({ postId, label }: { postId: string; label: string }) {
  const [copy, setCopy] = useState(bulkCopy('en'));
  useEffect(() => { setCopy(bulkCopy(document.documentElement.lang || navigator.language)); }, []);
  return <input type="checkbox" form={FORM_ID} name="postId" value={postId} aria-label={copy.select(label)} />;
}

/** Bulk toolbar: select posts, choose an action, confirm in a dialog, then see per-post outcomes. */
export function BulkPostActions({ canRetry }: { canRetry: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [copy, setCopy] = useState(bulkCopy('en'));
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<BulkAction | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => { setCopy(bulkCopy(document.documentElement.lang || navigator.language)); }, []);
  useEffect(() => {
    const sync = () => setSelected(formRef.current ? [...formRef.current.elements].filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.name === 'postId' && el.checked).map(el => el.value) : []);
    document.addEventListener('change', sync);
    sync();
    return () => document.removeEventListener('change', sync);
  }, []);
  const boxes = () => formRef.current ? [...formRef.current.elements].filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.name === 'postId') : [];
  const setAll = (checked: boolean) => { for (const box of boxes()) box.checked = checked; setSelected(checked ? boxes().map(box => box.value) : []); };

  async function run() {
    if (!action || inFlight.current) return;
    if (action === 'reschedule' && (!date || !time)) { setError(copy.whenRequired); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/publishing/posts/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, postIds: selected, requestId: crypto.randomUUID(), confirmation: bulkConfirmation(action, selected.length), ...(action === 'reschedule' ? { date, time } : {}) }) });
      const body = await response.json().catch(() => null) as (BulkResult & { error?: string }) | null;
      if (!response.ok || !body || body.action !== action || typeof body.done !== 'number') { setError(body?.error ?? copy.unconfirmed); return; }
      setResult(copy.summary(body)); setAction(null); setAll(false); router.refresh();
    } catch { setError(copy.unconfirmed); }
    finally { setBusy(false); inFlight.current = false; }
  }

  const actions = BULK_ACTIONS.filter(item => item !== 'retry' || canRetry);
  return <form id={FORM_ID} ref={formRef} className={styles.bulkBar} onSubmit={event => event.preventDefault()} aria-label={copy.selected(selected.length)}>
    <label><input type="checkbox" checked={selected.length > 0 && selected.length === boxes().length} onChange={event => setAll(event.currentTarget.checked)} /> {copy.selectAll}</label>
    <span aria-live="polite">{copy.selected(selected.length)}</span>
    {actions.map(item => <Button key={item} size="sm" variant={item === 'delete' ? 'danger' : 'secondary'} disabled={!selected.length || busy} onClick={() => { setError(''); setResult(''); setAction(item); }}>{copy.actions[item]}</Button>)}
    {selected.length ? <Button size="sm" disabled={busy} onClick={() => setAll(false)}>{copy.clear}</Button> : null}
    <p role="status" aria-live="polite">{result}</p>
    <Dialog open={action !== null} title={action ? copy.titles[action] : ''} description={action ? `${copy.descriptions[action]} ${copy.selected(selected.length)}.` : ''} busy={busy} onClose={() => !busy && setAction(null)}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setAction(null)}>{copy.cancel}</Button><Button variant={action === 'delete' ? 'danger' : 'primary'} disabled={busy} onClick={() => void run()}>{busy ? copy.working : action ? copy.actions[action] : copy.confirm}</Button></>}>
      {action === 'reschedule' ? <div className={styles.postFilters}>
        <label htmlFor="bulk-date">{copy.date}</label><input id="bulk-date" type="date" value={date} onChange={event => setDate(event.target.value)} required />
        <label htmlFor="bulk-time">{copy.time}</label><input id="bulk-time" type="time" value={time} onChange={event => setTime(event.target.value)} required />
      </div> : null}
      {error ? <p role="alert" tabIndex={-1}>{error}</p> : null}
    </Dialog>
  </form>;
}
