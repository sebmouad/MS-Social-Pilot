'use client';

import { useState } from 'react';
import styles from '../settings.module.css';

type Feature = { id: string; name: string; module: string; canRead: boolean; canWrite: boolean };
type ApiKey = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; expiresAt: string; revokedAt: string | null; createdAt: string; lastUsedAt: string | null };

export function McpKeyManager({ features, initialKeys, maxLifetimeDays }: { features: Feature[]; initialKeys: ApiKey[]; maxLifetimeDays: number }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(Math.min(maxLifetimeDays, 90));
  const [readFeatures, setReadFeatures] = useState<string[]>([]);
  const [writeFeatures, setWriteFeatures] = useState<string[]>([]);
  const [newToken, setNewToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const toggleRead = (id: string, checked: boolean) => {
    setReadFeatures(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
    if (!checked) setWriteFeatures(current => current.filter(item => item !== id));
  };
  const toggleWrite = (id: string, checked: boolean) => {
    setWriteFeatures(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
    if (checked) setReadFeatures(current => [...new Set([...current, id])]);
  };
  async function createKey(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(''); setNewToken('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, readFeatures, writeFeatures, expiresInDays }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not create key.');
      setNewToken(result.token);
      setKeys(current => [{ ...result.key, revokedAt: null, createdAt: new Date().toISOString(), lastUsedAt: null }, ...current]);
      setName(''); setReadFeatures([]); setWriteFeatures([]);
      setNotice('Key created. Copy it now; it will not be shown again.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create key.'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not revoke key.');
      setKeys(current => current.map(key => key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key));
      setNotice('Key revoked.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not revoke key.'); }
    finally { setBusy(false); }
  }
  return <>
    <form method="post" className={styles['mcp-key-form']} onSubmit={createKey}>
      <div className={styles['mcp-key-fields']}>
        <label>Key name<input required maxLength={100} value={name} onChange={event => setName(event.currentTarget.value)} placeholder="Automation client" disabled={busy} /></label>
        <label>Lifetime in days<input type="number" min={1} max={maxLifetimeDays} value={expiresInDays} onChange={event => setExpiresInDays(Number(event.currentTarget.value))} disabled={busy} /></label>
      </div>
      <fieldset><legend>Allowed features</legend>
        {features.map(feature => <div key={feature.id} className={styles['mcp-key-feature']}>
          <span>{feature.name} <small>{feature.module}</small></span>
          <label><input type="checkbox" checked={readFeatures.includes(feature.id)} onChange={event => toggleRead(feature.id, event.currentTarget.checked)} disabled={!feature.canRead || busy} /> Read</label>
          <label><input type="checkbox" checked={writeFeatures.includes(feature.id)} onChange={event => toggleWrite(feature.id, event.currentTarget.checked)} disabled={!feature.canWrite || busy} /> Write</label>
        </div>)}
      </fieldset>
      <button type="submit" disabled={busy || !name.trim() || !readFeatures.length}>{busy ? 'Creating…' : 'Create API key'}</button>
    </form>
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
    {newToken && <label className={styles['mcp-key-token']}>Copy this bearer token now<textarea readOnly value={newToken} onFocus={event => event.currentTarget.select()} rows={3} /></label>}
    <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>Name</th><th>Scopes</th><th>Expires</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>
      {keys.map(key => { const inactive = Boolean(key.revokedAt) || new Date(key.expiresAt).getTime() <= Date.now(); return <tr key={key.id}>
        <td><span className={styles['settings-table__primary']}>{key.name}</span><span className={styles['settings-table__secondary']}>{key.tokenPrefix}… · created {new Date(key.createdAt).toLocaleDateString()}</span></td>
        <td>{key.readFeatures.map(id => `${key.writeFeatures.includes(id) ? 'write' : 'read'} ${features.find(feature => feature.id === id)?.name ?? id}`).join(', ')}</td>
        <td>{new Date(key.expiresAt).toLocaleDateString()}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}</td>
        <td>{key.revokedAt ? 'Revoked' : inactive ? 'Expired' : 'Active'}</td><td>{!inactive && <button type="button" onClick={() => revoke(key.id)} disabled={busy}>Revoke</button>}</td>
      </tr>; })}
      {!keys.length && <tr><td colSpan={6}>No MCP API keys have been issued.</td></tr>}
    </tbody></table></div>
  </>;
}
