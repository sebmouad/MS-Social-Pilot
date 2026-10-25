'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { useRef, useState } from 'react';
import { DataTable, Badge, ConfirmDialog, useToast } from '@/components';
import { IconKey } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { AutoTextarea } from '@/components/AutoTextarea';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '@/modules/settings/ui/settings.module.css';
import { fill } from '@/modules/settings/ui/shell-copy';


type Feature = { id: string; name: string; module: string; moduleLabel?:string; canRead: boolean; canWrite: boolean };
type ApiKey = { id: string; name: string; tokenPrefix: string; readFeatures: string[]; writeFeatures: string[]; resourceScope?: {mode:string;ids?:string[];adAccountIds?:string[]}|null; expiresAt: string; revokedAt: string | null; createdAt: string; lastUsedAt: string | null; labels?: { createdAt?: string; expiresAt?: string; lastUsedAt?: string } };

export function McpKeyManager({ features, initialKeys, maxLifetimeDays, defaultLifetimeDays, resources, resourcesTruncated, locale = 'en' }: { features: Feature[]; initialKeys: ApiKey[]; maxLifetimeDays: number; defaultLifetimeDays:number; resources:Array<{id:string;name:string;kind:'channel'|'adAccount'}>; resourcesTruncated:boolean; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const t = useSettingsCopy('mcp', locale);
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
  const readable = features.filter(feature => feature.canRead).map(feature => feature.id);
  const writable = features.filter(feature => feature.canWrite).map(feature => feature.id);
  // Role presets read everything and write only their module, so a key holds no more than its job needs.
  const applyPreset = (kind: 'read' | 'readWrite' | 'publisher' | 'ads' | 'none') => {
    setConsent(false); validation.clear('features');
    setReadFeatures(kind === 'none' ? [] : readable);
    const module = kind === 'publisher' ? 'publishing' : kind === 'ads' ? 'ads' : null;
    setWriteFeatures(kind === 'readWrite' ? writable : module ? writable.filter(id => features.find(feature => feature.id === id)?.module === module) : []);
  };
  const toggleModule = (module: string, on: boolean) => {
    setConsent(false); validation.clear('features');
    const inModule = features.filter(feature => feature.module === module);
    setReadFeatures(current => on ? [...new Set([...current, ...inModule.filter(f => f.canRead).map(f => f.id)])] : current.filter(id => !inModule.some(f => f.id === id)));
    if (!on) setWriteFeatures(current => current.filter(id => !inModule.some(f => f.id === id)));
  };
  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(inFlight.current)return;
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: t.nameRequired } : {}), ...(!readFeatures.length ? { features: t.featureRequired } : {}), ...(!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > maxLifetimeDays ? { expiresInDays: fill(t.lifetimeRange, { max: maxLifetimeDays }) } : {}) })) return;
    if(!consent||(!allResources&&resourcesTruncated))return;
    inFlight.current=true;setBusy(true); setNotice(''); setNewToken(''); setTokenVisible(false); setCopyNotice('');
    try {
      const response = await fetch('/api/settings/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, readFeatures, writeFeatures, expiresInDays, resourceScope:allResources?{version:1,mode:'all'}:{version:1,mode:'selected',ids:resources.filter(r=>r.kind==='channel'&&selectedResources.includes(`${r.kind}:${r.id}`)).map(r=>r.id),adAccountIds:resources.filter(r=>r.kind==='adAccount'&&selectedResources.includes(`${r.kind}:${r.id}`)).map(r=>r.id)},confirmation:`CREATE MCP KEY ${name.trim()}` }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? t.createFailed);
      setNewToken(result.token);
      setKeys(current => [{ ...result.key, revokedAt: null, createdAt: new Date().toISOString(), lastUsedAt: null }, ...current]);
      setName(''); setReadFeatures([]); setWriteFeatures([]);setConsent(false);setSelectedResources([]);setAllResources(false);
      setNotice(t.created); toast.notify({ title: t.created });
    } catch (error) { const message = error instanceof Error ? error.message : t.createFailed; setNotice(message); toast.failed(message, () => document.querySelector<HTMLInputElement>('[name="name"]')?.focus(), t.createKey); }
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
      setNotice(t.revoked);setPendingRevoke(null); toast.notify({ title: t.revoked }); return null;
    } catch (error) { const message = error instanceof Error ? error.message : t.revokeFailed; setNotice(message); toast.failed(message, () => setPendingRevoke(id), t.revoke); return message; }
    finally { inFlight.current=false;setBusy(false); }
  }
  async function copyToken() {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopyNotice(t.copied); toast.notify({ title: t.copied });
    } catch {
      setCopyNotice(t.copyFailed); toast.failed(t.copyFailed, () => void copyToken(), t.copyToken);
    }
  }
  return <>
    <form method="post" noValidate className={styles['mcp-key-form']} onSubmit={createKey}>
      <div className={styles['mcp-key-fields']}>
        <label>{t.keyName}<input name="name" required maxLength={100} value={name} onChange={event => { setName(event.currentTarget.value); setConsent(false); validation.clear('name'); }} autoComplete="off" placeholder={t.namePlaceholder} disabled={busy} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label>{t.lifetime}<input name="expiresInDays" type="number" min={1} max={maxLifetimeDays} value={expiresInDays} onChange={event => { setExpiresInDays(Number(event.currentTarget.value));setConsent(false); validation.clear('expiresInDays'); }} disabled={busy} {...validation.fieldProps('expiresInDays')} /><small className={styles['mcp-key-hint']}>{fill(t.lifetimeHint, { max: maxLifetimeDays })}</small><FieldError {...validation.errorProps('expiresInDays')} /></label>
      </div>
      <fieldset aria-invalid={validation.errors.features ? true : undefined}><legend>{t.allowedFeatures}</legend>
        <div className={styles['mcp-key-presets']} role="group" aria-label={t.presets}>
          <Button type="button" disabled={busy} onClick={() => applyPreset('read')}>{t.presetRead}</Button>
          <Button type="button" disabled={busy} onClick={() => applyPreset('publisher')}>{t.presetPublisher}</Button>
          <Button type="button" disabled={busy} onClick={() => applyPreset('ads')}>{t.presetAds}</Button>
          <Button type="button" disabled={busy} onClick={() => applyPreset('readWrite')}>{t.presetReadWrite}</Button>
          <Button type="button" disabled={busy || !readFeatures.length} onClick={() => applyPreset('none')}>{t.presetClear}</Button>
          <span className={styles['mcp-key-summary']} role="status">{fill(t.summary, { read: readFeatures.length, write: writeFeatures.length })}</span>
        </div>
        <div className={styles['mcp-key-feature-grid']}>{[...new Set(features.map(feature=>feature.module))].map(module=><fieldset className={styles['mcp-key-feature-group']} key={module}><legend>{features.find(feature=>feature.module===module)?.moduleLabel??module}</legend>
        <label className={styles['mcp-key-module-all']}><input type="checkbox" aria-label={fill(t.moduleAllLabel, { module: features.find(feature=>feature.module===module)?.moduleLabel??module })} checked={features.some(f=>f.module===module&&f.canRead)&&features.filter(f=>f.module===module&&f.canRead).every(f=>readFeatures.includes(f.id))} disabled={busy} onChange={event=>toggleModule(module,event.currentTarget.checked)} /> {t.moduleAll}</label>
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
    {pendingRevoke && <ConfirmDialog open title={t.confirmRevoke} objectName={keys.find(key => key.id === pendingRevoke)?.name ?? pendingRevoke} consequence={t.revokeWarning} confirmLabel={t.confirmRevokeButton} cancelLabel={t.cancel} failureLabel={t.revokeFailed} onClose={() => setPendingRevoke(null)} onConfirm={async () => (await revoke(pendingRevoke)) ?? null} />}
    <DataTable caption={t.allowedFeatures} rows={keys} rowKey={key => key.id} emptyMessage={t.none} emptyIcon={<IconKey />} emptyAction={<Button onClick={() => document.querySelector<HTMLInputElement>('[name="name"]')?.focus()}>{t.createKey}</Button>} columns={[
      { key: 'name', label: t.name, render: key => <><strong>{key.name}</strong><span className={styles['settings-table__secondary']}>{fill(t.createdOn, { prefix: key.tokenPrefix, date: key.labels?.createdAt ?? '' })}</span></> },
      { key: 'scopes', label: t.scopes, render: key => <><span className={styles['settings-table__secondary']}>{!key.resourceScope ? t.legacyScope : key.resourceScope.mode === 'all' ? t.allScope : fill(t.countScope, { channels: key.resourceScope.ids?.length ?? 0, adAccounts: key.resourceScope.adAccountIds?.length ?? 0 })}</span>{key.readFeatures.map(id => fill(key.writeFeatures.includes(id) ? t.featureWrite : t.featureRead, { name: features.find(feature => feature.id === id)?.name ?? id })).join(', ')}</> },
      { key: 'expires', label: t.expires, render: key => key.labels?.expiresAt ?? '' },
      { key: 'used', label: t.lastUsed, render: key => key.lastUsedAt ? key.labels?.lastUsedAt ?? '' : t.never },
      { key: 'status', label: t.status, render: key => <Badge tone={key.revokedAt || Date.parse(key.expiresAt) <= Date.now() ? 'neutral' : 'success'}>{key.revokedAt ? t.statusRevoked : Date.parse(key.expiresAt) <= Date.now() ? t.statusExpired : t.statusActive}</Badge> },
      { key: 'actions', label: t.revoke, render: key => !key.revokedAt && Date.parse(key.expiresAt) > Date.now() && <Button variant="danger" disabled={busy} aria-label={fill(t.revokeKey, { name: key.name })} onClick={() => setPendingRevoke(key.id)}>{t.revoke}</Button> },
    ]} />
  </>;
}
