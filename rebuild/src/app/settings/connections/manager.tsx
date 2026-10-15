'use client';

import { useState } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import styles from '../settings.module.css';

type Channel = { id: string; name: string; type: string; enabled: boolean };
type AdAccount = { id: string; name: string; actId: string; enabled: boolean };
type Source = { id: string; name: string; provider: string; invalidatedAt: Date | null; targets: Channel[]; adAccounts: AdAccount[] };

export function ConnectionManager({ sources, canManage, canConnectFacebook, initiallyOpen = false }: { sources: Source[]; canManage: boolean; canConnectFacebook: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [disconnect, setDisconnect] = useState<Source | null>(null);
  const [disconnectMode, setDisconnectMode] = useState<'retain' | 'delete'>('retain');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePreview, setDeletePreview] = useState<Record<string, number> | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const toggle = (kind: 'target' | 'adAccount', id: string, checked: boolean) => setSelected(current => ({ ...current, [`${kind}:${id}`]: checked }));

  async function connectFacebook() {
    setConnecting(true); setNotice('');
    try {
      const response = await fetch('/api/connections/facebook/start', { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.authorizationUrl !== 'string') throw new Error(result.error ?? 'Could not start Meta authorization.');
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' && authorizationUrl.hostname !== 'localhost') throw new Error('Connection unavailable. Try again or contact support.');
      window.location.assign(authorizationUrl.toString());
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not start Meta authorization.'); setConnecting(false); }
  }

  async function saveSelection() {
    setBusy(true); setNotice('');
    try {
      const items = Object.entries(selected).map(([key, enabled]) => {
        const [kind, id] = key.split(':');
        return { kind, id, enabled };
      });
      const response = await fetch('/api/connections', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? 'Could not save all selections.');
      }
      setOpen(false); setSelected({}); window.location.reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save your selections. Check your access and try again.'); }
    finally { setBusy(false); }
  }

  async function disconnectSource() {
    if (!disconnect) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/connections', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ socialAccountId: disconnect.id, mode: disconnectMode, ...(disconnectMode === 'delete' ? { confirmation: deleteConfirmation } : {}) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Could not disconnect this source.');
      setDisconnect(null); setDeleteConfirmation(''); setDisconnectMode('retain'); window.location.reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not disconnect this source.'); }
    finally { setBusy(false); }
  }

  async function previewDisconnect(source: Source) {
    setPreviewBusy(true); setDeletePreview(null); setDeleteConfirmation(''); setNotice('');
    try {
      const response = await fetch('/api/connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ socialAccountId: source.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.counts) throw new Error(result.error ?? 'Could not preview related data.');
      setDeletePreview(result.counts);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not preview related data.'); }
    finally { setPreviewBusy(false); }
  }

  if (!canManage) return null;
  return <>
    <div className={styles['connection-toolbar']}><p>Choose the channels and advertising accounts this workspace uses.</p><div>{canConnectFacebook && <button type="button" onClick={connectFacebook} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect Facebook'}</button>}<button type="button" className={styles['connection-primary-button']} onClick={() => setOpen(true)}>Manage selections</button></div></div>
    {notice && !open && !disconnect && <p role="alert" className={styles['connection-error']}>{notice}</p>}
    {open && <ModalDialog className={styles['connection-dialog']} labelledBy="connection-dialog-title" onDismiss={() => setOpen(false)} busy={busy} initialFocus="[aria-label='Close']">
      <header><div><p className={styles['settings-eyebrow']}>Workspace connections</p><h2 id="connection-dialog-title">Choose channels and ad accounts</h2><p>Turn discovered channels and advertising accounts on or off for this workspace.</p></div><button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button></header>
      {sources.length ? sources.map(source => <fieldset className={styles['connection-source']} key={source.id}><legend>{source.name} <span>{source.provider.replace(/[_-]/g, ' ')}</span></legend>
        {source.invalidatedAt && <p className={styles['settings-note']}>This source needs to be reconnected before selections can be enabled.</p>}
        {source.targets.map(item => <label key={item.id}><input type="checkbox" checked={selected[`target:${item.id}`] ?? item.enabled} disabled={Boolean(source.invalidatedAt) || busy} onChange={event => toggle('target', item.id, event.currentTarget.checked)} /><span>{item.name || item.type}<small>Channel · {item.type}</small></span></label>)}
        {source.adAccounts.map(item => <label key={item.id}><input type="checkbox" checked={selected[`adAccount:${item.id}`] ?? item.enabled} disabled={Boolean(source.invalidatedAt) || busy} onChange={event => toggle('adAccount', item.id, event.currentTarget.checked)} /><span>{item.name}<small>Ad account · {item.actId}</small></span></label>)}
        {!source.targets.length && !source.adAccounts.length && <p className={styles['settings-note']}>No channels or ad accounts have been discovered for this source.</p>}
        <button type="button" className={styles['connection-danger-link']} onClick={() => { setOpen(false); setDisconnect(source); setDisconnectMode('retain'); setDeleteConfirmation(''); }}>Disconnect locally…</button>
      </fieldset>) : <p>No discovered sources are available.</p>}
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" data-dialog-cancel onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button type="button" className={styles['connection-primary-button']} onClick={saveSelection} disabled={busy}>{busy ? 'Saving…' : 'Save selections'}</button></footer>
    </ModalDialog>}
    {disconnect && <ModalDialog className={styles['connection-dialog']} labelledBy="disconnect-title" onDismiss={() => setDisconnect(null)} busy={busy}><header><div><p className={styles['settings-eyebrow']}>Local disconnect</p><h2 id="disconnect-title">Disconnect {disconnect.name} locally?</h2><p>Neither choice revokes provider access or deletes content already published. Posts already handed to the provider may still publish.</p></div><button type="button" aria-label="Close" disabled={busy} onClick={() => setDisconnect(null)}>×</button></header>
      <fieldset className={styles['connection-retention']}><legend>Related local data</legend>
        <label><input type="radio" name="disconnect-data" checked={disconnectMode === 'retain'} onChange={() => { setDisconnectMode('retain'); setDeleteConfirmation(''); }} disabled={busy} /><span>Retain history <small>Disable this source and keep its channels, account records, inbox, metrics, comments, and post links.</small></span></label>
        <label><input type="radio" name="disconnect-data" checked={disconnectMode === 'delete'} onChange={() => { setDisconnectMode('delete'); setDeletePreview(null); setDeleteConfirmation(''); }} disabled={busy} /><span>Delete related local data <small>Remove channels and accounts with their mapped local history. A post remains if it still targets another channel.</small></span></label>
      </fieldset>
      {disconnectMode === 'delete' && <>
        {!deletePreview ? <button type="button" onClick={() => previewDisconnect(disconnect)} disabled={busy || previewBusy}>{previewBusy ? 'Counting rows…' : 'Preview related rows'}</button> : <>
          <p className={styles['settings-note']}>Current rows in the mapped related tables:</p>
          <ul>{Object.entries(deletePreview).map(([name, count]) => <li key={name}>{name}: {count}</li>)}</ul>
          <button type="button" onClick={() => previewDisconnect(disconnect)} disabled={busy || previewBusy}>{previewBusy ? 'Counting rows…' : 'Refresh preview'}</button>
          <label className={styles['disconnect-confirm']}>Type DELETE to confirm<input value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.currentTarget.value)} autoComplete="off" disabled={busy} /></label>
        </>}
      </>}
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" data-dialog-cancel onClick={() => setDisconnect(null)} disabled={busy}>Cancel</button><button type="button" className={styles['connection-danger-button']} onClick={disconnectSource} disabled={busy || (disconnectMode === 'delete' && (!deletePreview || deleteConfirmation !== 'DELETE'))}>{busy ? 'Disconnecting…' : disconnectMode === 'delete' ? 'Disconnect and delete data' : 'Disconnect and retain data'}</button></footer>
    </ModalDialog>}
  </>;
}
