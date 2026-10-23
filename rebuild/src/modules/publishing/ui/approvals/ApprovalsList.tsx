'use client';
import { usePublishingCopy } from '../kit/CopyProvider';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components';
import { AutoTextarea } from '@/components/AutoTextarea';
import { PostPreview, type PostPreviewPost } from '@/components/PostPreview';
import { type KitLocale } from '../kit/copy';
import { useContent } from '../ContentProvider';
import { fillContent } from '../content-copy';
import { ChannelsCell } from '../posts/PostTableCells';
import styles from './approvals.module.css';

export type ApprovalRow = PostPreviewPost & { authorName: string; whenLabel: string };

function Decide({ decision, variant, children }: { decision: 'approve' | 'reject'; variant: 'primary' | 'secondary'; children: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" name="decision" value={decision} variant={variant} busy={pending} disabled={pending}>{children}</Button>;
}

export function ReviewCard({ row, locale, timeZone, canReview, reviewAction }: { row: ApprovalRow; locale: KitLocale; timeZone: string; canReview: boolean; reviewAction: (data: FormData) => void | Promise<void> }) {
  const copy = usePublishingCopy(locale);
  const { copy: content } = useContent();
  const [asking, setAsking] = useState(false);
  const card = useRef<HTMLElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  // A jumps to Approve and R opens the note: the decision itself still needs Enter or a click.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!canReview || event.target !== card.current || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === 'a') { event.preventDefault(); card.current?.querySelector<HTMLButtonElement>('button[value="approve"]')?.focus(); }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); setAsking(true); setTimeout(() => note.current?.focus(), 0); }
  };
  return <article ref={card} tabIndex={0} className={styles.card} aria-label={fillContent(content.approvalsSubmittedBy, { name: row.authorName })} onKeyDown={onKeyDown}>
    <header className={styles.cardHead}>
      <div><strong>{fillContent(content.approvalsSubmittedBy, { name: row.authorName })}</strong><span className={styles.when}>{row.whenLabel}</span></div>
      <ChannelsCell post={row} locale={locale} />
    </header>
    <div className={styles.cardPreview}><PostPreview post={row} authorName={row.authorName} timeZone={timeZone} locale={locale} variant="card" /></div>
    {canReview ? <form noValidate action={reviewAction} className={styles.decision}>
      <input type="hidden" name="postId" value={row.id} />
      {asking ? <div className={styles.note}>
        <label htmlFor={`note-${row.id}`}>{content.approvalsNoteLabel}</label>
        <AutoTextarea ref={note} id={`note-${row.id}`} name="note" maxLength={500} rows={3} placeholder={copy.reviewNotePlaceholder} aria-describedby={`note-help-${row.id}`} />
        <p id={`note-help-${row.id}`} className={styles.help}>{copy.reviewHelp}</p>
      </div> : null}
      <div className={styles.actions}>
        <Decide decision="approve" variant="primary">{content.approvalsApprove}</Decide>
        {asking
          ? <><Decide decision="reject" variant="secondary">{content.approvalsRequest}</Decide><Button type="button" variant="quiet" onClick={() => setAsking(false)}>{copy.approvalsCancel}</Button></>
          : <Button type="button" variant="secondary" onClick={() => { setAsking(true); setTimeout(() => note.current?.focus(), 0); }}>{content.approvalsRequest}</Button>}
      </div>
    </form> : <p className={styles.help}>{copy.reviewViewOnly}</p>}
  </article>;
}

/**
 * Posts waiting for review (design v2 S5): one readable card each, with the full preview inline.
 * Approve is one click; Request changes opens a note first. The decision goes through `reviewWithNoteAction`, as before.
 */
export function ApprovalsList({ rows, locale = 'en', timeZone, canReview, reviewAction }: { rows: ApprovalRow[]; locale?: KitLocale; timeZone: string; canReview: boolean; reviewAction: (data: FormData) => void | Promise<void> }) {
  const { copy: content } = useContent();
  return <>
    {canReview ? <p className={styles.keys}>{content.approvalsKeys}</p> : null}
    <ul className={styles.list}>{rows.map(row => <li key={row.id}><ReviewCard row={row} locale={locale} timeZone={timeZone} canReview={canReview} reviewAction={reviewAction} /></li>)}</ul>
  </>;
}
