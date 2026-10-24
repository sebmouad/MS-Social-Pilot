'use client';
import { useRootActionFeedback } from '@/modules/root/ui/RootActionFeedback';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from '@/components/Menu';
import { IconLogout, IconShieldOff } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { rootUserConfirmation, type RootUserAction } from '@/lib/root-user-controls';

const titles: Record<RootUserAction, string> = {
  disable: 'Disable account',
  enable: 'Enable account',
  'sign-out': 'Sign out sessions',
  'reset-two-step': 'Reset two-step verification',
};

export function RootUserControls({ id, email, disabled, root, self }: { id: string; email: string; disabled: boolean; root: boolean; self: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<RootUserAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useRootActionFeedback(error, notice, () => router.refresh());
  const inFlight = useRef(false);
  const phrase = action ? rootUserConfirmation(action, email) : '';

  function begin(next: RootUserAction) {
    setConfirmation('');
    setError('');
    setNotice('');
    setAction(next);
  }

  async function save() {
    if (!action || inFlight.current || confirmation !== phrase) return;
    const requestedAction = action;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const accessChange = requestedAction === 'disable' || requestedAction === 'enable';
      const response = await fetch(`/api/root/users/${encodeURIComponent(id)}`, {
        method: accessChange ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(accessChange
          ? { disabled: requestedAction === 'disable', confirmation }
          : { action: requestedAction, confirmation }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;
        setError(apiError ?? 'The account change could not be confirmed. Check the directory and installation activity before retrying.');
        return;
      }
      if (response.redirected || !isRecord(payload) || payload.ok !== true || payload.userId !== id || payload.action !== requestedAction) {
        setError('The response did not confirm the account change. Check the directory and installation activity before retrying.');
        return;
      }
      setNotice(successMessage(requestedAction));
      setAction(null);
      setConfirmation('');
      router.refresh();
    } catch {
      setError('The result could not be confirmed. Check the directory and installation activity before retrying.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (self) return <span className="root-directory__self">Your account</span>;
  return <>
    <div className="root-directory__actions" aria-label={`Account actions for ${email}`}>
      <Button type="button" size="sm" onClick={() => begin(disabled ? 'enable' : 'disable')}>{disabled ? 'Enable' : 'Disable'}</Button>
      <Menu label={`Account actions for ${email}`} items={[
        { key: 'sign-out', label: 'Sign out', icon: <IconLogout size={16} />, danger: true, onSelect: () => begin('sign-out') },
        ...(!root ? [{ key: 'reset-two-step', label: 'Reset two-step', icon: <IconShieldOff size={16} />, danger: true, onSelect: () => begin('reset-two-step') }] : []),
      ]} />
    </div>
    {notice && <p className="root-config__status" role="status" aria-live="polite">{notice}</p>}
    {action && <ModalDialog className="ui-dialog" labelledBy={`root-user-${id}`} busy={busy} onDismiss={() => { if (!busy) setAction(null); }}>
      <div className="ui-dialog__header"><h2 id={`root-user-${id}`}>{titles[action]}?</h2></div>
      <div className="ui-dialog__body">
        <p><strong>{email}</strong></p>
        <p>{actionDescription(action)}</p>
        <label className="ui-field"><span>Type <strong>{phrase}</strong> to confirm</span><input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label>
        {error && <p role="alert" className="ui-error">{error}</p>}
      </div>
      <div className="ui-dialog__actions">
        <Button type="button" data-dialog-cancel onClick={() => setAction(null)} disabled={busy}>Cancel</Button>
        <Button type="button" variant={action === 'enable' ? 'primary' : 'danger'} onClick={() => void save()} disabled={busy || confirmation !== phrase}>{busy ? 'Saving…' : titles[action]}</Button>
      </div>
    </ModalDialog>}
  </>;
}

function actionDescription(action: RootUserAction) {
  switch (action) {
    case 'disable': return 'This account will be disabled and its active sessions will end. Re-enable it here to restore sign-in.';
    case 'enable': return 'This account will be allowed to sign in again.';
    case 'sign-out': return 'All active browser and app sessions will end. Workspace API keys are managed separately and will not change.';
    case 'reset-two-step': return 'Registered two-step methods and recovery material will be cleared. The user will need to set up verification again when required by policy.';
  }
}

function successMessage(action: RootUserAction) {
  switch (action) {
    case 'disable': return 'Account disabled and active sessions ended.';
    case 'enable': return 'Account enabled.';
    case 'sign-out': return 'Active sessions ended.';
    case 'reset-two-step': return 'Two-step verification reset.';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
