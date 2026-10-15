'use client';

import { useState } from 'react';
import styles from '../settings.module.css';

type Channel = { id: string; name: string; type: string; enabled: boolean };
type AdAccount = { id: string; name: string; actId: string; enabled: boolean };
type Source = { id: string; name: string; provider: string; invalidatedAt: Date | null; targets: Channel[]; adAccounts: AdAccount[] };

export function ConnectionManager({ sources, canManage, initiallyOpen = false }: { sources: Source[]; canManage: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [disconnect, setDisconnect] = useState<Source | null>(null);
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
      const response = await fetch('/api/connections', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ socialAccountId: disconnect.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'Could not disconnect this source.');
      setDisconnect(null); window.location.reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not disconnect this source.'); }
    finally { setBusy(false); }
  }

  if (!canManage) return null;
  return <>
    <div className={styles['connection-toolbar']}><p>Connect Meta to discover the Pages and ad accounts you can use, then choose them in the selection window.</p><div><button type="button" onClick={connectFacebook} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect Facebook'}</button><button type="button" className={styles['connection-primary-button']} onClick={() => setOpen(true)}>Manage selections</button></div></div>
    {notice && !open && !disconnect && <p role="alert" className={styles['connection-error']}>{notice}</p>}
    {open && <div className={styles['connection-backdrop']} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}><section className={styles['connection-dialog']} role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
      <header><div><p className={styles['settings-eyebrow']}>Workspace connections</p><h2 id="connection-dialog-title">Choose channels and ad accounts</h2><p>Turn discovered channels and advertising accounts on or off for this workspace.</p></div><button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button></header>
      {sources.length ? sources.map(source => <fieldset className={styles['connection-source']} key={source.id}><legend>{source.name} <span>{source.provider.replace(/[_-]/g, ' ')}</span></legend>
        {source.invalidatedAt && <p className={styles['settings-note']}>This source needs to be reconnected before selections can be enabled.</p>}
        {source.targets.map(item => <label key={item.id}><input type="checkbox" checked={selected[`target:${item.id}`] ?? item.enabled} disabled={Boolean(source.invalidatedAt) || busy} onChange={event => toggle('target', item.id, event.currentTarget.checked)} /><span>{item.name || item.type}<small>Channel · {item.type}</small></span></label>)}
        {source.adAccounts.map(item => <label key={item.id}><input type="checkbox" checked={selected[`adAccount:${item.id}`] ?? item.enabled} disabled={Boolean(source.invalidatedAt) || busy} onChange={event => toggle('adAccount', item.id, event.currentTarget.checked)} /><span>{item.name}<small>Ad account · {item.actId}</small></span></label>)}
        {!source.targets.length && !source.adAccounts.length && <p className={styles['settings-note']}>No channels or ad accounts have been discovered for this source.</p>}
        <button type="button" className={styles['connection-danger-link']} onClick={() => { setDisconnect(source); }}>Disconnect locally…</button>
      </fieldset>) : <p>No discovered sources are available.</p>}
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button><button type="button" className={styles['connection-primary-button']} onClick={saveSelection} disabled={busy}>{busy ? 'Saving…' : 'Save selections'}</button></footer>
    </section></div>}
    {disconnect && <div className={styles['connection-backdrop']}><section className={styles['connection-dialog']} role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title"><header><div><p className={styles['settings-eyebrow']}>Local disconnect</p><h2 id="disconnect-title">Disconnect {disconnect.name} locally?</h2><p>This disables its channels and ad accounts for this workspace. Provider access is not revoked, related local records are retained, and posts already handed to the provider may still publish.</p></div><button type="button" aria-label="Close" onClick={() => setDisconnect(null)}>×</button></header>
      <p className={styles['settings-note']}>{disconnect.targets.length} channel{disconnect.targets.length === 1 ? '' : 's'} and {disconnect.adAccounts.length} ad account{disconnect.adAccounts.length === 1 ? '' : 's'} will be retained with their local history.</p>
      {notice && <p role="alert" className={styles['connection-error']}>{notice}</p>}
      <footer><button type="button" onClick={() => setDisconnect(null)} disabled={busy}>Cancel</button><button type="button" className={styles['connection-danger-button']} onClick={disconnectSource} disabled={busy}>{busy ? 'Disconnecting…' : 'Disconnect source'}</button></footer>
    </section></div>}
  </>;
}
