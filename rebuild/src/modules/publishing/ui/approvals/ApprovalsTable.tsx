'use client';

import { useState } from 'react';
import { IconChevronDown, IconChevronRight, IconChecklist } from '@tabler/icons-react';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button, DataTable, Drawer, type TableColumn } from '@/components';
import { PostPreview, type PostPreviewPost } from '@/components/PostPreview';
import { kitCopy, type KitLocale } from '../kit/copy';
import { ReviewButtons } from '../WorkflowSubmitButtons';
import { ChannelsCell, PostCell } from '../posts/PostTableCells';
import workflow from '../workflow.module.css';
import styles from './approvals.module.css';

export type ApprovalRow = PostPreviewPost & { authorName: string; whenLabel: string };

/**
 * Posts waiting for review on the shared DataTable. Each row can expand to the full preview in place;
 * the decision (with its optional note) happens in a side drawer so the list stays visible.
 */
export function ApprovalsTable({ rows, caption, locale = 'en', timeZone, canReview, reviewAction }: { rows: ApprovalRow[]; caption: string; locale?: KitLocale; timeZone: string; canReview: boolean; reviewAction: (data: FormData) => void | Promise<void> }) {
  const copy = kitCopy[locale];
  const [open, setOpen] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const current = rows.find(row => row.id === reviewing) ?? null;
  const toggle = (id: string) => setOpen(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  const columns: TableColumn<ApprovalRow>[] = [
    { key: 'post', label: copy.columnPost, render: row => {
      const expanded = open.includes(row.id);
      const panel = `approval-preview-${row.id}`;
      return <div className={styles.postCell}>
        <PostCell post={row} locale={locale} />
        <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={panel} onClick={() => toggle(row.id)}>
          {expanded ? <IconChevronDown size={14} aria-hidden="true" /> : <IconChevronRight size={14} aria-hidden="true" />}
          {expanded ? copy.approvalsHidePreview : copy.approvalsPreview}
        </button>
        {expanded ? <div id={panel} className={styles.preview}><PostPreview post={row} authorName={row.authorName} timeZone={timeZone} locale={locale} /></div> : null}
      </div>;
    } },
    { key: 'author', label: copy.approvalsColumnAuthor, render: row => row.authorName },
    { key: 'channels', label: copy.columnChannels, render: row => <ChannelsCell post={row} locale={locale} /> },
    { key: 'created', label: copy.approvalsColumnSubmitted, render: row => row.whenLabel },
    { key: 'review', label: copy.approvalsReview, hideCardLabel: true, render: row => canReview
      ? <Button size="sm" variant="primary" leading={<IconChecklist size={16} aria-hidden="true" />} onClick={() => setReviewing(row.id)}>{copy.approvalsReview}</Button>
      : <span className={workflow.help}>{copy.reviewViewOnly}</span> },
  ];
  return <>
    <DataTable columns={columns} rows={rows} rowKey={row => row.id} caption={caption} />
    <Drawer open={Boolean(current && canReview)} title={copy.approvalsReviewTitle} description={copy.approvalsReviewDescription} closeLabel={copy.approvalsCancel} onClose={() => setReviewing(null)}>
      {current ? <form noValidate className={workflow.form} action={reviewAction}>
        <PostPreview post={current} authorName={current.authorName} timeZone={timeZone} locale={locale} />
        <input type="hidden" name="postId" value={current.id} />
        <label htmlFor={`note-${current.id}`}>{copy.reviewNote}</label>
        <AutoTextarea id={`note-${current.id}`} name="note" maxLength={500} rows={3} aria-describedby={`note-help-${current.id}`} placeholder={copy.reviewNotePlaceholder} />
        <p className={workflow.help} id={`note-help-${current.id}`}>{copy.reviewHelp}</p>
        <ReviewButtons locale={locale} />
      </form> : null}
    </Drawer>
  </>;
}
