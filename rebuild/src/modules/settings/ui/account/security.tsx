'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Switch, DataTable, ConfirmDialog, Field, TextInput, useToast } from '@/components';
import { useSettingsCopy } from '../copy-context';
import { SecretReveal } from '@/modules/integrations/ui/SecretReveal';
import { securityConfirmations } from '../../server/account-security-contract';
import styles from '../settings.module.css';
type Security = { twoStepEnabled: boolean; required: boolean; passkeys: { id: string; name: string; lastUsedAt: string | null; labels?: { lastUsedAt?: string } }[] };
export function AccountSecurity({ canWrite, accountName, locale, onChanged }: { canWrite: boolean; accountName: string; locale: 'en' | 'fr'; onChanged?: () => void }) {
  const t = useSettingsCopy('security', locale); const toast = useToast();
  const [data, setData] = useState<Security | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [setup, setSetup] = useState<string | null>(null); const [recovery, setRecovery] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: 'begin' | 'enable' | 'disable' | 'remove'; id?: string; name: string } | null>(null);
  const flight = useRef(false);
  async function read(signal?: AbortSignal) {
    const response = await fetch('/api/settings/account/security', { cache: 'no-store', signal });
    const result = await response.json(); if (!response.ok || !Array.isArray(result.passkeys) || typeof result.twoStepEnabled !== 'boolean') throw new Error();
    return result as Security;
  }
  async function reload() { try { setData(await read()); setError(''); } catch { setError(t.failed); } }
  useEffect(() => { const controller = new AbortController(); read(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); }).catch(() => { if (!controller.signal.aborted) setError(t.failed); }); return () => controller.abort(); }, [t]);
  const operation = useRef<Promise<string | null> | null>(null);
  function apply() {
    if (!operation.current) operation.current = applyOnce().finally(() => { operation.current = null; });
    return operation.current;
  }
  async function applyOnce() {
    if (!pending || flight.current) return t.failed;
    flight.current = true; setBusy(true);
    try {
      const { action, id } = pending;
      const confirmation = action === 'remove' ? securityConfirmations.remove(id!) : securityConfirmations[action];
      const response = await fetch(action === 'remove' ? '/api/settings/account/passkeys' : `/api/settings/account/security/${action === 'begin' ? 'setup' : action}`, { method: action === 'remove' ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: password, code, ...(id ? { id } : {}), confirmation }) });
      const result = await response.json(); if (!response.ok || result.ok !== true) throw new Error();
      if (action === 'begin') { if (typeof result.secret !== 'string') throw new Error(); setSetup(result.secret); }
      else {
        if (action === 'enable') { if (!Array.isArray(result.recoveryCodes)) throw new Error(); setRecovery(result.recoveryCodes.join('\n')); setSetup(null); }
        setPassword(''); setCode(''); await reload(); onChanged?.();
      }
      toast.notify({ title: t.saved }); return null;
    } catch { setError(t.failed); return t.failed; }
    finally { flight.current = false; setBusy(false); }
  }
  const revealStrings = { secretHidden: '••••••••', show: t.show, hide: t.hide, copy: t.copy, copied: t.copied, copyFailed: t.failed, savedIt: t.done };
  const title = pending?.action === 'remove' ? t.remove : pending?.action === 'disable' ? t.disable : pending?.action === 'enable' ? t.enable : t.setup;
  return <section className={styles['settings-panel']}><h2>{t.title}</h2><p>{t.detail}</p>
    {!data && !error && <p role="status">{t.loading}</p>}
    {error && <p role="alert">{error}<Button onClick={() => void reload()}>{t.retry}</Button></p>}
    {data && <>
      {data.required && <p>{t.required}</p>}
      {canWrite && <div className={styles['security-form']}>
        <Field label={t.password}><TextInput type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></Field>
        <Field label={t.code}><TextInput autoComplete="one-time-code" inputMode="numeric" value={code} disabled={busy} onChange={e => setCode(e.target.value)} /></Field>
        <Switch label={t.authenticator} checked={data.twoStepEnabled} disabled={busy || !password || (data.twoStepEnabled && (!code || (data.required && data.passkeys.length === 0)))} onChange={() => setPending({ action: data.twoStepEnabled ? 'disable' : 'begin', name: accountName })} />
      </div>}
      {setup && <><SecretReveal key={setup} label={t.secret} value={setup} notice={t.setupNote} onDone={() => setSetup(null)} strings={revealStrings} /><Button disabled={busy || !password || !code} onClick={() => setPending({ action: 'enable', name: accountName })}>{t.enable}</Button></>}
      {recovery && <SecretReveal key={recovery} label={t.recovery} value={recovery} notice={t.recoveryNote} onDone={() => setRecovery(null)} strings={revealStrings} />}
      <DataTable caption={t.passkeys} rows={data.passkeys} rowKey={row => row.id} emptyMessage={t.empty} columns={[
        { key: 'name', label: t.name, render: row => row.name },
        { key: 'lastUsed', label: t.lastUsed, render: row => row.lastUsedAt ? row.labels?.lastUsedAt ?? '' : t.never },
        { key: 'remove', label: t.remove, render: row => canWrite && <Button disabled={busy || !password || (data.required && !data.twoStepEnabled && data.passkeys.length <= 1)} onClick={() => setPending({ action: 'remove', id: row.id, name: row.name })}>{t.remove}</Button> },
      ]} />
    </>}
    {pending && <ConfirmDialog key={`${pending.action}:${pending.id ?? ''}`} open title={title} objectName={pending.name} consequence={pending.action === 'remove' ? t.removeNote : t.confirm} confirmLabel={title} cancelLabel={t.cancel} failureLabel={t.failed} danger={pending.action === 'disable' || pending.action === 'remove'} onClose={() => setPending(null)} onConfirm={apply} />}
  </section>;
}
