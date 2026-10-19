'use client';

import { useState } from 'react';
import styles from '@/modules/settings/ui/settings.module.css';
import { summarizeDeletionCounts } from './preview';

export function DataControls({ workspaceName, destructive = false }: { workspaceName: string; destructive?: boolean }) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [notice, setNotice] = useState('');
  const previewRows = counts ? summarizeDeletionCounts(counts) : [];

  async function previewDeletion() {
    setPreviewBusy(true); setNotice(''); setCounts(null); setConfirmation('');
    try {
      const response = await fetch('/api/settings/data', { method: 'POST', cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.counts) throw new Error(result.error ?? 'Could not preview workspace data deletion.');
      setCounts(result.counts);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not preview workspace data deletion.'); }
    finally { setPreviewBusy(false); }
  }

  async function removeData() {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/data', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Workspace data could not be deleted.');
      setNotice('Workspace records and stored files were deleted. Workspace and member access remain available. Remote platform content was not changed.');
      setConfirmation('');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Workspace data could not be deleted.'); }
    finally { setBusy(false); }
  }

  if (!destructive) return <div className={styles['data-controls']}><a className={styles['data-button']} href="/api/settings/data">Download workspace ZIP</a><span className={styles['settings-note']}>Includes the rebuild database snapshot and stored workspace media. The archive manifest describes database coverage.</span></div>;

  return <div className={styles['data-controls']}>
    {!counts ? <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? 'Counting rows…' : 'Preview rows to delete'}</button> : <>
      <p className={styles['settings-note']}>Records found in this workspace, grouped by what they contain:</p>
      {previewRows.length ? <ul className={styles['data-preview-list']}>{previewRows.map(row => <li key={row.label}><span>{row.label}</span><strong>{new Intl.NumberFormat().format(row.count)}</strong></li>)}</ul> : <p className={styles['settings-note']}>No content records were found. Stored files and linked settings may still be removed.</p>}
      <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? 'Counting rows…' : 'Refresh preview'}</button>
      <label className={styles['data-confirm-label']} htmlFor="delete-workspace-data">Type DELETE to confirm</label>
      <div className={styles['data-delete-row']}><input id="delete-workspace-data" value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} autoComplete="off" disabled={busy} /><button type="button" className={styles['data-danger-button']} disabled={busy || confirmation !== 'DELETE'} onClick={removeData}>{busy ? 'Deleting…' : 'Delete workspace data'}</button></div>
    </>}
    {notice && <p role={notice.startsWith('Workspace records and stored files were') ? 'status' : 'alert'} className={styles['settings-note']}>{notice}</p>}
    <span className={styles['settings-note']}>Deletion is permanent once complete. If file cleanup fails, retry with the same confirmation; the app resumes without repeating database deletion. {workspaceName} remains as an empty workspace.</span>
  </div>;
}
