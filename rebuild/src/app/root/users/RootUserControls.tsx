'use client';

import { useState } from 'react';
import { ModalDialog } from '@/components/ModalDialog';

export function RootUserControls({ id, email, disabled, self }: { id: string; email: string; disabled: boolean; self: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const phrase = `${disabled ? 'ENABLE' : 'DISABLE'} ${email}`;
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/root/users/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled: !disabled, confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Account change failed.');
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Account change failed.'); setBusy(false); }
  }
  if (self) return <span className="root-directory__self">Your account</span>;
  return <><button type="button" onClick={() => { setConfirmation(''); setError(''); setOpen(true); }}>{disabled ? 'Enable' : 'Disable'}</button>
    {open && <ModalDialog className="ui-dialog" labelledBy={`root-user-${id}`} onDismiss={() => { if (!busy) setOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><h2 id={`root-user-${id}`}>{disabled ? 'Enable' : 'Disable'} account?</h2></div>
      <div className="ui-dialog__body"><p>{email}</p><p>{disabled ? 'The user can sign in again.' : 'All current sessions will end immediately.'}</p><label>Type <strong>{phrase}</strong> to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>{error && <p role="alert" className="ui-error">{error}</p>}</div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button type="button" onClick={() => void save()} disabled={busy || confirmation !== phrase}>{busy ? 'Saving…' : disabled ? 'Enable account' : 'Disable account'}</button></div>
    </ModalDialog>}
  </>;
}
