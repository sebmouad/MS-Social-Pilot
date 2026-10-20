'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { RouteNotice } from '@/components/RouteNotice';

type Change = { receipts?: unknown; id: string; operationType: string; objectType: string; objectId: string; status: string; createdAt: string; needsResolution: boolean; resolutionKind?: 'pending_recovery' | 'uncertain'; onHold?: boolean; resolutionNote: string | null };
type Resolution = 'applied' | 'not_applied';
const STATUS_TEXT: Record<string, string> = { pending: 'In progress (on hold)', succeeded: 'Applied', rejected: 'Not applied', uncertain: 'Unknown result', resolved_applied: 'Confirmed applied', resolved_not_applied: 'Confirmed not applied' };
const TYPE_TEXT: Record<string, string> = { 'status.set': 'Pause or resume', 'budget.set': 'Budget change', rename: 'Rename', 'creative.assign': 'Creative change', delete: 'Delete', 'campaign.create': 'New campaign', 'adset.create': 'New ad set', 'creative.create': 'New unattached creative' };
const isCreation = (type: string) => type === 'campaign.create' || type === 'adset.create' || type === 'creative.create';

export function ChangeHistory({ items, locale = 'en' }: { items: Change[]; locale?: 'en' | 'fr' }) {
  const [rows, setRows] = useState(items);
  const [resolving, setResolving] = useState<{ change: Change; resolution: Resolution } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean; key: string } | null>(null);

  async function resolve() {
    if (!resolving) return;
    setBusy(true); setMessage(null);
    const { change, resolution } = resolving;
    const confirmation = `${change.resolutionKind === 'pending_recovery' ? 'RECOVER' : 'RESOLVE'} ADS CHANGE ${change.id} AS ${resolution === 'applied' ? 'APPLIED' : 'NOT APPLIED'}`;
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resolve', operationId: change.id, resolution, ...(note.trim() ? { note: note.trim() } : {}), confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; status?: string };
      if (!response.ok || !payload.status) throw new Error(payload.error || 'This could not be saved. Check Ads change history and try again.');
      setRows(current => current.map(item => item.id === change.id ? { ...item, status: payload.status!, needsResolution: false, onHold: false, resolutionNote: note.trim() || null } : item));
      setMessage({ text: 'Your review was recorded. This action did not contact the advertising platform or send the change again.', error: false, key: String(Date.now()) });
      setResolving(null); setNote('');
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'This could not be saved. Check Ads change history and try again.', error: true, key: String(Date.now()) });
    } finally { setBusy(false); }
  }

  function beginResolution(change: Change, resolution: Resolution) {
    setMessage(null); setNote(''); setResolving({ change, resolution });
  }

  async function refreshHistory() {
    setRefreshing(true); setMessage(null);
    try {
      const response = await fetch('/api/ads/management?view=changes');
      const payload = await response.json().catch(() => ({})) as { error?: string; items?: Change[] };
      if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || 'Change history could not be refreshed. Try again.');
      setRows(payload.items);
      setMessage({ text: 'Change history updated.', error: false, key: String(Date.now()) });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Change history could not be refreshed. Try again.', error: true, key: String(Date.now()) });
    } finally { setRefreshing(false); }
  }

  return <>
    {message && !resolving ? <RouteNotice error={message.error} className={message.error ? 'ui-error' : 'small-note'} focusKey={message.key}>{message.text}</RouteNotice> : null}
    <Button onClick={() => void refreshHistory()} disabled={refreshing || busy}>{refreshing ? 'Refreshing…' : 'Refresh change history'}</Button>
    {!rows.length ? <p className="small-note">No changes have been made through this workspace yet.</p> : <ul className="ads-change-history">{rows.map(change => <li key={change.id}>
      <strong>{change.operationType === 'creative.create' && locale === 'fr' ? 'Nouveau visuel sans affectation' : TYPE_TEXT[change.operationType] ?? 'Ads change'}</strong> · {isCreation(change.operationType) ? null : <>{change.objectType} · </>}{STATUS_TEXT[change.status] ?? 'Needs review'} · <time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time>
      {change.onHold && !change.needsResolution ? <p className="small-note">This change may still be in progress. It stays on hold until the result is recorded. Do not repeat it. The service will not allow a review while its request is still in flight.</p> : null}
      {change.needsResolution ? <>
        {change.resolutionKind === 'pending_recovery'
          ? <p className="small-note">This request is still recorded as in progress. Check the object in your advertising platform first; the service checks for an active dispatch before it records your finding. This only updates workspace history; it never sends or repeats the change.</p>
          : <p className="small-note">The result is unknown. Check the object in your advertising platform first. Recording your finding changes only this workspace’s history; it never sends or repeats the change.</p>}
        <Button variant="secondary" disabled={busy} onClick={() => beginResolution(change, 'applied')}>I checked: it was applied</Button>{' '}
        <Button variant="secondary" disabled={busy} onClick={() => beginResolution(change, 'not_applied')}>I checked: it was not applied</Button>
      </> : null}
      {isCreation(change.operationType) && Array.isArray(change.receipts) && change.receipts.length ? <details><summary>{locale === 'fr' ? 'Reçus de création' : 'Creation receipts'}</summary><pre className="ads-creation-receipts">{JSON.stringify(change.receipts, null, 2)}</pre><p className="small-note">{locale === 'fr' ? 'Une création partielle peut laisser une image importée. Vérifiez les objets sur la plateforme avant d’enregistrer le résultat.' : 'A partial creation may leave an uploaded image. Review the objects in the platform before recording an outcome.'}</p></details> : null}
      {change.resolutionNote ? <p className="small-note">Review note: {change.resolutionNote}</p> : null}
    </li>)}</ul>}

    {resolving ? <ModalDialog className="ui-dialog" labelledBy="ads-change-resolution-title" onDismiss={() => { if (!busy) setResolving(null); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id="ads-change-resolution-title">Record your review</h2><p>{resolving.resolution === 'applied' ? 'Mark this change as applied.' : 'Mark this change as not applied.'}</p></div></div>
      <div className="ui-dialog__body">
        <p><strong>Check the object in your advertising platform before continuing.</strong></p>
        <p>This only records your finding in workspace history; it will not contact the platform or send the change again. The service checks for an active dispatch before saving a pending recovery.</p>
        <label>Review note (optional)<textarea className="ui-input" value={note} maxLength={500} onChange={event => setNote(event.target.value)} disabled={busy} /></label>
        {message ? <RouteNotice error className="ui-error" focusKey={message.key}>{message.text}</RouteNotice> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button data-dialog-cancel onClick={() => setResolving(null)} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void resolve()} disabled={busy}>{busy ? 'Recording…' : 'Record review'}</Button>
      </div>
    </ModalDialog> : null}
  </>;
}
