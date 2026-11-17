'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Menu } from '@/components/Menu';
import { PostThumb } from '@/components/PostThumb';
import { useToast } from '@/components/Toast';
import type { CockpitPost } from '../server/wordpress-cockpit';
import styles from './autopilot.module.css';

const replaceConfirmation = (planId: string) => `REPLACE RECIPE ${planId}`;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
type Action = 'replace' | 'leave_empty' | 'fill';

/**
 * One day of the plan. Tomorrow (2026-11-16): approve it all, or give one time another recipe or leave it empty.
 * Today (2026-11-17): the same rows with what is already live and how many people it reached. Rows read by time or
 * by channel.
 */
export function AutopilotBoard({ mode, date, dateLabel, posts, approved = false, canWrite, confirmation = '', locale, labels }: {
  mode: 'today' | 'tomorrow'; date: string; dateLabel: string; posts: CockpitPost[]; approved?: boolean; canWrite: boolean; confirmation?: string; locale: string; labels: Record<string, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [grouping, setGrouping] = useState<'time' | 'channel'>('time');
  const [approving, setApproving] = useState(false);
  const [change, setChange] = useState<{ post: CockpitPost; action: Action } | null>(null);
  const send = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return response.ok;
  };
  const now = Date.now();
  const future = (p: CockpitPost) => Date.parse(p.slotAt) > now + 5 * 60_000;
  const number = (value: number) => new Intl.NumberFormat(locale).format(Math.round(value));

  if (!posts.length) return <p className={styles.emptyBox}>{mode === 'today' ? labels.emptyToday : labels.emptyTomorrow}</p>;

  const shown = onlyFlagged ? posts.filter(post => post.flagged) : posts;
  const groups = grouping === 'channel'
    ? [...new Set(shown.map(post => post.targetId))].map(id => ({ id, name: shown.find(post => post.targetId === id)!.targetName, posts: shown.filter(post => post.targetId === id) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [{ id: 'all', name: '', posts: shown }];
  // On today's timeline, a line marks where the day stands.
  const firstAhead = mode === 'today' && grouping === 'time' ? shown.find(post => Date.parse(post.slotAt) > now)?.planId : undefined;
  const copyFor: Record<Action, [string, string, string]> = { replace: ['anotherTitle', 'anotherConsequence', 'another'], leave_empty: ['emptyTitle', 'emptyConsequence', 'leaveEmpty'], fill: ['fillTitle', 'fillConsequence', 'fill'] };

  const row = (p: CockpitPost) => {
    const planned = p.status === 'published' || p.status === 'upcoming';
    return <li key={p.planId} className={styles.boardRow} data-flagged={p.flagged && p.status === 'upcoming' ? 'true' : undefined} data-status={p.status}>
      <span className={styles.boardTime}>{p.time}</span>
      <PostThumb thumb={planned && p.image ? { url: p.image, video: false, count: 1 } : null} size="md" />
      <div className={styles.boardText}>
        <strong>{p.status === 'empty' ? labels.leftEmpty : p.title}</strong>
        <span className={styles.meta}>{[grouping === 'time' ? p.targetName : '', p.kind ? labels[`kind_${p.kind}`] ?? p.kind : ''].filter(Boolean).join(' · ')}</span>
        {p.caption && p.status === 'upcoming' ? <span className={styles.caption}>{p.caption}</span> : null}
      </div>
      <div className={styles.boardSide}>
        {p.status === 'published' ? <span className={styles.badge} data-tone="good">{p.reach ? fill(labels.publishedReach, { reach: number(p.reach) }) : labels.publishedNoReach}</span>
          : p.status === 'failed' ? <span className={styles.badge} data-tone="warn">{labels.failed}</span>
          : p.status === 'upcoming' && typeof p.score === 'number' ? <span className={styles.score} data-band={p.score >= 70 ? 'high' : p.score >= 45 ? 'mid' : 'low'} title={p.flagged ? labels.flaggedHint : fill(labels.scoreLabel, { score: p.score })}>
            <span className="ui-visually-hidden">{fill(labels.scoreLabel, { score: '' })}</span>{p.score}</span> : null}
      </div>
      <div className={styles.boardActions}>
        {p.status === 'published' && p.url ? <a className="ui-button ui-button--quiet ui-button--sm" href={p.url} target="_blank" rel="noopener noreferrer">{labels.view}</a> : null}
        {canWrite && p.status === 'upcoming' && future(p) ? <>
          <Button size="sm" variant="secondary" onClick={() => setChange({ post: p, action: 'replace' })}>{labels.another}</Button>
          <Menu label={fill(labels.more, { title: p.title })} items={[
            ...(p.postId ? [{ key: 'open', label: labels.open, onSelect: () => router.push(`/content/post/${encodeURIComponent(p.postId!)}`) }] : []),
            { key: 'empty', label: labels.leaveEmpty, danger: true, onSelect: () => setChange({ post: p, action: 'leave_empty' }) },
          ]} />
        </> : canWrite && p.status === 'empty' && future(p) ? <Button size="sm" variant="secondary" onClick={() => setChange({ post: p, action: 'fill' })}>{labels.fill}</Button>
          : p.postId && p.status !== 'empty' && !(p.status === 'published' && p.url) ? <a className="ui-button ui-button--quiet ui-button--sm" href={`/content/post/${encodeURIComponent(p.postId)}`}>{labels.open}</a> : null}
      </div>
    </li>;
  };

  return <>
    <div className={styles.boardBar}>
      <div className={styles.segmented} role="group" aria-label={labels.groupBy}>
        <button type="button" aria-pressed={grouping === 'time'} onClick={() => setGrouping('time')}>{labels.byTime}</button>
        <button type="button" aria-pressed={grouping === 'channel'} onClick={() => setGrouping('channel')}>{labels.byChannel}</button>
      </div>
      {mode === 'tomorrow' && posts.some(p => p.flagged) ? <Button variant="quiet" size="sm" aria-pressed={onlyFlagged} onClick={() => setOnlyFlagged(v => !v)}>{onlyFlagged ? labels.showAll : labels.showFlagged}</Button> : null}
      <span className={styles.boardBarEnd}>
        {mode !== 'tomorrow' || !canWrite ? null : approved ? <span className={styles.badge} data-tone="good">{labels.approved}</span> : <Button variant="primary" size="sm" onClick={() => setApproving(true)}>{labels.approveAll}</Button>}
      </span>
    </div>
    {groups.map(group => <Fragment key={group.id}>
      {group.name ? <h3 className={styles.groupName}>{group.name} <span>{group.posts.length}</span></h3> : null}
      <ul className={styles.board}>{group.posts.map(p => <Fragment key={p.planId}>
        {p.planId === firstAhead ? <li className={styles.nowLine} aria-hidden="true"><span>{labels.now}</span></li> : null}
        {row(p)}
      </Fragment>)}</ul>
    </Fragment>)}
    <ConfirmDialog open={approving} title={labels.approveTitle} objectName={fill(labels.approveObject, { date: dateLabel })} consequence={labels.approveConsequence}
      confirmLabel={labels.approveAll} cancelLabel={labels.cancel} failureLabel={labels.approveFailed} danger={false} onClose={() => setApproving(false)}
      onConfirm={async () => {
        if (!await send('/api/feeds/wordpress/autopilot', { date, confirmation }).catch(() => false)) return labels.approveFailed;
        setApproving(false); toast.notify({ title: labels.approveDone }); router.refresh(); return null;
      }} />
    {change ? <ConfirmDialog open title={labels[copyFor[change.action][0]]!} objectName={change.action === 'fill' ? `${change.post.time} · ${change.post.targetName}` : change.post.title}
      consequence={fill(labels[copyFor[change.action][1]]!, { title: change.post.title, channel: change.post.targetName })}
      confirmLabel={labels[copyFor[change.action][2]]!} cancelLabel={labels.cancel} failureLabel={labels.changeFailed} danger={change.action === 'leave_empty'} onClose={() => setChange(null)}
      onConfirm={async () => {
        if (!await send('/api/feeds/wordpress/replace', { planId: change.post.planId, confirmation: replaceConfirmation(change.post.planId), action: change.action }).catch(() => false)) return labels.changeFailed;
        setChange(null); toast.notify({ title: labels.changed }); router.refresh(); return null;
      }} /> : null}
  </>;
}
