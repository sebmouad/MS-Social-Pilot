'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import type { CockpitPost } from '../server/wordpress-cockpit';
import styles from './autopilot.module.css';

const replaceConfirmation = (planId: string) => `REPLACE RECIPE ${planId}`;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);

/** Tomorrow's plan (2026-11-16): approve it all, or give one time another recipe or leave it empty. */
export function AutopilotBoard({ date, dateLabel, posts, approved, canWrite, confirmation, labels }: {
  date: string; dateLabel: string; posts: CockpitPost[]; approved: boolean; canWrite: boolean; confirmation: string; labels: Record<string, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [approving, setApproving] = useState(false);
  const [change, setChange] = useState<{ post: CockpitPost; action: 'replace' | 'leave_empty' } | null>(null);
  const shown = onlyFlagged ? posts.filter(post => post.flagged) : posts;
  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return response.ok;
  };
  const future = (p: CockpitPost) => Date.parse(p.slotAt) > Date.now() + 5 * 60_000;

  if (!posts.length) return <p className={styles.muted}>{labels.emptyTomorrow}</p>;
  return <>
    <div className={styles.boardBar}>
      {canWrite ? approved ? <span className={styles.badge} data-tone="accent">{labels.approved}</span> : <Button variant="primary" size="sm" onClick={() => setApproving(true)}>{labels.approveAll}</Button> : null}
      {posts.some(p => p.flagged) ? <Button variant="quiet" size="sm" aria-pressed={onlyFlagged} onClick={() => setOnlyFlagged(v => !v)}>{onlyFlagged ? labels.showAll : labels.showFlagged}</Button> : null}
    </div>
    <ul className={styles.board}>{shown.map(p => <li key={p.planId} className={styles.boardRow} data-flagged={p.flagged ? 'true' : undefined} data-empty={p.state !== 'planned' ? 'true' : undefined}>
      <span className={styles.boardTime}>{p.time}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.image ? <img className={styles.boardThumb} src={p.image} alt="" loading="lazy" width={56} height={56} /> : <span className={styles.boardThumb} aria-hidden="true" />}
      <div className={styles.boardText}>
        <strong>{p.state === 'planned' ? p.title : labels.leftEmpty}</strong>
        <span className={styles.meta}>{p.targetName}{p.kind ? ` · ${p.kind}` : ''}</span>
        {p.caption && p.state === 'planned' ? <span className={styles.caption}>{p.caption}</span> : null}
      </div>
      {typeof p.score === 'number' && p.state === 'planned' ? <span className={styles.score} data-band={p.score >= 70 ? 'high' : p.score >= 45 ? 'mid' : 'low'} title={p.flagged ? labels.flaggedHint : fill(labels.scoreLabel, { score: p.score })}>{p.score}</span> : <span />}
      <div className={styles.boardActions}>
        {p.postId ? <a className="ui-button ui-button--quiet ui-button--sm" href={`/content/post/${p.postId}`}>{labels.open}</a> : null}
        {canWrite && p.state === 'planned' && future(p) ? <>
          <Button size="sm" variant="secondary" onClick={() => setChange({ post: p, action: 'replace' })}>{labels.another}</Button>
          <Button size="sm" variant="quiet" onClick={() => setChange({ post: p, action: 'leave_empty' })}>{labels.leaveEmpty}</Button>
        </> : null}
      </div>
    </li>)}</ul>
    <ConfirmDialog open={approving} title={labels.approveTitle} objectName={fill(labels.approveObject, { date: dateLabel })} consequence={labels.approveConsequence}
      confirmLabel={labels.approveAll} cancelLabel={labels.cancel} failureLabel={labels.approveFailed} danger={false} onClose={() => setApproving(false)}
      onConfirm={async () => {
        if (!await post('/api/feeds/wordpress/autopilot', { date, confirmation }).catch(() => false)) return labels.approveFailed;
        setApproving(false); toast.notify({ title: labels.approveDone }); router.refresh(); return null;
      }} />
    {change ? <ConfirmDialog open title={change.action === 'replace' ? labels.anotherTitle : labels.emptyTitle} objectName={change.post.title}
      consequence={fill(change.action === 'replace' ? labels.anotherConsequence : labels.emptyConsequence, { title: change.post.title, channel: change.post.targetName })}
      confirmLabel={change.action === 'replace' ? labels.another : labels.leaveEmpty} cancelLabel={labels.cancel} failureLabel={labels.changeFailed} onClose={() => setChange(null)}
      onConfirm={async () => {
        if (!await post('/api/feeds/wordpress/replace', { planId: change.post.planId, confirmation: replaceConfirmation(change.post.planId), action: change.action }).catch(() => false)) return labels.changeFailed;
        setChange(null); toast.notify({ title: labels.changed }); router.refresh(); return null;
      }} /> : null}
  </>;
}
