'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBrandSlack, IconBrandTelegram, IconBell, IconSend } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { useConfirm } from '@/components/useConfirm';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { CHAT_EVENTS, chatConfirmation, type ChatViewRow } from '../contracts';
import type { ChatCopy, CHAT_POLICY } from '../config';
import styles from './chat-channels.module.css';

export function ChatChannels({ initial, policy, copy, locale }: { initial: ChatViewRow[]; policy: { [K in keyof typeof CHAT_POLICY]: typeof CHAT_POLICY[K] extends number ? number : string }; copy: ChatCopy; locale: 'en' | 'fr'; timeZone?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState('slack');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  const validation = useFormValidation();
  const message = useRef<HTMLParagraphElement>(null);
  const [confirm, dialog] = useConfirm({ title: copy.confirmTitle, cancel: copy.cancel, confirm: copy.confirm, danger: false });
  async function mutate(method: string, path: string, body: Record<string, unknown>, expected: string, id?: string) {
    if (lock.current) return false;
    const accepted = await confirm(copy.consequence, { exactConfirmation: expected, confirmationLabel: copy.confirmation, pendingLabel: copy.pending, failureLabel: copy.error, onConfirm: async () => {
      if (lock.current) return copy.pending;
      lock.current = true; setBusy(true); setFeedback('');
      try {
        const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, confirmation: expected }) });
        const result: unknown = await response.json();
        if (!response.ok || !result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || id && result.id !== id) return copy.error;
        if ('outcome' in result) {
          if (!['accepted', 'rejected', 'uncertain'].includes(String(result.outcome))) return copy.error;
          setFeedback(result.outcome === 'accepted' ? copy.sent : result.outcome === 'rejected' ? copy.rejected : copy.uncertain);
        } else {
          if (method === 'DELETE' ? !('deleted' in result && result.deleted === true) : !('saved' in result && result.saved === true)) return copy.error;
          setFeedback(method === 'DELETE' ? copy.deleted : copy.saved);
        }
        // Receipt already confirmed; a refresh failure must not invite resubmission.
        try { router.refresh(); } catch { /* preserve receipt */ }
        return null;
      } catch { return copy.error; }
      finally { lock.current = false; setBusy(false); }
    } });
    if (accepted) queueMicrotask(() => message.current?.focus());
    return accepted;
  }
  return <div className={styles.layout} aria-busy={busy}>
    <p ref={message} tabIndex={-1} role="status" aria-live="polite" className={feedback ? styles.feedback : 'ui-visually-hidden'}>{feedback}</p>
    <DataTable rows={initial} rowKey={row => row.id} caption={copy.title} emptyMessage={copy.empty} zebra={false} columns={[
      { key: 'name', label: copy.name, render: row => <span className={styles.identity}>{row.kind === 'slack' ? <IconBrandSlack size={24} aria-hidden="true" /> : <IconBrandTelegram size={24} aria-hidden="true" />}<span><strong>{row.name}</strong><span className={styles.muted}>{row.enabled ? copy.active : copy.paused}{row.hasError ? ` · ${copy.failed}` : ''}</span></span></span> },
      { key: 'events', label: copy.events, render: row => <details><summary>{row.events.map(event => CHAT_EVENTS.includes(event as typeof CHAT_EVENTS[number]) ? copy[event as typeof CHAT_EVENTS[number]] : event).join(' · ')}</summary><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate('PATCH', `/api/chat-channels/${encodeURIComponent(row.id)}`, { events: data.getAll('events') }, chatConfirmation.update(row.id), row.id); }}><fieldset disabled={busy}>{CHAT_EVENTS.map(event => <label key={event} className={styles.choice}><input type="checkbox" name="events" value={event} defaultChecked={row.events.includes(event)} />{copy[event]}</label>)}</fieldset><Button disabled={busy} type="submit">{copy.updateEvents}</Button></form></details> },
      { key: 'lastSent', label: copy.lastSent, render: row => row.lastSentAt && row.lastSentLabel ? row.lastSentLabel : copy.never },
      { key: 'actions', label: copy.confirmTitle, render: row => <div className={styles.actions}>
        <Button disabled={busy} leading={<IconSend size={16} aria-hidden="true" />} onClick={() => void mutate('POST', `/api/chat-channels/${encodeURIComponent(row.id)}/test`, {}, chatConfirmation.test(row.id), row.id)}>{copy.test}</Button>
        <Button disabled={busy} onClick={() => void mutate('PATCH', `/api/chat-channels/${encodeURIComponent(row.id)}`, { enabled: !row.enabled }, chatConfirmation.update(row.id), row.id)}>{row.enabled ? copy.disable : copy.enable}</Button>
        <Button disabled={busy} variant="danger" onClick={() => void mutate('DELETE', `/api/chat-channels/${encodeURIComponent(row.id)}`, {}, chatConfirmation.delete(row.id), row.id)}>{copy.remove}</Button>
      </div> },
    ]} />
    <form lang={locale} noValidate className={styles.form} onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (!validation.validate(form, data.getAll('events').length ? {} : { events: copy.invalid })) return; const body = { kind, name: String(data.get('name') ?? '').trim(), events: data.getAll('events'), ...(kind === 'slack' ? { url: String(data.get('url') ?? '').trim() } : { botToken: String(data.get('botToken') ?? '').trim(), chatId: String(data.get('chatId') ?? '').trim() }) }; void mutate('POST', '/api/chat-channels', body, chatConfirmation.create(body.name)).then(saved => { if (saved) { form.reset(); setKind('slack'); validation.clearAll(); } }); }}>
      <h2 className={`${styles.heading} ${styles.full}`}><IconBell size={22} aria-hidden="true" />{copy.add}</h2>
      <label className="ui-field"><span>{copy.name}</span><input {...validation.fieldProps('name')} className="ui-input" name="name" maxLength={policy.maxNameCharacters} required disabled={busy} autoComplete="off" /><FieldError {...validation.errorProps('name')} /></label>
      <label className="ui-field"><span>{copy.kind}</span><select className="ui-input" name="kind" value={kind} disabled={busy} onChange={event => setKind(event.target.value)}><option value="slack">Slack</option><option value="telegram">Telegram</option></select></label>
      {kind === 'slack' ? <label className={`ui-field ${styles.full}`}><span>{copy.url}</span><input {...validation.fieldProps('url')} className="ui-input" name="url" type="password" required disabled={busy} spellCheck={false} autoComplete="off" /><FieldError {...validation.errorProps('url')} /></label> : <>
        <label className="ui-field"><span>{copy.botToken}</span><input {...validation.fieldProps('botToken')} className="ui-input" name="botToken" type="password" required disabled={busy} spellCheck={false} autoComplete="off" /><FieldError {...validation.errorProps('botToken')} /></label>
        <label className="ui-field"><span>{copy.chatId}</span><input {...validation.fieldProps('chatId')} className="ui-input" name="chatId" required disabled={busy} spellCheck={false} autoComplete="off" /><FieldError {...validation.errorProps('chatId')} /></label>
      </>}
      <fieldset className={`${styles.choices} ${styles.full}`} disabled={busy} aria-describedby={validation.errors.events ? validation.errorProps('events').id : undefined}><legend>{copy.events}</legend>{CHAT_EVENTS.map(event => <label key={event} className={styles.choice}><input type="checkbox" name="events" value={event} defaultChecked />{copy[event]}</label>)}<FieldError {...validation.errorProps('events')} /></fieldset>
      <div className={styles.full}><Button type="submit" variant="primary" disabled={busy}>{busy ? copy.pending : copy.save}</Button></div>
    </form>{dialog}
  </div>;
}
