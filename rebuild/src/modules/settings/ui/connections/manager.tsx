'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog, useToast } from '@/components';
import { ModalDialog } from '@/components/ModalDialog';
import styles from '@/modules/settings/ui/settings.module.css';
import { connectionState, type ConnectionStatusLabels } from '@/lib/connection-status';
import { fill } from '@/modules/settings/ui/shell-copy';

import { summarizeDisconnectCounts } from './preview';

type Channel = { id: string; name: string; type: string; enabled: boolean };
type AdAccount = { id: string; name: string; actId: string; enabled: boolean };
type Source = { id: string; name: string; provider: string; invalidatedAt: Date | null; tokenExpiresAt: Date | null; targets: Channel[]; adAccounts: AdAccount[] };

type Connectable = { id: string; name: string; mark: { text: string; color: string } };

export function ConnectionManager({ statusLabels, sources, canManage, platforms, initiallyOpen = false, initialSourceId, initialAction, locale = 'en' }: { statusLabels: ConnectionStatusLabels; sources: Source[]; canManage: boolean; platforms: Connectable[]; initiallyOpen?: boolean; initialSourceId?: string; initialAction?: 'manage' | 'disconnect'; locale?: 'en' | 'fr' }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const retrySelection = useRef<() => void>(() => {});
  const toast = useToast();
  const [reviewDisconnect, setReviewDisconnect] = useState(false);
  const t = useSettingsCopy('connections', locale);
  const initialSource = sources.find(source => source.id === initialSourceId);
  const [open, setOpen] = useState(initiallyOpen || Boolean(initialSource && initialAction === 'manage'));
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [disconnect, setDisconnect] = useState<Source | null>(initialSource && initialAction === 'disconnect' ? initialSource : null);
  const [disconnectMode, setDisconnectMode] = useState<'retain' | 'delete'>('retain');
  const [deletePreview, setDeletePreview] = useState<Record<string, number> | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const deleteSummary = deletePreview ? summarizeDisconnectCounts(deletePreview, locale, t.categories) : null;
  useEffect(() => {
    if (!initialSource || !initialAction) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('source');
    url.searchParams.delete('action');
    window.history.replaceState(window.history.state, '', url);
  }, [initialSource, initialAction]);
  const toggle = (kind: 'target' | 'adAccount', id: string, checked: boolean) => setSelected(current => ({ ...current, [`${kind}:${id}`]: checked }));

  async function connect(platform: Connectable) {
    setConnecting(platform.id); setNotice('');
    try {
      const response = await fetch(`/api/oauth/connections/${encodeURIComponent(platform.id)}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: `START CONNECTION ${platform.id}` }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.authorizationUrl !== 'string') throw new Error(result.error ?? fill(t.startFailed, { platform: platform.name }));
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' && authorizationUrl.hostname !== 'localhost') throw new Error(t.connectFailed);
      window.location.assign(authorizationUrl.toString());
    } catch (error) { setNotice(error instanceof Error ? error.message : fill(t.startFailed, { platform: platform.name })); setConnecting(null); }
  }

  async function saveSelection() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice('');
    try {
      const items = Object.entries(selected).map(([key, enabled]) => {
        const [kind, id] = key.split(':');
        return { kind, id, enabled };
      }).filter(item => sources.some(source => (item.kind === 'target' ? source.targets : source.adAccounts).some(resource => resource.id === item.id && resource.enabled !== item.enabled)));
      if (!items.length) { setOpen(false); setSelected({}); toast.notify({ title: t.saved }); return; }
      const response = await fetch('/api/connections', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, confirmation: `SET CONNECTION SELECTIONS ${items.length}` }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? t.saveAllFailed);
      }
      toast.notify({ title: t.saved }); setOpen(false); setSelected({}); router.refresh();
    } catch (error) { const message = error instanceof Error ? error.message : t.saveFailed; setNotice(message); toast.failed(message, () => retrySelection.current(), t.saveSelections); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function disconnectSource() {
    if (!disconnect || inFlight.current) return t.disconnectFailed;
    inFlight.current = true;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/connections', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ socialAccountId: disconnect.id, mode: disconnectMode, ...(disconnectMode === 'delete' ? { confirmation: 'DELETE' } : {}) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? t.disconnectFailed);
      toast.notify({ title: disconnectMode === 'delete' ? t.disconnectDelete : t.disconnectRetain }); setDisconnect(null); setDisconnectMode('retain'); router.refresh(); return null;
    } catch (error) { const message = error instanceof Error ? error.message : t.disconnectFailed; setNotice(message); toast.failed(message, () => setReviewDisconnect(true), t.disconnect); return message; }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function previewDisconnect(source: Source) {
    setPreviewBusy(true); setDeletePreview(null); setNotice('');
    try {
      const response = await fetch('/api/connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ socialAccountId: source.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.counts) throw new Error(result.error ?? t.previewFailed);
      setDeletePreview(result.counts);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.previewFailed); }
    finally { setPreviewBusy(false); }
  }

  retrySelection.current = () => void saveSelection();
  if (!canManage || (!sources.length && !platforms.length)) return null;
  return <>
    <div id="connection-actions" className={styles['connection-toolbar']}><p>{sources.length ? t.toolbarSources : t.toolbarEmpty}</p><div>{platforms.map(platform => <button type="button" key={platform.id} onClick={() => connect(platform)} disabled={connecting !== null}><span aria-hidden="true" className={styles['connection-mark']} style={{ background: platform.mark.color }}>{platform.mark.text}</span>{connecting === platform.id ? t.connecting : fill(t.connect, { platform: platform.name })}</button>)}{sources.length > 0 && <button type="button" className={styles['connection-primary-button']} onClick={() => setOpen(true)}>{t.manageSelections}</button>}</div></div>
    {notice && !open && !disconnect && <p role="alert" className={styles['connection-error']}>{notice}</p>}
    {open && <ModalDialog className={styles['connection-dialog']} labelledBy="connection-dialog-title" onDismiss={() => setOpen(false)} busy={busy} initialFocus={initialSource && initialAction === 'manage' ? '[data-connection-source-focus]' : '[data-dialog-cancel]'}>
      <header><div><p className={styles['settings-eyebrow']}>{t.dialogEyebrow}</p><h2 id="connection-dialog-title">{t.dialogTitle}</h2><p>{t.dialogDetail}</p></div><button type="button" aria-label={t.close} disabled={busy} onClick={() => setOpen(false)}>×</button></header>
      {sources.length ? sources.map(source => <fieldset id={`connection-source-${source.id}`} className={`${styles['connection-source']}${initialSourceId === source.id ? ` ${styles['connection-source--selected']}` : ''}`} data-connection-source-focus={initialSourceId === source.id ? '' : undefined} tabIndex={initialSourceId === source.id ? -1 : undefined} key={source.id}><legend>{source.name} <span>{source.provider.replace(/[_-]/g, ' ')}</span></legend>
        {connectionState(source) !== 'connected' && <p className={styles['settings-note']}>{fill(t.reconnectHint, { status: statusLabels[connectionState(source)] })}</p>}
        {source.targets.map(item => <label key={item.id}><input type="checkbox" checked={selected[`target:${item.id}`] ?? item.enabled} disabled={busy || (connectionState(source) !== 'connected' && !item.enabled)} onChange={event => toggle('target', item.id, event.currentTarget.checked)} /><span>{item.name || item.type}<small>{fill(t.channel, { type: item.type })}</small></span></label>)}
        {source.adAccounts.map(item => <label key={item.id}><input type="checkbox" checked={selected[`adAccount:${item.id}`] ?? item.enabled} disabled={busy || (connectionState(source) !== 'connected' && !item.enabled)} onChange={event => toggle('adAccount', item.id, event.currentTarget.checked)} /><span>{item.name}<small>{fill(t.adAccountLine, { id: item.actId })}</small></span></label>)}
        {!source.targets.length && !source.adAccounts.length && <p className={styles['settings-note']}>{t.nothingDiscovered}</p>}
        <button type="button" className={styles['connection-danger-link']} onClick={() => { setOpen(false); setDisconnect(source); setDisconnectMode('retain'); }}>{t.disconnectLocally}</button>
      </fieldset>) : <p>{t.noSources}</p>}
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" data-dialog-cancel onClick={() => setOpen(false)} disabled={busy}>{t.cancel}</button><button type="button" className={styles['connection-primary-button']} onClick={saveSelection} disabled={busy}>{busy ? t.saving : t.saveSelections}</button></footer>
    </ModalDialog>}
    {disconnect && !reviewDisconnect && <ModalDialog className={styles['connection-dialog']} labelledBy="disconnect-title" onDismiss={() => setDisconnect(null)} busy={busy}><header><div><p className={styles['settings-eyebrow']}>{t.localDisconnect}</p><h2 id="disconnect-title">{fill(t.disconnectTitle, { name: disconnect.name })}</h2><p>{t.disconnectDetail}</p></div><button type="button" aria-label={t.close} disabled={busy} onClick={() => setDisconnect(null)}>×</button></header>
      <fieldset className={styles['connection-retention']}><legend>{t.relatedData}</legend>
        <label><input type="radio" name="disconnect-data" checked={disconnectMode === 'retain'} onChange={() => { setDisconnectMode('retain'); }} disabled={busy} /><span>{t.retain} <small>{t.retainDetail}</small></span></label>
        <label><input type="radio" name="disconnect-data" checked={disconnectMode === 'delete'} onChange={() => { setDisconnectMode('delete'); setDeletePreview(null); }} disabled={busy} /><span>{t.deleteData} <small>{t.deleteDataDetail}</small></span></label>
      </fieldset>
      {disconnectMode === 'delete' && <>
        {!deletePreview ? <button type="button" onClick={() => previewDisconnect(disconnect)} disabled={busy || previewBusy}>{previewBusy ? t.counting : t.previewRows}</button> : <>
          <p className={styles['settings-note']}>{t.linkedRecords}</p>
          {deleteSummary?.rows.length ? <ul className={styles['data-preview-list']}>{deleteSummary.rows.map(row => <li key={row.label}><span>{row.label}</span><strong>{new Intl.NumberFormat(locale).format(row.count)}</strong></li>)}</ul> : <p className={styles['settings-note']}>{t.noRecords}</p>}
          {Boolean(deleteSummary?.scheduledRemote) && <p className={styles['connection-warning']} role="alert">{deleteSummary?.scheduledRemote === 1 ? t.scheduledOne : fill(t.scheduledMany, { count: deleteSummary?.scheduledRemote ?? 0 })}</p>}
          <button type="button" onClick={() => previewDisconnect(disconnect)} disabled={busy || previewBusy}>{previewBusy ? t.counting : t.refreshPreview}</button>
        </>}
      </>}
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" data-dialog-cancel onClick={() => setDisconnect(null)} disabled={busy}>{t.cancel}</button><button type="button" className={styles['connection-danger-button']} onClick={() => setReviewDisconnect(true)} disabled={busy || (disconnectMode === 'delete' && (!deletePreview || Boolean(deleteSummary?.scheduledRemote)))}>{busy ? t.disconnecting : disconnectMode === 'delete' ? t.disconnectDelete : t.disconnectRetain}</button></footer>
    </ModalDialog>}
    {disconnect && reviewDisconnect && <ConfirmDialog open title={fill(t.disconnectTitle, { name: disconnect.name })} objectName={disconnect.name} consequence={`${disconnectMode === 'delete' ? t.deleteDataDetail : t.retainDetail} ${t.disconnectDetail}`} confirmLabel={disconnectMode === 'delete' ? t.disconnectDelete : t.disconnectRetain} cancelLabel={t.cancel} pendingLabel={t.disconnecting} failureLabel={t.disconnectFailed} onClose={() => setReviewDisconnect(false)} onConfirm={async () => (await disconnectSource()) ?? null} />}
  </>;
}
