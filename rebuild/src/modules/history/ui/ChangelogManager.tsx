'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { Field, TextInput } from '@/components/Forms';
import { useConfirm } from '@/components/useConfirm';
import type { RootChangelogCopy } from '../root-copy';
import type { ChangelogEntry } from '../server/changelog';
import styles from './history.module.css';

type Props = { copy: RootChangelogCopy; locale: string; entries: ChangelogEntry[]; today: string };
const json = { 'content-type': 'application/json' };

/** Root writes the public changelog. Add is one click; remove asks first. Exact confirmations are sent for the person, as for other reversible Root bookkeeping. */
export function ChangelogManager({ copy, locale, entries, today }: Props) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [ask, dialog] = useConfirm({ title: copy.removeTitle, cancel: copy.cancel, confirm: copy.remove, danger: true });

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/root/changelog', { method: 'POST', headers: json, body: JSON.stringify({ publishedOn: date, title, body, confirmation: `ADD CHANGELOG ENTRY ${title.trim()}` }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || (payload as { ok?: unknown } | null)?.ok !== true) setMessage({ tone: 'error', text: copy.addFailure });
      else { setTitle(''); setBody(''); setMessage({ tone: 'ok', text: copy.added }); router.refresh(); }
    } catch { setMessage({ tone: 'error', text: copy.addFailure }); } finally { setBusy(false); }
  }

  async function remove(entry: ChangelogEntry) {
    if (!await ask(copy.removeBody)) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/root/changelog/${encodeURIComponent(entry.id)}`, { method: 'DELETE', headers: json, body: JSON.stringify({ confirmation: `REMOVE CHANGELOG ENTRY ${entry.id}` }) });
      if (!response.ok) setMessage({ tone: 'error', text: copy.removeFailure }); else router.refresh();
    } catch { setMessage({ tone: 'error', text: copy.removeFailure }); }
  }

  const format = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  return <>
    <form className={styles.toolbar} onSubmit={add} aria-label={copy.formTitle}>
      <Field label={copy.dateLabel} required className={styles.field}><TextInput type="date" value={date} onChange={event => setDate(event.target.value)} required /></Field>
      <Field label={copy.titleLabel} required className={styles.field}><TextInput value={title} onChange={event => setTitle(event.target.value)} required /></Field>
      <Field label={copy.bodyLabel} hint={copy.bodyHint} className={styles.field}><TextInput value={body} onChange={event => setBody(event.target.value)} /></Field>
      <div className={styles.actions}><Button type="submit" variant="primary" busy={busy}>{busy ? copy.adding : copy.add}</Button></div>
    </form>
    {message && <p className={styles.notice} role={message.tone === 'error' ? 'alert' : 'status'} data-tone={message.tone === 'error' ? 'warning' : undefined}>{message.text}</p>}
    <DataTable caption={copy.listCaption} rows={entries} rowKey={entry => entry.id} emptyMessage={copy.empty}
      columns={[
        { key: 'date', label: copy.publishedOn, width: '200px', render: entry => <time dateTime={entry.publishedOn}>{format(entry.publishedOn)}</time> },
        { key: 'entry', label: copy.entry, render: entry => <span className={styles.what}><strong>{entry.title}</strong>{entry.body && <span className={styles.code}>{entry.body}</span>}</span> },
        { key: 'actions', label: copy.actions, width: '140px', render: entry => <Button size="sm" variant="quiet" leading={<IconTrash size={16} />} onClick={() => void remove(entry)}>{copy.remove}</Button> },
      ]} />
    {dialog}
  </>;
}
