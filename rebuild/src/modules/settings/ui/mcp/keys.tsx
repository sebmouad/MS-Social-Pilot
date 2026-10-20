'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { AutoTextarea } from '@/components/AutoTextarea';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '@/modules/settings/ui/settings.module.css';
import { fill } from '@/modules/settings/ui/shell-copy';
import { mcpCopy } from './copy';

type Feature = { id: string; name: string; module: string; moduleLabel?:string; canRead: boolean; canWrite: boolean };
type ApiKey = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; resourceScope?: {mode:string;ids?:string[];adAccountIds?:string[]}|null; expiresAt: string; revokedAt: string | null; createdAt: string; lastUsedAt: string | null };

export function McpKeyManager({ features, initialKeys, maxLifetimeDays, defaultLifetimeDays, resources, resourcesTruncated, locale = 'en' }: { features: Feature[]; initialKeys: ApiKey[]; maxLifetimeDays: number; defaultLifetimeDays:number; resources:Array<{id:string;name:string;kind:'channel'|'adAccount'}>; resourcesTruncated:boolean; locale?: 'en' | 'fr' }) {
  const t = mcpCopy[locale];
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
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: t.nameRequired } : {}), ...(!readFeatures.length ? { features: t.featureRequired } : {}) })) return;
    if(!consent||(!allResources&&resourcesTruncated))return;
    inFlight.current=true;setBusy(true); setNotice(''); setNewToken(''); setTokenVisible(false); setCopyNotice('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, readFeatures, writeFeatures, expiresInDays, resourceScope:allResources?{version:1,mode:'all'}:{version:1,mode:'selected',ids:resources.filter(r=>r.kind==='channel'&&selectedResources.includes(`${r.kind}:${r.id}`)).map(r=>r.id),adAccountIds:resources.filter(r=>r.kind==='adAccount'&&selectedResources.includes(`${r.kind}:${r.id}`)).map(r=>r.id)},confirmation:`CREATE MCP KEY ${name.trim()}` }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.createFailed);
      setNewToken(result.token);
      setKeys(current => [{ ...result.key, revokedAt: null, createdAt: new Date().toISOString(), lastUsedAt: null }, ...current]);
      setName(''); setReadFeatures([]); setWriteFeatures([]);setConsent(false);setSelectedResources([]);setAllResources(false);
      setNotice(t.created);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.createFailed); }
    finally { inFlight.current=false;setBusy(false); }
  }
  async function revoke(id: string) {
    if(inFlight.current)return;inFlight.current=true;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id,confirmation:`REVOKE MCP KEY ${id}` }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.revokeFailed);
      setKeys(current => current.map(key => key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key));
      setNotice(t.revoked);setPendingRevoke(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : t.revokeFailed); }
    finally { inFlight.current=false;setBusy(false); }
  }
  async function copyToken() {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopyNotice(t.copied);
    } catch {
      setCopyNotice(t.copyFailed);
    }
  }
  return <>
    <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={createKey}>
      <div className={styles['mcp-key-fields']}>
        <label>{t.keyName}<input name="name" required maxLength={100} value={name} onChange={event => { setName(event.currentTarget.value); setConsent(false); validation.clear('name'); }} autoComplete="off" placeholder={t.namePlaceholder} disabled={busy} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label>{t.lifetime}<input name="expiresInDays" type="number" min={1} max={maxLifetimeDays} value={expiresInDays} onChange={event => { setExpiresInDays(Number(event.currentTarget.value));setConsent(false); validation.clear('expiresInDays'); }} disabled={busy} {...validation.fieldProps('expiresInDays')} /><FieldError {...validation.errorProps('expiresInDays')} /></label>
      </div>
      <fieldset aria-invalid={validation.errors.features ? true : undefined}><legend>{t.allowedFeatures}</legend>
        <div className={styles['mcp-key-feature-grid']}>{[...new Set(features.map(feature=>feature.module))].map(module=><fieldset className={styles['mcp-key-feature-group']} key={module}><legend>{features.find(feature=>feature.module===module)?.moduleLabel??module}</legend>
        {features.filter(feature=>feature.module===module).map(feature => <div key={feature.id} className={styles['mcp-key-feature']}>
          <span>{feature.name} </span>
          <label><input aria-label={fill(t.readLabel, { module: feature.moduleLabel??feature.module, name: feature.name })} type="checkbox" name={feature.canRead ? 'features' : undefined} value={feature.id} checked={readFeatures.includes(feature.id)} onChange={event => { toggleRead(feature.id, event.currentTarget.checked); validation.clear('features'); }} disabled={!feature.canRead || busy} {...(feature.canRead && !features.slice(0, features.indexOf(feature)).some(item => item.canRead) ? validation.fieldProps('features') : {})} /> {t.read}</label>
          <label><input aria-label={fill(t.writeLabel, { module: feature.moduleLabel??feature.module, name: feature.name })} type="checkbox" checked={writeFeatures.includes(feature.id)} onChange={event => toggleWrite(feature.id, event.currentTarget.checked)} disabled={!feature.canWrite || busy} /> {t.write}</label>
        </div>)}
        </fieldset>)}</div>
      </fieldset><FieldError {...validation.errorProps('features')} />
      <fieldset><legend>{t.allowedResources}</legend>
        <label><input type="checkbox" checked={allResources} disabled={busy} onChange={event=>{setAllResources(event.target.checked);setConsent(false);}} /> {t.allResources}</label>
        {!allResources && <><p className={styles['settings-note']}>{t.resourceHint}</p>
          {resourcesTruncated ? <p role="alert">{t.resourcesUnavailable}</p> : ['channel','adAccount'].map(kind=><fieldset key={kind}><legend>{kind==='channel'?t.channels:t.adAccounts}</legend>{resources.filter(r=>r.kind===kind).map(resource=><label key={resource.id} className={styles['mcp-key-resource']}><input type="checkbox" checked={selectedResources.includes(`${resource.kind}:${resource.id}`)} disabled={busy} onChange={event=>{setSelectedResources(current=>event.target.checked?[...current,`${resource.kind}:${resource.id}`]:current.filter(id=>id!==`${resource.kind}:${resource.id}`));setConsent(false);}} /> {resource.name}</label>)}</fieldset>)}
        </>}
      </fieldset>
      <label><input type="checkbox" name="permissionConsent" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)} /> {t.consent}</label>
      <Button type="submit" variant="primary" disabled={busy||!consent||(!allResources&&resourcesTruncated)}>{busy ? t.creating : t.createKey}</Button>
    </form>
    {notice && <p role="status" className={styles['settings-note']}>{notice}</p>}
    {newToken && <div className={styles['mcp-key-token']}><label htmlFor="new-api-token">{t.copyNow}</label><AutoTextarea id="new-api-token" readOnly value={tokenVisible ? newToken : '•'.repeat(Math.min(newToken.length, 48))} rows={1} autoComplete="off" aria-label={tokenVisible ? t.bearer : t.maskedBearer} onFocus={event => { if (tokenVisible) event.currentTarget.select(); }} /><Button type="button" aria-pressed={tokenVisible} aria-controls="new-api-token" onClick={() => setTokenVisible(value => !value)}>{tokenVisible ? t.hideToken : t.showToken}</Button><Button type="button" onClick={() => void copyToken()}>{t.copyToken}</Button><span id="new-api-token-copy-status" role="status">{copyNotice}</span></div>}
    {pendingRevoke && <div role="group" aria-label={t.confirmRevoke}><p>{t.revokeWarning}</p><Button type="button" disabled={busy} variant="danger" onClick={()=>void revoke(pendingRevoke)}>{t.confirmRevokeButton}</Button><Button type="button" disabled={busy} onClick={()=>setPendingRevoke(null)}>{t.cancel}</Button></div>}
    <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>{t.name}</th><th>{t.scopes}</th><th>{t.expires}</th><th>{t.lastUsed}</th><th>{t.status}</th><th /></tr></thead><tbody>
      {keys.map(key => { const inactive = Boolean(key.revokedAt) || new Date(key.expiresAt).getTime() <= Date.now(); return <tr key={key.id}>
        <td><span className={styles['settings-table__primary']}>{key.name}</span><span className={styles['settings-table__secondary']}>{fill(t.createdOn, { prefix: key.tokenPrefix, date: new Date(key.createdAt).toLocaleDateString(locale) })}</span></td>
        <td><span className={styles['settings-table__secondary']}>{!key.resourceScope?t.legacyScope:key.resourceScope.mode==='all'?t.allScope:fill(t.countScope, { channels: key.resourceScope.ids?.length??0, adAccounts: key.resourceScope.adAccountIds?.length??0 })}</span>{key.readFeatures.map(id => fill(key.writeFeatures.includes(id) ? t.featureWrite : t.featureRead, { name: features.find(feature => feature.id === id)?.name ?? id })).join(', ')}</td>
        <td>{new Date(key.expiresAt).toLocaleDateString(locale)}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString(locale) : t.never}</td>
        <td>{key.revokedAt ? t.statusRevoked : inactive ? t.statusExpired : t.statusActive}</td><td>{!inactive && <Button type="button" variant="danger" aria-label={fill(t.revokeKey, { name: key.name })} onClick={() => setPendingRevoke(key.id)} disabled={busy}>{t.revoke}</Button>}</td>
      </tr>; })}
      {!keys.length && <tr><td colSpan={6}>{t.none}</td></tr>}
    </tbody></table></div>
  </>;
}
