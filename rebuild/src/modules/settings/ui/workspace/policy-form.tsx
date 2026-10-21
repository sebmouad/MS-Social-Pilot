'use client';
import { useConfirmedAction } from '@/modules/settings/ui/use-confirmed-action';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';
import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import styles from './policy.module.css';


export function WorkspacePolicyForm({ workspaceId, workspaceName = workspaceId, timezone: initialTimezone, requiresApproval: initialApproval, maxTimezoneCharacters, locale = 'en' }: { workspaceId: string; workspaceName?: string; timezone: string; requiresApproval: boolean; maxTimezoneCharacters: number; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const confirmedAction = useConfirmedAction();
  const t = useSettingsCopy('workspace', locale);
  const [timezone, setTimezone] = useState(initialTimezone); const [requiresApproval, setRequiresApproval] = useState(initialApproval); const [review, setReview] = useState(false); const cancel = useSettingsCopy('team', locale).cancel; const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const expected = `UPDATE WORKSPACE POLICY ${workspaceId}`;
  async function submit() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage(''); setError(false);
    try { const response = await fetch('/api/settings/workspace/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone, requiresApproval, confirmation: expected }) }); const result = await response.json(); if (!response.ok || result.ok !== true || result.timezone !== timezone || result.requiresApproval !== requiresApproval) throw new Error(result.error ?? t.unconfirmed); setReview(false); setMessage(t.saved); toast.notify({ title: t.saved }); }
    catch (cause) { const message = cause instanceof Error ? cause.message : t.failed; setError(true); setMessage(message); toast.failed(message, () => document.querySelector<HTMLInputElement>('input[required]')?.focus(), t.save); return message; }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form noValidate className={styles.form} onSubmit={event => { event.preventDefault(); setReview(true); }}>
    <label className={styles.field}><span>{t.timezone}</span><input required disabled={busy} maxLength={maxTimezoneCharacters} value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="America/New_York" /><small>{t.timezoneHint}</small></label>
    <label className={styles.check}><input type="checkbox" disabled={busy} checked={requiresApproval} onChange={event => setRequiresApproval(event.target.checked)} /><span>{t.requireApproval}</span></label>
    <Button type="submit" variant="primary" disabled={busy}>{busy ? t.saving : t.save}</Button>
    {review && <ConfirmDialog open title={t.save} objectName={workspaceName} consequence={t.confirmationConsequence} confirmLabel={t.save} cancelLabel={cancel} failureLabel={t.unconfirmed} danger={false} onClose={() => setReview(false)} onConfirm={() => confirmedAction(async () => (await submit()) ?? null)} />}
    {message && <p className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
  </form>;
}
