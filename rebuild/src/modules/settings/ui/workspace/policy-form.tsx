'use client';
import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import styles from './policy.module.css';
import { workspacePolicyCopy } from './copy';

export function WorkspacePolicyForm({ workspaceId, timezone: initialTimezone, requiresApproval: initialApproval, maxTimezoneCharacters, locale = 'en' }: { workspaceId: string; timezone: string; requiresApproval: boolean; maxTimezoneCharacters: number; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const t = workspacePolicyCopy[locale];
  const [timezone, setTimezone] = useState(initialTimezone); const [requiresApproval, setRequiresApproval] = useState(initialApproval); const [confirmation, setConfirmation] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const expected = `UPDATE WORKSPACE POLICY ${workspaceId}`;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage(''); setError(false);
    try { const response = await fetch('/api/settings/workspace/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone, requiresApproval, confirmation }) }); const result = await response.json(); if (!response.ok || result.ok !== true || result.timezone !== timezone || result.requiresApproval !== requiresApproval) throw new Error(result.error ?? t.unconfirmed); setConfirmation(''); setMessage(t.saved); toast.notify({ title: t.saved }); }
    catch (cause) { const message = cause instanceof Error ? cause.message : t.failed; setError(true); setMessage(message); toast.failed(message, () => document.querySelector<HTMLInputElement>('input[required]')?.focus(), t.save); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form noValidate className={styles.form} onSubmit={submit}>
    <label className={styles.field}><span>{t.timezone}</span><input required disabled={busy} maxLength={maxTimezoneCharacters} value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="America/New_York" /><small>{t.timezoneHint}</small></label>
    <label className={styles.check}><input type="checkbox" disabled={busy} checked={requiresApproval} onChange={event => setRequiresApproval(event.target.checked)} /><span>{t.requireApproval}</span></label>
    <label className={styles.field}><span>{t.confirmation}</span><input required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /><small>{expected}</small></label>
    <Button type="submit" variant="primary" disabled={busy || confirmation !== expected}>{busy ? t.saving : t.save}</Button>
    {message && <p className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
  </form>;
}
