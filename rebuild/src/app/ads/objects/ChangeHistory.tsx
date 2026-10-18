'use client';

import { useState } from 'react';

type Change = { id: string; operationType: string; objectType: string; objectId: string; status: string; createdAt: string; needsResolution: boolean; onHold?: boolean; resolutionNote: string | null };
const STATUS_TEXT: Record<string, string> = { pending: 'In progress (on hold)', succeeded: 'Applied', rejected: 'Not applied', uncertain: 'Unknown result', resolved_applied: 'Confirmed applied', resolved_not_applied: 'Confirmed not applied' };
const TYPE_TEXT: Record<string, string> = { 'status.set': 'Pause or resume', 'budget.set': 'Budget change', rename: 'Rename', 'creative.assign': 'Creative change', delete: 'Delete' };

export function ChangeHistory({ items }: { items: Change[] }) {
  const [rows, setRows] = useState(items);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  async function resolve(change: Change, resolution: 'applied' | 'not_applied') {
    setBusyId(change.id); setMessage('');
    const confirmation = `RESOLVE ADS CHANGE ${change.id} AS ${resolution === 'applied' ? 'APPLIED' : 'NOT APPLIED'}`;
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resolve', operationId: change.id, resolution, confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; status?: string };
      if (!response.ok || !payload.status) throw new Error(payload.error || 'This could not be saved.');
      setRows(current => current.map(item => item.id === change.id ? { ...item, status: payload.status!, needsResolution: false, onHold: false } : item));
      setMessage('Saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This could not be saved.'); }
    finally { setBusyId(''); }
  }
  if (!rows.length) return <p className="small-note">No changes have been made through this workspace yet.</p>;
  return <>
    {message ? <p role="status" className="small-note">{message}</p> : null}
    <ul className="ads-change-history">{rows.map(change => <li key={change.id}>
      <strong>{TYPE_TEXT[change.operationType] ?? change.operationType}</strong> · {change.objectType} {change.objectId} · {STATUS_TEXT[change.status] ?? change.status} · <time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time>
      {change.status === 'pending' ? <p className="small-note">This change has no confirmed result yet. New changes to this {change.objectType} stay on hold until it finishes or is reviewed. Do not repeat it.</p> : null}
      {change.needsResolution ? <div>
        <p className="small-note">The result of this change is unknown. Check the {change.objectType} in your advertising platform, then record what you found. The change will not be sent again.</p>
        <button type="button" disabled={busyId === change.id} onClick={() => void resolve(change, 'applied')}>It was applied</button>{' '}
        <button type="button" disabled={busyId === change.id} onClick={() => void resolve(change, 'not_applied')}>It was not applied</button>
      </div> : null}
    </li>)}</ul>
  </>;
}
