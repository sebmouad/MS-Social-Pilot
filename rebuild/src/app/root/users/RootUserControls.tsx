'use client';

import { useState } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { Button } from '@/components/Button';

type Action = 'disable' | 'enable' | 'sign-out' | 'reset-two-step';

export function RootUserControls({ id, email, disabled, root, self }: { id: string; email: string; disabled: boolean; root: boolean; self: boolean }) {
  const [action, setAction] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const phrase = action ? `${action === 'disable' ? 'DISABLE' : action === 'enable' ? 'ENABLE' : action === 'sign-out' ? 'SIGN OUT' : 'RESET TWO-STEP'} ${email}` : '';
  const title = action === 'disable' ? 'Disable account' : action === 'enable' ? 'Enable account' : action === 'sign-out' ? 'Sign out sessions' : 'Reset two-step verification';
  function begin(next: Action) { setConfirmation(''); setError(''); setAction(next); }
  async function save() {
    if (!action) return;
    setBusy(true); setError('');
    try {
      const accessChange = action === 'disable' || action === 'enable';
      const response = await fetch(`/api/root/users/${encodeURIComponent(id)}`, {
        method: accessChange ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(accessChange ? { disabled: action === 'disable', confirmation } : { action, confirmation }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Account change failed.');
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Account change failed.'); setBusy(false); }
  }
  if (self) return <span className="root-directory__self">Your account</span>;
  return <><div className="root-directory__actions"><Button type="button" onClick={() => begin(disabled ? 'enable' : 'disable')}>{disabled ? 'Enable' : 'Disable'}</Button><Button type="button" onClick={() => begin('sign-out')}>Sign out</Button>{!root && <Button type="button" onClick={() => begin('reset-two-step')}>Reset two-step</Button>}</div>
    {action && <ModalDialog className="ui-dialog" labelledBy={`root-user-${id}`} onDismiss={() => { if (!busy) setAction(null); }} busy={busy}>
      <div className="ui-dialog__header"><h2 id={`root-user-${id}`}>{title}?</h2></div>
      <div className="ui-dialog__body"><p>{email}</p><p>{action === 'disable' ? 'The account will be disabled and all sessions will end.' : action === 'enable' ? 'The user can sign in again.' : action === 'sign-out' ? 'All current sessions will end. The account stays active.' : 'Authenticator, passkeys, recovery codes and sessions will be cleared. The user must set up verification again when required by policy.'}</p><label className="ui-field"><span>Type <strong>{phrase}</strong> to confirm</span><input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>{error && <p role="alert" className="ui-error">{error}</p>}</div>
      <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel onClick={() => setAction(null)} disabled={busy}>Cancel</Button><Button type="button" variant={action === 'enable' ? 'primary' : 'danger'} onClick={() => void save()} disabled={busy || confirmation !== phrase}>{busy ? 'Saving…' : title}</Button></div>
    </ModalDialog>}
  </>;
}
