import { useAdsMessage } from '@/modules/ads/ui/AdsCopyProvider';
'use client';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { RouteNotice } from '@/components/RouteNotice';

type Change = { receipts?: unknown; id: string; operationType: string; objectType: string; objectId: string; status: string; createdAt: string; needsResolution: boolean; resolutionKind?: 'pending_recovery' | 'uncertain'; onHold?: boolean; resolutionNote: string | null };
type Resolution = 'applied' | 'not_applied';
const isCreation = (type: string) => type === 'campaign.create' || type === 'adset.create' || type === 'creative.create';

export function ChangeHistory({ items, locale = 'en' }: { items: Change[]; locale?: 'en' | 'fr' }) {
  const localize = useAdsMessage();
  const t = useAdsText();
  const STATUS_TEXT: Record<string, string> = { pending: t('pending'), succeeded: t('succeeded'), rejected: t('rejected'), uncertain: t('uncertain'), resolved_applied: t('resolved_applied'), resolved_not_applied: t('resolved_not_applied') };
  const TYPE_TEXT: Record<string, string> = { 'status.set': t('statusChange'), 'budget.set': t('budgetChange'), rename: t('rename'), 'creative.assign': t('creativeChange'), delete: t('delete'), 'campaign.create': t('newCampaign'), 'adset.create': t('newAdSet'), 'creative.create': t('newCreative') };

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
      if (!response.ok || !payload.status) throw new Error(payload.error || t('text226'));
      setRows(current => current.map(item => item.id === change.id ? { ...item, status: payload.status!, needsResolution: false, onHold: false, resolutionNote: note.trim() || null } : item));
      setMessage({ text: t('text227'), error: false, key: String(Date.now()) });
      setResolving(null); setNote('');
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('text226'), error: true, key: String(Date.now()) });
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
      if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || t('text228'));
      setRows(payload.items);
      setMessage({ text: t('text229'), error: false, key: String(Date.now()) });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('text228'), error: true, key: String(Date.now()) });
    } finally { setRefreshing(false); }
  }

  return <>
    {message && !resolving ? <RouteNotice error={message.error} className={message.error ? 'ui-error' : 'small-note'} focusKey={message.key}>{localize(message.text)}</RouteNotice> : null}
    <Button onClick={() => void refreshHistory()} disabled={refreshing || busy}>{refreshing ? t('text127') : t('text230')}</Button>
    {!rows.length ? <p className="small-note">{t('text128')}</p> : <ul className="ads-change-history">{rows.map(change => <li key={change.id}>
      <strong>{TYPE_TEXT[change.operationType] ?? t('text232')}</strong> {t('text166')}{isCreation(change.operationType) ? null : <>{change.objectType} {t('text166')}</>}{STATUS_TEXT[change.status] ?? t('text233')} {t('text166')}<time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time>
      {change.onHold && !change.needsResolution ? <p className="small-note">{t('text129')}</p> : null}
      {change.needsResolution ? <>
        {change.resolutionKind === 'pending_recovery'
          ? <p className="small-note">{t('text130')}</p>
          : <p className="small-note">{t('text131')}</p>}
        <Button variant="secondary" disabled={busy} onClick={() => beginResolution(change, 'applied')}>{t('text132')}</Button>{' '}
        <Button variant="secondary" disabled={busy} onClick={() => beginResolution(change, 'not_applied')}>{t('text133')}</Button>
      </> : null}
      {isCreation(change.operationType) && Array.isArray(change.receipts) && change.receipts.length ? <details><summary>{t('text234')}</summary><pre className="ads-creation-receipts">{JSON.stringify(change.receipts, null, 2)}</pre><p className="small-note">{t('text134')}</p></details> : null}
      {change.resolutionNote ? <p className="small-note">{t('text135')}{change.resolutionNote}</p> : null}
    </li>)}</ul>}

    {resolving ? <ModalDialog className="ui-dialog" labelledBy="ads-change-resolution-title" onDismiss={() => { if (!busy) setResolving(null); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id="ads-change-resolution-title">{t('text136')}</h2><p>{resolving.resolution === 'applied' ? t('text137') : t('text138')}</p></div></div>
      <div className="ui-dialog__body">
        <p><strong>{t('text139')}</strong></p>
        <p>{t('text140')}</p>
        <label>{t('text141')}<textarea className="ui-input" value={note} maxLength={500} onChange={event => setNote(event.target.value)} disabled={busy} /></label>
        {message ? <RouteNotice error className="ui-error" focusKey={message.key}>{localize(message.text)}</RouteNotice> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button data-dialog-cancel onClick={() => setResolving(null)} disabled={busy}>{t('text125')}</Button>
        <Button variant="primary" onClick={() => void resolve()} disabled={busy}>{busy ? t('text142') : t('text235')}</Button>
      </div>
    </ModalDialog> : null}
  </>;
}
