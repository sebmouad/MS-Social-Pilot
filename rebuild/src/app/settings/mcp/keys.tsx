'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { AutoTextarea } from '@/components/AutoTextarea';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '../settings.module.css';

type Feature = { id: string; name: string; module: string; moduleLabel?:string; canRead: boolean; canWrite: boolean };
type ApiKey = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; resourceScope?: {mode:string;ids?:string[];adAccountIds?:string[]}|null; expiresAt: string; revokedAt: string | null; createdAt: string; lastUsedAt: string | null };

export function McpKeyManager({ features, initialKeys, maxLifetimeDays, defaultLifetimeDays, resources, resourcesTruncated }: { features: Feature[]; initialKeys: ApiKey[]; maxLifetimeDays: number; defaultLifetimeDays:number; resources:Array<{id:string;name:string;kind:'channel'|'adAccount'}>; resourcesTruncated:boolean }) {
  const [keys, setKeys] = useState(initialKeys);
  const [allResources,setAllResources]=useState(false); const [selectedResources,setSelectedResources]=useState<string[]>([]); const [consent,setConsent]=useState(false); const [pendingRevoke,setPendingRevoke]=useState<string|null>(null); const inFlight=useRef(false);
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(Math.min(maxLifetimeDays, defaultLifetimeDays));
  const [readFeatures, setReadFeatures] = useState<string[]>([]);
  const [writeFeatures, setWriteFeatures] = useState<string[]>([]);
  const [newToken, setNewToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const validation = useFormValidation();
  const toggleRead = (id: string, checked: boolean) => {
    setConsent(false);
    setReadFeatures(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
    if (!checked) setWriteFeatures(current => current.filter(item => item !== id));
  };
  const toggleWrite = (id: string, checked: boolean) => {
    setConsent(false);
    setWriteFeatures(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
    if (checked) setReadFeatures(current => [...new Set([...current, id])]);
  };
  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(inFlight.current)return;
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: 'Enter a name for this key.' } : {}), ...(!readFeatures.length ? { features: 'Select at least one readable feature.' } : {}) })) return;
    if(!consent||(!allResources&&resourcesTruncated))return;
    inFlight.current=true;setBusy(true); setNotice(''); setNewToken(''); setTokenVisible(false); setCopyNotice('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, readFeatures, writeFeatures, expiresInDays, resourceScope:allResources?{version:1,mode:'all'}:{version:1,mode:'selected',ids:resources.filter(r=>r.kind==='channel'&&selectedResources.includes(`${r.kind}:${r.id}`)).map(r=>r.id),adAccountIds:resources.filter(r=>r.kind==='adAccount'&&selectedResources.includes(`${r.kind}:${r.id}`)).map(r=>r.id)},confirmation:`CREATE MCP KEY ${name.trim()}` }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not create key.');
      setNewToken(result.token);
      setKeys(current => [{ ...result.key, revokedAt: null, createdAt: new Date().toISOString(), lastUsedAt: null }, ...current]);
      setName(''); setReadFeatures([]); setWriteFeatures([]);setConsent(false);setSelectedResources([]);setAllResources(false);
      setNotice('Key created. Copy it now; it will not be shown again.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create key.'); }
    finally { inFlight.current=false;setBusy(false); }
  }
  async function revoke(id: string) {
    if(inFlight.current)return;inFlight.current=true;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id,confirmation:`REVOKE MCP KEY ${id}` }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not revoke key.');
      setKeys(current => current.map(key => key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key));
      setNotice('Key revoked.');setPendingRevoke(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not revoke key.'); }
    finally { inFlight.current=false;setBusy(false); }
  }
  async function copyToken() {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopyNotice('Token copied to clipboard.');
    } catch {
      setCopyNotice('Could not copy the token. Show it and copy it manually.');
    }
  }
  return <>
    <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={createKey}>
      <div className={styles['mcp-key-fields']}>
        <label>Key name<input name="name" required maxLength={100} value={name} onChange={event => { setName(event.currentTarget.value); setConsent(false); validation.clear('name'); }} autoComplete="off" placeholder="Automation client…" disabled={busy} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label>Lifetime in days<input name="expiresInDays" type="number" min={1} max={maxLifetimeDays} value={expiresInDays} onChange={event => { setExpiresInDays(Number(event.currentTarget.value));setConsent(false); validation.clear('expiresInDays'); }} disabled={busy} {...validation.fieldProps('expiresInDays')} /><FieldError {...validation.errorProps('expiresInDays')} /></label>
      </div>
      <fieldset aria-invalid={validation.errors.features ? true : undefined}><legend>Allowed features</legend>
        <div className={styles['mcp-key-feature-grid']}>{[...new Set(features.map(feature=>feature.module))].map(module=><fieldset className={styles['mcp-key-feature-group']} key={module}><legend>{features.find(feature=>feature.module===module)?.moduleLabel??module}</legend>
        {features.filter(feature=>feature.module===module).map(feature => <div key={feature.id} className={styles['mcp-key-feature']}>
          <span>{feature.name} </span>
          <label><input aria-label={`${feature.moduleLabel??feature.module} · ${feature.name}: read`} type="checkbox" name={feature.canRead ? 'features' : undefined} value={feature.id} checked={readFeatures.includes(feature.id)} onChange={event => { toggleRead(feature.id, event.currentTarget.checked); validation.clear('features'); }} disabled={!feature.canRead || busy} {...(feature.canRead && !features.slice(0, features.indexOf(feature)).some(item => item.canRead) ? validation.fieldProps('features') : {})} /> Read</label>
          <label><input aria-label={`${feature.moduleLabel??feature.module} · ${feature.name}: write`} type="checkbox" checked={writeFeatures.includes(feature.id)} onChange={event => toggleWrite(feature.id, event.currentTarget.checked)} disabled={!feature.canWrite || busy} /> Write</label>
        </div>)}
        </fieldset>)}</div>
      </fieldset><FieldError {...validation.errorProps('features')} />
      <fieldset><legend>Allowed resources</legend>
        <label><input type="checkbox" checked={allResources} disabled={busy} onChange={event=>{setAllResources(event.target.checked);setConsent(false);}} /> All selected channels and ad accounts, including future additions</label>
        {!allResources && <><p className={styles['settings-note']}>Tick only the channels and ad accounts this key needs. Nothing selected grants no resource access. Workspace-wide tools need an all-resources key.</p>
          {resourcesTruncated ? <p role="alert">Resource selection is unavailable right now. Refresh to try again; your entered details are kept.</p> : ['channel','adAccount'].map(kind=><fieldset key={kind}><legend>{kind==='channel'?'Channels':'Ad accounts'}</legend>{resources.filter(r=>r.kind===kind).map(resource=><label key={resource.id} className={styles['mcp-key-resource']}><input type="checkbox" checked={selectedResources.includes(`${resource.kind}:${resource.id}`)} disabled={busy} onChange={event=>{setSelectedResources(current=>event.target.checked?[...current,`${resource.kind}:${resource.id}`]:current.filter(id=>id!==`${resource.kind}:${resource.id}`));setConsent(false);}} /> {resource.name}</label>)}</fieldset>)}
        </>}
      </fieldset>
      <label><input type="checkbox" name="permissionConsent" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)} /> I approve issuing a credential with these feature and resource permissions until it expires or I revoke it.</label>
      <Button type="submit" variant="primary" disabled={busy||!consent||(!allResources&&resourcesTruncated)}>{busy ? 'Creating…' : 'Create API key'}</Button>
    </form>
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
    {newToken && <div className={styles['mcp-key-token']}><label htmlFor="new-api-token">Copy this bearer token now</label><AutoTextarea id="new-api-token" readOnly value={tokenVisible ? newToken : '•'.repeat(Math.min(newToken.length, 48))} rows={1} autoComplete="off" aria-label={tokenVisible ? 'Bearer token' : 'Masked bearer token'} onFocus={event => { if (tokenVisible) event.currentTarget.select(); }} /><Button type="button" aria-pressed={tokenVisible} aria-controls="new-api-token" onClick={() => setTokenVisible(value => !value)}>{tokenVisible ? 'Hide token' : 'Show token'}</Button><Button type="button" onClick={() => void copyToken()}>Copy token</Button><span id="new-api-token-copy-status" role="status">{copyNotice}</span></div>}
    {pendingRevoke && <div role="group" aria-label="Confirm key revocation"><p>Revoking this key immediately stops its clients from accessing this workspace. This cannot be undone.</p><Button type="button" disabled={busy} variant="danger" onClick={()=>void revoke(pendingRevoke)}>Confirm revoke</Button><Button type="button" disabled={busy} onClick={()=>setPendingRevoke(null)}>Cancel</Button></div>}
    <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>Name</th><th>Scopes</th><th>Expires</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>
      {keys.map(key => { const inactive = Boolean(key.revokedAt) || new Date(key.expiresAt).getTime() <= Date.now(); return <tr key={key.id}>
        <td><span className={styles['settings-table__primary']}>{key.name}</span><span className={styles['settings-table__secondary']}>{key.tokenPrefix}… · created {new Date(key.createdAt).toLocaleDateString()}</span></td>
        <td><span className={styles['settings-table__secondary']}>{!key.resourceScope?'Legacy · current account resources':key.resourceScope.mode==='all'?'All current and future selected resources':`${key.resourceScope.ids?.length??0} channels · ${key.resourceScope.adAccountIds?.length??0} ad accounts`}</span>{key.readFeatures.map(id => `${key.writeFeatures.includes(id) ? 'write' : 'read'} ${features.find(feature => feature.id === id)?.name ?? id}`).join(', ')}</td>
        <td>{new Date(key.expiresAt).toLocaleDateString()}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}</td>
        <td>{key.revokedAt ? 'Revoked' : inactive ? 'Expired' : 'Active'}</td><td>{!inactive && <Button type="button" variant="danger" aria-label={`Revoke ${key.name}`} onClick={() => setPendingRevoke(key.id)} disabled={busy}>Revoke</Button>}</td>
      </tr>; })}
      {!keys.length && <tr><td colSpan={6}>No MCP API keys have been issued.</td></tr>}
    </tbody></table></div>
  </>;
}
