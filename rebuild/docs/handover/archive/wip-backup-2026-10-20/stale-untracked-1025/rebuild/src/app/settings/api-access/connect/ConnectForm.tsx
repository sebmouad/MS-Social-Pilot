'use client';

import { useState } from 'react';
import ui from '@/modules/integrations/ui/integrations.module.css';
import { authorizeConnectorAction } from '../actions';

export function ConnectForm({ clientId, name, host, redirectUri, codeChallenge, state, workspaceName }: { clientId: string; name: string; host: string; redirectUri: string; codeChallenge: string; state: string | null; workspaceName: string }) {
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function allow(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const result = await authorizeConnectorAction({ clientId, redirectUri, codeChallenge, codeChallengeMethod: 'S256', scope, ...(state ? { state } : {}), confirmation: `AUTHORIZE CONNECTOR ${clientId}` });
    // A successful consent redirects away; only failures return here.
    setBusy(false); if (result && !result.ok) setError(result.error);
  }
  return <form onSubmit={allow} className={ui.form}>
    <p className={ui.notice}><strong>{name}</strong> wants to act on your behalf in <strong>{workspaceName}</strong>. After you allow it you will be sent to {host}. Make sure you trust it.</p>
    <label className={ui.field}>Access<select value={scope} disabled={busy} onChange={e => setScope(e.currentTarget.value as 'read' | 'write')}><option value="read">Read only</option><option value="write">Read and change</option></select></label>
    <p className={ui.notice}>It can never do more than you can, and you can revoke it under API keys at any time.</p>
    {error && <p role="alert" className={ui.error}>{error}</p>}
    <div className={ui['row-actions']}><button type="submit" disabled={busy}>{busy ? 'Allowing...' : 'Allow access'}</button><a href="/settings/api-access">Cancel</a></div>
  </form>;
}
