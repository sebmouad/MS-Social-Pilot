'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import styles from '@/modules/settings/ui/settings.module.css';
import { personKeyCopy } from './copy';
import { personKeyCreateConfirmation, personKeyRevokeConfirmation, type PersonKeySummary } from './types';

const endpoint = '/api/settings/account/person-keys';
type Directory = { keys: PersonKeySummary[]; truncated: boolean; policy: { nameMaxLength: number; maxLifetimeDays: number } };
/** `initial` is the server-read directory; `null` means that read failed, so no failing request is made on mount. */
export function PersonKeysManager({ locale = 'en', initial }: { locale?: 'en' | 'fr'; initial?: Directory | null }) {
  const t = personKeyCopy[locale];
  const preloaded = initial !== undefined;
  const [directory, setDirectory] = useState<Directory | null>(initial ?? null);
  const [name, setName] = useState('');
  const [days, setDays] = useState(initial ? String(initial.policy.maxLifetimeDays) : '');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(initial === null ? t.failed : '');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const [confirm, dialog] = useConfirm({ title: t.title, cancel: t.cancel, confirm: t.confirm });
  const reload = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (alive.current && !signal?.aborted) { setDirectory(result); setDays(current => current || String(result.policy.maxLifetimeDays)); }
    } catch { if (alive.current && !signal?.aborted) setError(t.failed); }
  }, [t.failed]);
  useEffect(() => { alive.current = true; const controller = new AbortController(); if (!preloaded) void reload(controller.signal); return () => { alive.current = false; controller.abort(); }; }, [reload, preloaded]);
  async function change(method: 'POST' | 'DELETE', input: unknown) {
    try {
      const response = await fetch(endpoint, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!response.ok) return t.failed;
      const result = await response.json();
      if (alive.current) {
        if (method === 'POST') { setSecret(result.token); setNotice(t.created); } else setNotice(t.revoked);
        await reload();
      }
      return null;
    } catch { return t.failed; }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !directory) return;
    const trimmedName = name.trim(); const lifetime = Number(days);
    if (!trimmedName || trimmedName.length > directory.policy.nameMaxLength || !Number.isInteger(lifetime) || lifetime < 1 || lifetime > directory.policy.maxLifetimeDays) { setError(t.failed); return; }
    const confirmation = personKeyCreateConfirmation(trimmedName, lifetime);
    setBusy(true); setNotice('');
    try { await confirm(t.createNotice, { exactConfirmation: confirmation, confirmationLabel: t.exact, pendingLabel: t.pending, failureLabel: t.failed, onConfirm: () => change('POST', { name: trimmedName, expiresInDays: lifetime, confirmation }) }); }
    finally { if (alive.current) setBusy(false); }
  }
  async function revoke(key: PersonKeySummary) {
    if (busy) return; setBusy(true); setNotice('');
    const confirmation = personKeyRevokeConfirmation(key.id);
    try { await confirm(`${t.revokeNotice} ${key.name} (${key.tokenPrefix})`, { exactConfirmation: confirmation, confirmationLabel: t.exact, pendingLabel: t.pending, failureLabel: t.failed, onConfirm: () => change('DELETE', { id: key.id, confirmation }) }); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className={styles['settings-panel']}>
    <div className={styles['settings-panel__heading']}><div><h2>{t.title}</h2><p>{t.help}</p></div></div>
    {error && <p role="alert">{error} <Button disabled={busy} onClick={() => void reload()}>{t.retry}</Button></p>}
    {!directory && !error && <p role="status">{t.loading}</p>}
    {directory && <>
      <form className={styles['mcp-key-form']} onSubmit={create}>
        <label className="ui-field"><span>{t.name}</span><input className="ui-input" required maxLength={directory.policy.nameMaxLength} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label className="ui-field"><span>{t.days}</span><input className="ui-input" type="number" required min={1} max={directory.policy.maxLifetimeDays} value={days} disabled={busy} onChange={event => setDays(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !name.trim() || Boolean(secret)}>{t.create}</Button>
      </form>
      {secret && <div role="status"><p>{t.secret}</p><textarea className="ui-input" readOnly aria-label={t.secret} value={secret} /><Button onClick={() => setSecret('')}>{t.dismiss}</Button></div>}
      {directory.truncated && <p role="status">{t.truncated}</p>}
      <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th>{t.name}</th><th>{t.prefix}</th><th>{t.expires}</th><th /></tr></thead><tbody>
        {directory.keys.map(key => <tr key={key.id}><td>{key.name}</td><td>{key.tokenPrefix}</td><td>{key.expiresAt ? new Date(key.expiresAt).toLocaleString(locale) : t.unavailable}</td><td><Button disabled={busy} onClick={() => void revoke(key)} aria-label={`${t.revoke} ${key.name}`}>{t.revoke}</Button></td></tr>)}
        {!directory.keys.length && <tr><td colSpan={4}>{t.empty}</td></tr>}
      </tbody></table></div>
    </>}
    {notice && <p role="status">{notice}</p>}{dialog}
  </section>;
}
