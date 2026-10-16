'use client';

import { useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { Button } from '@/components/Button';

export function CreateRootWorkspace({ defaultTimezone, maxName }: { defaultTimezone: string; maxName: number }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  const phrase = `CREATE ${cleanName} FOR ${cleanEmail}`;
  function prepare(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); setConfirmation(''); setOpen(true); }
  async function create() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/root/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: cleanName, ownerEmail: cleanEmail, timezone: timezone.trim(), confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Workspace could not be created.');
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Workspace could not be created.'); setBusy(false); }
  }
  return <><form method="post" className="root-directory__create" onSubmit={prepare}><label className="ui-field">Workspace name<input className="ui-input" value={name} onChange={event => setName(event.target.value)} maxLength={maxName} required /></label><label className="ui-field">Owner email<input className="ui-input" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label className="ui-field">Timezone<input className="ui-input" value={timezone} onChange={event => setTimezone(event.target.value)} required /></label><Button type="submit" variant="primary">Create workspace</Button></form>
    {open && <ModalDialog className="ui-dialog" labelledBy="root-create-workspace" onDismiss={() => { if (!busy) setOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><h2 id="root-create-workspace">Create workspace?</h2></div>
      <div className="ui-dialog__body"><p><strong>{cleanName}</strong> · {timezone} · owner {cleanEmail}</p><p>The owner will gain access immediately.</p><label className="ui-field"><span>Type <strong>{phrase}</strong> to confirm</span><input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>{error && <p className="ui-error" role="alert">{error}</p>}</div>
      <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button type="button" variant="primary" onClick={() => void create()} disabled={busy || confirmation !== phrase}>{busy ? 'Creating…' : 'Create workspace'}</Button></div>
    </ModalDialog>}
  </>;
}

export function RenameRootWorkspace({ id, currentName, maxName, deleting }: { id: string; currentName: string; maxName: number; deleting: boolean }) {
  const [name, setName] = useState(currentName);
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cleanName = name.trim();
  const phrase = `RENAME ${currentName} TO ${cleanName}`;
  async function rename() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/root/workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: cleanName, confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Workspace could not be renamed.');
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Workspace could not be renamed.'); setBusy(false); }
  }
  return <><Button type="button" disabled={deleting} onClick={() => { setName(currentName); setConfirmation(''); setError(''); setOpen(true); }}>Rename</Button>
    {open && <ModalDialog className="ui-dialog" labelledBy={`root-rename-${id}`} onDismiss={() => { if (!busy) setOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><h2 id={`root-rename-${id}`}>Rename workspace?</h2></div>
      <div className="ui-dialog__body"><label className="ui-field">New name<input className="ui-input" value={name} onChange={event => { setName(event.target.value); setConfirmation(''); }} maxLength={maxName} required /></label><p>Existing links and workspace slug stay unchanged.</p><label className="ui-field"><span>Type <strong>{phrase}</strong> to confirm</span><input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>{error && <p className="ui-error" role="alert">{error}</p>}</div>
      <div className="ui-dialog__actions"><Button type="button" data-dialog-cancel onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button type="button" variant="primary" onClick={() => void rename()} disabled={busy || !cleanName || confirmation !== phrase}>{busy ? 'Saving…' : 'Rename workspace'}</Button></div>
    </ModalDialog>}
  </>;
}
