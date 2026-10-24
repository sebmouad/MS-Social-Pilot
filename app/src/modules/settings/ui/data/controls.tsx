'use client';
import { useConfirmedAction } from '@/modules/settings/ui/use-confirmed-action';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { ConfirmDialog, useToast } from '@/components';

import { useState } from 'react';
import styles from '@/modules/settings/ui/settings.module.css';
import { fill } from '@/modules/settings/ui/shell-copy';

import { summarizeDeletionCounts } from './preview';

export function DataControls({ workspaceName, destructive = false, locale = 'en' }: { workspaceName: string; destructive?: boolean; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const confirmedAction = useConfirmedAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const t = useSettingsCopy('data', locale);
  const connectionCopy = useSettingsCopy('connections', locale);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState(false);
  const previewRows = counts ? summarizeDeletionCounts(counts, locale, t.categories) : [];

  async function previewDeletion() {
    setPreviewBusy(true); setNotice(''); setDeleted(false); setCounts(null);
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
      const response = await fetch('/api/settings/data', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE' }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(t.deleteFailed);
      setNotice(t.deleted); setDeleted(true); toast.notify({ title: t.deleted });

    } catch (error) { const message = error instanceof Error ? error.message : t.deleteFailed; setNotice(message); toast.failed(message, () => setConfirmOpen(true), t.deleteButton); return message; }
    finally { setBusy(false); }
  }

  if (!destructive) return null;

  return <div className={styles['data-controls']}>
    {!counts ? <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? t.counting : t.preview}</button> : <>
      <p className={styles['settings-note']}>{t.found}</p>
      {previewRows.length ? <ul className={styles['data-preview-list']}>{previewRows.map(row => <li key={row.label}><span>{row.label}</span><strong>{new Intl.NumberFormat(locale).format(row.count)}</strong></li>)}</ul> : <p className={styles['settings-note']}>{t.none}</p>}
      <button type="button" onClick={previewDeletion} disabled={busy || previewBusy}>{previewBusy ? t.counting : t.refresh}</button>
      <div className={styles['data-delete-row']}><button type="button" className={styles['data-danger-button']} disabled={busy} onClick={() => setConfirmOpen(true)}>{busy ? t.deleting : t.deleteButton}</button></div>
    </>}
    {notice && <p role={deleted ? 'status' : 'alert'} className={styles['settings-note']}>{notice}</p>}
    <span className={styles['settings-note']}>{fill(t.permanent, { workspace: workspaceName })}</span>
    {confirmOpen && <ConfirmDialog open title={t.deleteButton} objectName={workspaceName} consequence={fill(t.permanent, { workspace: workspaceName })} confirmLabel={t.deleteButton} cancelLabel={connectionCopy.cancel} pendingLabel={t.deleting} failureLabel={t.deleteFailed} onClose={() => setConfirmOpen(false)} onConfirm={() => confirmedAction(async () => (await removeData()) ?? null)} />}
  </div>;
}
