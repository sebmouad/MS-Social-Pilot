'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import { saveGroupConfirmation, setLabelsConfirmation, deleteGroupConfirmation, type ProfileDirectory, type ChannelGroup } from '../../channel-profiles/contracts';
import { profileCopy, profileConfirmationCopy, type ProfileConfirmationCopy } from '../../channel-profiles/copy';
import styles from './profiles.module.css';
export function ProfilesManager({ initial, locale, canManage, confirmationCopy }: { initial: ProfileDirectory; locale: 'en' | 'fr'; canManage: boolean; confirmationCopy?: ProfileConfirmationCopy }) {
  const c = profileCopy[locale]; const confirmation = confirmationCopy ?? profileConfirmationCopy[locale]; const [data, setData] = useState(initial); const [editing, setEditing] = useState<ChannelGroup | null>(null);
  const [name, setName] = useState(''); const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(false); const feedback = useRef<HTMLParagraphElement>(null); const nameInput = useRef<HTMLInputElement>(null);
  const [confirm, dialog] = useConfirm({ title: c.confirm, cancel: c.cancel, confirm: c.remove });
  const [confirmSave, saveDialog] = useConfirm({ title: confirmation.title, cancel: confirmation.cancel, confirm: confirmation.confirm, danger: false });
  const reset = () => { setEditing(null); setName(''); setSelected([]); };
  async function change(input: unknown, done?: () => void) {
    if (lock.current) return; lock.current = true; setBusy(true); setMessage(''); setError(false);
    try {
      const response = await fetch('/settings/profiles/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const receipt = await response.json(); if (!response.ok || receipt.ok !== true) throw new Error();
      const refresh = await fetch('/settings/profiles/operations', { cache: 'no-store' }); if (!refresh.ok) throw new Error();
      const directory: ProfileDirectory = await refresh.json(); if (!Array.isArray(directory.channels) || !Array.isArray(directory.groups)) throw new Error();
      setData(directory); done?.(); setMessage(c.success);
    } catch { setError(true); setMessage(c.failure); }
    finally { lock.current = false; setBusy(false); requestAnimationFrame(() => feedback.current?.focus()); }
  }
  return <div className={styles.stack} aria-busy={busy}>{dialog}{saveDialog}
    <p id="profile-feedback" tabIndex={-1} ref={feedback} role={error ? 'alert' : 'status'}>{message}</p>
    {!data.channels.length && <p>{c.noChannels}</p>}
    {data.groups.length ? <ul className={styles.groups}>{data.groups.map(group => <li key={group.id}><strong>{group.name}</strong><p>{group.channelIds.map(id => data.channels.find(channel => channel.id === id)?.name ?? c.unavailable).join(', ')}</p>{canManage && <div className={styles.actions}><Button disabled={busy} onClick={() => { setEditing(group); setName(group.name); setSelected(group.channelIds); nameInput.current?.focus(); }}>{c.edit}</Button><Button disabled={busy} variant="danger" onClick={async () => { if (await confirm(c.consequence.replace('{name}', group.name))) await change({ action: 'deleteGroup', id: group.id, confirmation: deleteGroupConfirmation(group.id) }, () => { if (editing?.id === group.id) reset(); }); }}>{c.remove}</Button></div>}</li>)}</ul> : <p>{c.empty}</p>}
    {canManage && data.channels.length > 0 && <form noValidate className={styles.stack} onSubmit={async event => { event.preventDefault(); if (!name.trim() || !selected.length) { setError(true); setMessage(c.invalid); nameInput.current?.focus(); return; } if (await confirmSave(confirmation.saveGroup.replace('{name}', name.trim()).replace('{count}', String(selected.length)))) await change({ action: 'saveGroup', ...(editing ? { id: editing.id } : {}), name, channelIds: selected, confirmation: saveGroupConfirmation({ id: editing?.id, name }) }, reset); }}>
      <label className="ui-field">{c.name}<input className="ui-input" ref={nameInput} aria-invalid={message === c.invalid || undefined} aria-describedby={message === c.invalid ? 'profile-feedback' : undefined} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <fieldset disabled={busy}><legend>{c.channels}</legend>{data.channels.map(channel => <label className={styles.check} key={channel.id}><input type="checkbox" checked={selected.includes(channel.id)} onChange={event => setSelected(current => event.target.checked ? [...current, channel.id] : current.filter(id => id !== channel.id))} />{channel.name}</label>)}</fieldset>
      <div className={styles.actions}><Button type="submit" variant="primary" disabled={busy}>{editing ? c.save : c.create}</Button>{editing && <Button disabled={busy} onClick={reset}>{c.cancel}</Button>}</div>
    </form>}
    <h2>{c.labels}</h2><p id="profile-label-hint">{c.labelHint}</p>
    {data.channels.map(channel => <form className={styles.labelRow} key={`${channel.id}:${JSON.stringify(channel.labels)}`} noValidate onSubmit={async event => { event.preventDefault(); const labels = String(new FormData(event.currentTarget).get('labels') ?? '').split(',').map(label => label.trim()).filter(Boolean); if (await confirmSave(confirmation.setLabels.replace('{name}', channel.name))) await change({ action: 'setLabels', channelId: channel.id, labels, confirmation: setLabelsConfirmation(channel.id) }); }}>
      <label className="ui-field">{channel.name}<input className="ui-input" name="labels" aria-describedby="profile-label-hint" defaultValue={channel.labels.join(', ')} disabled={busy || !canManage} /></label>{canManage && <Button type="submit" disabled={busy}>{c.save}</Button>}
    </form>)}
  </div>;
}
