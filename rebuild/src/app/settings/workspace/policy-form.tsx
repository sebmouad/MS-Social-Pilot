'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import styles from './policy.module.css';

export function WorkspacePolicyForm({ workspaceId, timezone: initialTimezone, requiresApproval: initialApproval, maxTimezoneCharacters }: { workspaceId: string; timezone: string; requiresApproval: boolean; maxTimezoneCharacters: number }) {
  const [timezone, setTimezone] = useState(initialTimezone); const [requiresApproval, setRequiresApproval] = useState(initialApproval); const [confirmation, setConfirmation] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const expected = `UPDATE WORKSPACE POLICY ${workspaceId}`;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage(''); setError(false);
    try { const response = await fetch('/api/settings/workspace/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone, requiresApproval, confirmation }) }); const result = await response.json(); if (!response.ok || result.ok !== true || result.timezone !== timezone || result.requiresApproval !== requiresApproval) throw new Error(result.error ?? 'The workspace policy outcome is unconfirmed. Refresh before trying again.'); setConfirmation(''); setMessage('Workspace policies saved.'); }
    catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : 'Workspace policies could not be confirmed.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label className={styles.field}><span>Time zone</span><input required disabled={busy} maxLength={maxTimezoneCharacters} value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="America/New_York" /><small>Enter a valid IANA time zone, such as Europe/Paris or UTC.</small></label>
    <label className={styles.check}><input type="checkbox" disabled={busy} checked={requiresApproval} onChange={event => setRequiresApproval(event.target.checked)} /><span>Require approval for new scheduled posts by contributors</span></label>
    <label className={styles.field}><span>Type this confirmation to save</span><input required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /><small>{expected}</small></label>
    <Button type="submit" variant="primary" disabled={busy || confirmation !== expected}>{busy ? 'Saving…' : 'Save workspace policies'}</Button>
    {message && <p className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
  </form>;
}
