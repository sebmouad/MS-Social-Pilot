'use client';

import { useState } from 'react';
import styles from '@/modules/settings/ui/settings.module.css';
import { fill } from '@/modules/settings/ui/shell-copy';
import { dataCopy } from './copy';
import { summarizeDeletionCounts } from './preview';

export function DataControls({ workspaceName, destructive = false, locale = 'en' }: { workspaceName: string; destructive?: boolean; locale?: 'en' | 'fr' }) {
  const t = dataCopy[locale];
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState(false);
  const previewRows = counts ? summarizeDeletionCounts(counts, locale) : [];

  async function previewDeletion() {
    setPreviewBusy(true); setNotice(''); setDeleted(false); setCounts(null); setConfirmation('');
    try {
      const response = await fetch('/api/settings/data', { method: 'POST', cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.counts) throw new Error(result.error ?? t.previewFailed);
      setCounts(result.counts);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.previewFailed); }
    finally { setPreviewBusy(false); }
  }

  async function removeData() {
    setBusy(true); setNotice(''); setDeleted(false);
    try {
      const response = await fetch('/api/settings/data', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? t.deleteFailed);
      setNotice(t.deleted); setDeleted(true);
      setConfirmation('');
    } catch (error) { setNotice(error instanceof Error ? error.message : t.deleteFailed); }
    finally { setBusy(false); }
  }

  if (!destructive) return null;

  return <div className={styles['data-controls']}>
    {!counts ? <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? t.counting : t.preview}</button> : <>
      <p className={styles['settings-note']}>{t.found}</p>
      {previewRows.length ? <ul className={styles['data-preview-list']}>{previewRows.map(row => <li key={row.label}><span>{row.label}</span><strong>{new Intl.NumberFormat(locale).format(row.count)}</strong></li>)}</ul> : <p className={styles['settings-note']}>{t.none}</p>}
      <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? t.counting : t.refresh}</button>
      <label className={styles['data-confirm-label']} htmlFor="delete-workspace-data">{t.confirmLabel}</label>
      <div className={styles['data-delete-row']}><input id="delete-workspace-data" value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} autoComplete="off" disabled={busy} /><button type="button" className={styles['data-danger-button']} disabled={busy || confirmation !== 'DELETE'} onClick={removeData}>{busy ? t.deleting : t.deleteButton}</button></div>
    </>}
    {notice && <p role={deleted ? 'status' : 'alert'} className={styles['settings-note']}>{notice}</p>}
    <span className={styles['settings-note']}>{fill(t.permanent, { workspace: workspaceName })}</span>
  </div>;
}
