'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * One typed-confirmation flow for every Root legacy mutation. The request is
 * only reported as successful when the response is an explicit `ok: true`
 * receipt; anything else tells the operator to check current state first.
 */
export function ConfirmAction({ id, label, title, description, phrase, endpoint, method = 'POST', body, variant = 'danger', successText, disabled, children }: {
  id: string; label: string; title: string; description: string; phrase: string; endpoint: string; method?: 'POST' | 'PATCH';
  body: Record<string, unknown>; variant?: 'primary' | 'danger'; successText: string; disabled?: boolean; children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  async function save() {
    if (inFlight.current || confirmation !== phrase) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, confirmation }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'The change could not be confirmed. Check the current state before repeating it.');
        return;
      }
      if (response.redirected || !isRecord(payload) || payload.ok !== true) {
        setError('The response did not confirm the change. Check the current state before repeating it.');
        return;
      }
      setNotice(payload.changed === false ? 'Nothing needed to change.' : successText);
      setOpen(false);
      setConfirmation('');
      router.refresh();
    } catch {
      setError('The result could not be confirmed. Check the current state before repeating it.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <>
    <Button type="button" size="sm" onClick={() => { setConfirmation(''); setError(''); setNotice(''); setOpen(true); }} disabled={disabled}>{label}</Button>
    {notice && <p className="root-config__status" role="status" aria-live="polite">{notice}</p>}
    {open && <ModalDialog className="ui-dialog" labelledBy={`confirm-${id}`} busy={busy} onDismiss={() => { if (!busy) setOpen(false); }}>
      <div className="ui-dialog__header"><h2 id={`confirm-${id}`}>{title}</h2></div>
      <div className="ui-dialog__body">
        <p>{description}</p>
        {children}
        <label className="ui-field"><span>Type <strong>{phrase}</strong> to confirm</span><input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label>
        {error && <p role="alert" className="ui-error">{error}</p>}
      </div>
      <div className="ui-dialog__actions">
        <Button type="button" data-dialog-cancel onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
        <Button type="button" variant={variant} onClick={() => void save()} disabled={busy || confirmation !== phrase}>{busy ? 'Saving…' : label}</Button>
      </div>
    </ModalDialog>}
  </>;
}
