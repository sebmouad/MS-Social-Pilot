'use client';

import { useState } from 'react';
import styles from '../settings.module.css';

export function DataControls({ workspaceName, destructive = false }: { workspaceName: string; destructive?: boolean }) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [notice, setNotice] = useState('');

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
      setNotice('Workspace data was deleted. The workspace and its member access remain available.');
      setConfirmation('');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Workspace data could not be deleted.'); }
    finally { setBusy(false); }
  }

  if (!destructive) return <div className={styles['data-controls']}><a className={styles['data-button']} href="/api/settings/data">Download JSON export</a><span className={styles['settings-note']}>The file is generated when you request it and is not stored by this app.</span></div>;

  return <div className={styles['data-controls']}>
    {!counts ? <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? 'Counting rows…' : 'Preview rows to delete'}</button> : <>
      <p className={styles['settings-note']}>Current rows in the mapped data-control tables:</p>
      <ul>{Object.entries(counts).map(([name, count]) => <li key={name}>{name}: {count}</li>)}</ul>
      <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? 'Counting rows…' : 'Refresh preview'}</button>
      <label className={styles['data-confirm-label']} htmlFor="delete-workspace-data">Type DELETE to confirm</label>
      <div className={styles['data-delete-row']}><input id="delete-workspace-data" value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} autoComplete="off" disabled={busy} /><button type="button" className={styles['data-danger-button']} disabled={busy || confirmation !== 'DELETE'} onClick={removeData}>{busy ? 'Deleting…' : 'Delete workspace data'}</button></div>
    </>}
    {notice && <p role={notice.startsWith('Workspace data was') ? 'status' : 'alert'} className={styles['settings-note']}>{notice}</p>}
    <span className={styles['settings-note']}>This is permanent after the database transaction commits. Download an export above first if you need a recoverable copy. {workspaceName} remains as an empty workspace.</span>
  </div>;
}
