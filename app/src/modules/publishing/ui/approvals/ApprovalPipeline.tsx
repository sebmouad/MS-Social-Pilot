'use client';
import { usePublishingActionText } from '../WorkflowSubmitButtons';
import { PostNotesThread } from '../collaboration/PostPanel';
import { useContent } from '../ContentProvider';
import { fillContent } from '../content-copy';
import { ChannelsCell } from '../posts/PostTableCells';
import { submitForApprovalAction } from '../posts/actions';
import { ReviewCard, type ApprovalRow } from './ApprovalsList';
import type { KitLocale } from '../kit/copy';
import { postThumbnail } from '@/components/post-thumbnail';
import { IconMessage2 } from '@tabler/icons-react';
import { useCollaborationCopy } from '../compose/CopyProvider';
import styles from './approvals.module.css';

export type PipelineNote = { id: string; body: string; authorId: string | null; authorName: string | null; createdAt: string; createdLabel?: string };
export type PipelineRow = ApprovalRow & {
  /** Submit for review is offered: an authored draft with destinations the viewer may manage. */
  canSubmit: boolean;
  /** "Approved by {name}" line for the approved stage; absent elsewhere. */
  stageNote?: string;
  notes: PipelineNote[];
  mentionable: Array<{ id: string; name: string }>;
  noteMax: number;
  notesUnavailable: boolean;
};
export type PipelineStage = {
  id: 'draft' | 'review' | 'approved' | 'scheduled';
  title: string;
  empty: string;
  total: number;
  rows: PipelineRow[];
  viewAllHref: string;
};

function Thread({ row, timeZone, viewerId, canWriteNotes, canModerateNotes }: { row: PipelineRow; timeZone: string; viewerId: string; canWriteNotes: boolean; canModerateNotes: boolean }) {
  const { copy: content } = useContent();
  if (row.notesUnavailable) return <p className={styles.help}>{content.approvalsNotesUnavailable}</p>;
  return <PostNotesThread postId={row.id} canWrite={canWriteNotes} notes={row.notes} mentionable={row.mentionable} noteMax={row.noteMax} viewerId={viewerId} canModerate={canModerateNotes} timeZone={timeZone} idPrefix={`notes-${row.id}`} />;
}

function PipelineCard({ row, locale, timeZone, viewerId, canWriteNotes, canModerateNotes }: { row: PipelineRow; locale: KitLocale; timeZone: string; viewerId: string; canWriteNotes: boolean; canModerateNotes: boolean }) {
  const t = usePublishingActionText(locale);
  const { copy: content } = useContent();
  // Library pictures are stored as references; the shared helper turns them into the authorized media address.
  const cover = postThumbnail(row.media)?.url ?? null;
  const collab = useCollaborationCopy();
  return <article className={styles.card} aria-label={fillContent(content.approvalsSubmittedBy, { name: row.authorName })}>
    <header className={styles.cardHead}>
      <div><strong>{row.authorName}</strong><span className={styles.when}>{row.whenLabel}</span></div>
      <ChannelsCell post={row} locale={locale} />
    </header>
    {row.stageNote ? <p className={styles.help}>{row.stageNote}</p> : null}
    {/* Outside review, a compact summary: the full preview (with first comment) made one column thousands of pixels tall. */}
    <div className={styles.compact}>
      {cover ? <img src={cover} alt="" loading="lazy" /> : null}
      <p>{row.message}</p>
    </div>
    <div className={styles.actions}>
      {row.canSubmit ? <form noValidate action={submitForApprovalAction}><input type="hidden" name="postId" value={row.id} /><button className="ui-button ui-button--primary ui-button--sm" type="submit">{t('submitForApproval')}</button></form> : null}
      <a className="ui-button ui-button--secondary ui-button--sm" href={`/content/post/${encodeURIComponent(row.id)}`}>{content.approvalsOpenPost}</a>
    </div>
    {/* Notes open on demand: a note form inside every card made the board several screens long. */}
    <details className={styles.notes} open={row.notes.length > 0 && row.notes.length <= 2}>
      <summary><IconMessage2 size={15} aria-hidden="true" /><span>{collab.team_notes}</span>{row.notes.length > 0 ? <span className={styles.notesCount}>{row.notes.length.toLocaleString(locale)}</span> : null}</summary>
      <Thread row={row} timeZone={timeZone} viewerId={viewerId} canWriteNotes={canWriteNotes} canModerateNotes={canModerateNotes} />
    </details>
  </article>;
}

/**
 * Approval pipeline (UI wave 2): draft → review → approved → scheduled columns with the same review
 * decisions as before and each post's team-comments thread attached. Review cards keep their approve
 * / request-changes flow; drafts offer the shared submit action; nothing here changes publishing rules.
 */
export function ApprovalPipeline({ stages, locale = 'en', timeZone, viewerId, canReview, canWriteNotes, canModerateNotes, reviewAction }: {
  stages: PipelineStage[]; locale?: KitLocale; timeZone: string; viewerId: string; canReview: boolean; canWriteNotes: boolean; canModerateNotes: boolean; reviewAction: (data: FormData) => void | Promise<void>;
}) {
  const { copy: content } = useContent();
  // Mixed board: empty stages shrink to slim tiles and each stage with posts takes the full width.
  const mixed = stages.some(stage => stage.rows.length === 0) && stages.some(stage => stage.rows.length > 0);
  return <div className={`${styles.board}${mixed ? ` ${styles.boardMixed}` : ''}`} role="group" aria-label={content.approvalsBoardLabel}>
    {stages.map(stage => <section key={stage.id} className={`${styles.stage}${stage.rows.length ? ` ${styles.stageFilled}` : ''}`} aria-labelledby={`pipeline-${stage.id}`}>
      <div className={styles.stageHead}><h2 id={`pipeline-${stage.id}`}>{stage.title}</h2><span className={styles.stageCount}>{fillContent(stage.total === 1 ? content.contentCountOne : content.contentCount, { count: stage.total.toLocaleString(locale) })}</span></div>
      {stage.rows.length ? <ul className={styles.stageList}>{stage.rows.map(row => <li key={row.id}>
        {stage.id === 'review'
          ? <><ReviewCard row={row} locale={locale} timeZone={timeZone} canReview={canReview} reviewAction={reviewAction} /><Thread row={row} timeZone={timeZone} viewerId={viewerId} canWriteNotes={canWriteNotes} canModerateNotes={canModerateNotes} /></>
          : <PipelineCard row={row} locale={locale} timeZone={timeZone} viewerId={viewerId} canWriteNotes={canWriteNotes} canModerateNotes={canModerateNotes} />}
      </li>)}</ul> : <p className={styles.help}>{stage.empty}</p>}
      {stage.total > stage.rows.length ? <a className={styles.viewAll} href={stage.viewAllHref}>{fillContent(content.approvalsViewAllCount, { count: stage.total.toLocaleString(locale) })}</a> : null}
    </section>)}
  </div>;
}
