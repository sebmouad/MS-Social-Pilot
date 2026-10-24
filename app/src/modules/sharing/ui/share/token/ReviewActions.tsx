'use client';
import { useRef, useState } from 'react';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components/Button';
import { Field, TextInput, useFieldProps } from '@/components/Forms';
import { ToastProvider, useToast } from '@/components/Toast';
import type { PublicCopy } from '@/modules/sharing/ui/copy';
import styles from './share.module.css';

type Decision = 'approved' | 'rejected' | 'comment';
type Props = { token: string; postId: string; canDecide: boolean; allowComments: boolean; notice?: string; copy: PublicCopy['review'] };

/** Textarea wired to the surrounding Field (id, description, invalid state). */
function CommentBox({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <AutoTextarea {...useFieldProps()} className="ui-input" value={value} onChange={event => onChange(event.target.value)} rows={2} maxLength={10000} disabled={disabled} />;
}

function Actions({ token, postId, canDecide, allowComments, notice, copy }: Props) {
  const toast = useToast();
  const [name, setName] = useState(''); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; comment?: string; form?: string }>({});
  const [settled, setSettled] = useState(false);
  const inFlight = useRef(false);
  async function send(decision: Decision) {
    if (inFlight.current) return;
    const next: typeof errors = {};
    if (!name.trim()) next.name = copy.enterName;
    if (decision !== 'approved' && !comment.trim()) next.comment = decision === 'rejected' ? copy.tellChange : copy.writeComment;
    setErrors(next);
    if (next.name || next.comment) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/sharing/public/${encodeURIComponent(token)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId, decision, authorName: name.trim(), ...(comment.trim() ? { comment: comment.trim() } : {}) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.recorded !== true) throw new Error(typeof result.error === 'string' ? result.error : copy.unconfirmed);
      toast.notify({ tone: 'success', title: copy.sent, description: typeof result.message === 'string' ? result.message : undefined });
      setComment(''); if (decision !== 'comment') setSettled(true);
    } catch (cause) { setErrors({ form: cause instanceof Error ? cause.message : copy.unconfirmed }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form className={styles.actions} onSubmit={event => event.preventDefault()} noValidate>
    <Field label={copy.name} error={errors.name}><TextInput value={name} onChange={event => setName(event.target.value)} maxLength={200} autoComplete="name" disabled={busy} /></Field>
    <Field label={copy.comment} error={errors.comment} help={notice}><CommentBox value={comment} onChange={setComment} disabled={busy} /></Field>
    <div className={styles.buttons}>
      {canDecide && !settled && <Button variant="primary" busy={busy} onClick={() => send('approved')}>{copy.approve}</Button>}
      {canDecide && !settled && <Button disabled={busy} onClick={() => send('rejected')}>{copy.requestChanges}</Button>}
      {allowComments && <Button variant="quiet" disabled={busy} onClick={() => send('comment')}>{copy.sendComment}</Button>}
    </div>
    {errors.form && <p role="alert" className={styles.error}>{errors.form}</p>}
  </form>;
}

/** Visitor answer form. Success is a toast; every correction stays beside its field with the typed text kept. */
export function ReviewActions(props: Props) {
  return <ToastProvider dismissLabel={props.copy.dismiss}><Actions {...props} /></ToastProvider>;
}
