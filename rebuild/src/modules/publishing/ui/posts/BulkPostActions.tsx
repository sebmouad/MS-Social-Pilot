'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, TextInput, useToast } from '@/components';
import { BULK_ACTIONS, bulkConfirmation, type BulkAction, type BulkResult } from '@/modules/publishing/bulk';
import { usePublishingActionText } from '../WorkflowSubmitButtons';
import { actionBulkCopy } from '../../action-catalog';
import type { KitLocale } from '../kit/copy';
import styles from '@/modules/publishing/ui/publishing.module.css';

/**
 * Bulk toolbar for the rows chosen in the shared table. The table owns the selection; this owns the
 * action choice, the confirmation dialog and the outcome, which is reported in a toast with Retry on failure.
 */
export function BulkPostActions({ selected, onClear, canRetry, locale }: { selected: string[]; onClear: () => void; canRetry: boolean; locale?: KitLocale }) {
  const router = useRouter();
  const toast = useToast();
  const inFlight = useRef(false);
  const copy = actionBulkCopy(usePublishingActionText(locale));
  const [action, setAction] = useState<BulkAction | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(chosen: BulkAction) {
    if (inFlight.current) return;
    if (chosen === 'reschedule' && (!date || !time)) { setError(copy.whenRequired); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/publishing/posts/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: chosen, postIds: selected, requestId: crypto.randomUUID(), confirmation: bulkConfirmation(chosen, selected.length), ...(chosen === 'reschedule' ? { date, time } : {}) }) });
      const body = await response.json().catch(() => null) as (BulkResult & { error?: string }) | null;
      if (!response.ok || !body || body.action !== chosen || typeof body.done !== 'number') {
        const message = body?.error ?? copy.unconfirmed;
        setError(message);
        toast.failed(copy.titles[chosen], () => setAction(chosen), copy.tryAgain, message);
        return;
      }
      toast.notify({ title: copy.summary(body) });
      setAction(null); onClear(); router.refresh();
    } catch {
      setError(copy.unconfirmed);
      toast.failed(copy.titles[chosen], () => setAction(chosen), copy.tryAgain, copy.unconfirmed);
    } finally { setBusy(false); inFlight.current = false; }
  }

  if (!selected.length) return null;
  const actions = BULK_ACTIONS.filter(item => item !== 'retry' || canRetry);
  return <div className={styles.bulkBar} role="toolbar" aria-label={copy.selected(selected.length)}>
    <span aria-live="polite"><strong>{copy.selected(selected.length)}</strong></span>
    {actions.map(item => <Button key={item} size="sm" variant={item === 'delete' ? 'danger' : 'secondary'} disabled={busy} onClick={() => { setError(''); setAction(item); }}>{copy.actions[item]}</Button>)}
    <Button size="sm" variant="quiet" disabled={busy} onClick={onClear}>{copy.clear}</Button>
    <Dialog open={action !== null} title={action ? copy.titles[action] : ''} description={action ? `${copy.descriptions[action]} ${copy.selected(selected.length)}.` : ''} busy={busy} onClose={() => !busy && setAction(null)}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setAction(null)}>{copy.cancel}</Button><Button variant={action === 'delete' ? 'danger' : 'primary'} busy={busy} onClick={() => action && void run(action)}>{busy ? copy.working : action ? copy.actions[action] : copy.confirm}</Button></>}>
      {action === 'reschedule' ? <div className={styles.postFilters}>
        <Field label={copy.date} required><TextInput type="date" value={date} onChange={event => setDate(event.target.value)} required /></Field>
        <Field label={copy.time} required><TextInput type="time" value={time} onChange={event => setTime(event.target.value)} required /></Field>
      </div> : null}
      {error ? <p role="alert" tabIndex={-1}>{error}</p> : null}
    </Dialog>
  </div>;
}
