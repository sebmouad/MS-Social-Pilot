'use client';

import { useState } from 'react';
import { transferConfirmation } from '@/modules/root/server/admin/shared';
import { ConfirmAction } from '../plans/ConfirmAction';

export function TransferOwnership() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [email, setEmail] = useState('');
  const [previousOwners, setPrevious] = useState<'keep' | 'demote_admin'>('demote_admin');
  const ready = workspaceId.trim() !== '' && /^\S+@\S+\.\S+$/.test(email.trim());
  const address = email.trim().toLowerCase();
  return <section className="root-ops__panel" aria-labelledby="transfer"><h2 id="transfer">Transfer workspace ownership</h2>
    <p className="root-ops__muted">Make an existing active account the owner of one workspace. Nothing is deleted. This does not change who administers the installation.</p>
    <div className="root-ops__fields">
      <label className="ui-field"><span>Workspace ID</span><input className="ui-input" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} autoComplete="off" /></label>
      <label className="ui-field"><span>New owner email</span><input className="ui-input" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></label>
      <label className="ui-field"><span>Current owners</span><select className="ui-input" value={previousOwners} onChange={event => setPrevious(event.target.value as 'keep' | 'demote_admin')}><option value="demote_admin">Become admins</option><option value="keep">Stay owners</option></select></label>
    </div>
    <div className="root-ops__actions"><ConfirmAction id="transfer-ownership" label="Transfer ownership" title="Transfer workspace ownership?" description={previousOwners === 'demote_admin' ? 'The new owner gains full control. Current owners become admins and keep access.' : 'The new owner gains full control alongside the current owners.'} phrase={transferConfirmation(workspaceId.trim(), address)} endpoint="/api/root/lifecycle/ownership" body={{ workspaceId: workspaceId.trim(), newOwnerEmail: address, previousOwners }} successText="Ownership transferred." disabled={!ready} /></div>
  </section>;
}
