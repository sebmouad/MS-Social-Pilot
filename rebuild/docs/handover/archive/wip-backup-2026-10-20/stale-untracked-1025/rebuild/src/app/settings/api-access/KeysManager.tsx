'use client';

import { useState } from 'react';
import ui from '@/modules/integrations/ui/integrations.module.css';
import { SecretReveal } from '@/modules/integrations/ui/SecretReveal';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { createKeyAction, revokeKeyAction } from './actions';

type Key = { id: string; name: string; prefix: string; scope: 'read' | 'write'; targetNames: string[] | null; createdBy: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; status: 'active' | 'expired' | 'revoked' };
type Channel = { id: string; name: string };

export function KeysManager({ initial, channels, defaultDays, maxDays, canChooseAll }: { initial: Key[]; channels: Channel[]; defaultDays: number; maxDays: number; canChooseAll: boolean }) {
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState(''); const [scope, setScope] = useState<'read' | 'write'>('read'); const [days, setDays] = useState(defaultDays);
  const [limited, setLimited] = useState(!canChooseAll); const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [secret, setSecret] = useState<{ value: string; notice: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const validation = useFormValidation();

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: 'Enter a name for this key.' } : {}), ...(!Number.isInteger(days) || days < 1 || days > maxDays ? { days: `Choose 1 to ${maxDays} days.` } : {}), ...(limited && !chosen.length ? { channels: 'Choose at least one channel.' } : {}) })) return;
    setBusy(true); setNotice(null);
    const result = await createKeyAction({ name: name.trim(), scope, expiresInDays: days, ...(limited ? { targetIds: chosen } : {}), confirmation: `CREATE API KEY ${name.trim()}` });
    setBusy(false);
    if (!result.ok) { setNotice({ tone: 'error', text: result.error }); return; }
    setSecret({ value: result.token, notice: result.notice });
    setKeys(current => [{ id: result.id, name: name.trim(), prefix: result.prefix, scope, targetNames: limited ? channels.filter(c => chosen.includes(c.id)).map(c => c.name) : null, createdBy: 'You', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(), lastUsedAt: null, status: 'active' }, ...current]);
    setName(''); setChosen([]); setNotice({ tone: 'ok', text: 'Key created.' });
  }
  async function revoke(key: Key) {
    if (confirming !== key.id) { setConfirming(key.id); return; }
    setBusy(true); setNotice(null);
    const result = await revokeKeyAction({ id: key.id, confirmation: `REVOKE API KEY ${key.id}` });
    setBusy(false); setConfirming(null);
    if (!result.ok) { setNotice({ tone: 'error', text: result.error }); return; }
    setKeys(current => current.map(k => k.id === key.id ? { ...k, status: 'revoked' } : k));
    setNotice({ tone: 'ok', text: result.webhooksDisabled ? `Key revoked. ${result.webhooksDisabled} webhook${result.webhooksDisabled === 1 ? '' : 's'} it created ${result.webhooksDisabled === 1 ? 'was' : 'were'} paused.` : 'Key revoked.' });
  }
  return <>
    <form method="post" noValidate className={ui.form} onSubmit={create}>
      <div className={ui.fields}>
        <label className={ui.field}>Key name<input name="name" required maxLength={60} value={name} disabled={busy} onChange={e => { setName(e.currentTarget.value); validation.clear('name'); }} placeholder="Reporting script" {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label className={ui.field}>Lifetime in days<input name="days" type="number" min={1} max={maxDays} value={days} disabled={busy} onChange={e => { setDays(Number(e.currentTarget.value)); validation.clear('days'); }} {...validation.fieldProps('days')} /><FieldError {...validation.errorProps('days')} /></label>
        <label className={ui.field}>Access<select name="scope" value={scope} disabled={busy} onChange={e => setScope(e.currentTarget.value as 'read' | 'write')}><option value="read">Read only</option><option value="write">Read and change</option></select></label>
      </div>
      <fieldset className={ui.group}><legend>Channels</legend>
        {canChooseAll && <label className={ui.check}><input type="checkbox" checked={!limited} disabled={busy} onChange={e => { setLimited(!e.currentTarget.checked); validation.clear('channels'); }} />Everything you can access, now and later</label>}
        {limited && (channels.length ? channels.map((channel, index) => <label key={channel.id} className={ui.check}><input type="checkbox" name="channels" value={channel.id} checked={chosen.includes(channel.id)} disabled={busy} onChange={e => { setChosen(c => e.currentTarget.checked ? [...c, channel.id] : c.filter(x => x !== channel.id)); validation.clear('channels'); }} {...(index === 0 ? validation.fieldProps('channels') : {})} />{channel.name}</label>) : <p className={ui.notice}>No channels are available yet.</p>)}
      </fieldset><FieldError {...validation.errorProps('channels')} />
      <p className={ui.notice}>A key can never do more than you can: if your role or channel access shrinks, so does the key.</p>
      <div className={ui['row-actions']}><button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create key'}</button></div>
    </form>
    {secret && <SecretReveal label="API key" value={secret.value} notice={secret.notice} onDone={() => setSecret(null)} />}
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? ui.error : ui.notice}>{notice.text}</p>}
    <div className={ui['tbl-scroll']}><table style={{ width: '100%' }}><thead><tr><th>Key</th><th>Access</th><th>Expires</th><th>Last used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {keys.map(key => <tr key={key.id}>
        <td><strong>{key.name}</strong><br /><small>{key.prefix}... · {key.createdBy} · {new Date(key.createdAt).toLocaleDateString()}</small></td>
        <td>{key.scope === 'write' ? 'Read and change' : 'Read only'}<br /><small>{key.targetNames ? key.targetNames.join(', ') : 'All your channels'}</small></td>
        <td>{key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}</td>
        <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}</td>
        <td>{key.status === 'active' ? 'Active' : key.status === 'expired' ? 'Expired' : 'Revoked'}</td>
        <td>{key.status === 'active' && <div className={ui['row-actions']}><button type="button" disabled={busy} onClick={() => void revoke(key)}>{confirming === key.id ? 'Confirm: revoke' : 'Revoke'}</button>{confirming === key.id && <button type="button" onClick={() => setConfirming(null)}>Cancel</button>}</div>}</td>
      </tr>)}
      {!keys.length && <tr><td colSpan={6}>No API keys yet.</td></tr>}
    </tbody></table></div>
  </>;
}
