'use client';
import { useRef, useState, useTransition } from 'react';
import { IconCalendarWeek, IconPencil, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import type { ScheduledAgent, ScheduledChannel } from '../server/scheduled';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import type { AgentCopy } from '../copy';
import styles from './agents.module.css';

export type ScheduledResult = { agents?: ScheduledAgent[]; channels?: ScheduledChannel[]; error?: string; ok?: boolean; id?: string; drafts?: number; maxDrafts?: number; briefMax?: number };
const CREATE = 'CREATE SCHEDULED AGENT';

export function ScheduledAgents({ agents, channels, maxDrafts, briefMax, copy: t, locale, execute }: { agents: ScheduledAgent[]; channels: ScheduledChannel[]; maxDrafts: number; briefMax: number; copy: AgentCopy; locale: 'en' | 'fr'; execute: (input: unknown) => Promise<ScheduledResult> }) {
 const [pending, start] = useTransition();
 const [items, setItems] = useState(agents);
 const [editing, setEditing] = useState<string>();
 const [targetId, setTargetId] = useState(channels[0]?.id ?? '');
 const [brief, setBrief] = useState('');
 const [weekday, setWeekday] = useState('1');
 const [count, setCount] = useState('5');
 const [enabled, setEnabled] = useState(true);
 const [feedback, setFeedback] = useState(''); const [error, setError] = useState('');
 const status = useRef<HTMLParagraphElement>(null);
 const [confirm, confirmation] = useConfirm({ title: t.confirm, cancel: t.cancel, confirm: t.confirm, danger: false });
 const [removeConfirm, removal] = useConfirm({ title: t.remove, cancel: t.cancel, confirm: t.remove });
 const dayName = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(Date.UTC(2026, 9, 4 + day)));
 function clearEditor() { setEditing(undefined); setTargetId(channels[0]?.id ?? ''); setBrief(''); setWeekday('1'); setCount('5'); setEnabled(true); }
 function edit(agent: ScheduledAgent) { setEditing(agent.id); setTargetId(agent.targetId); setBrief(agent.brief); setWeekday(String(agent.weekday)); setCount(String(agent.count)); setEnabled(agent.enabled); }
 function mutate(action: 'save' | 'delete' | 'run', id?: string) {
  const phrase = action === 'save' ? (editing ? `UPDATE SCHEDULED AGENT ${editing}` : CREATE) : `${action === 'run' ? 'RUN' : 'DELETE'} SCHEDULED AGENT ${id}`;
  const ask = action === 'delete' ? removeConfirm : confirm;
  start(async () => {
   setError(''); setFeedback('');
   const accepted = await ask(action === 'save' ? t.scheduledReview : action === 'delete' ? t.scheduledDeleteReview : t.runScheduledReview, {
    exactConfirmation: phrase, confirmationLabel: t.confirmation, pendingLabel: t.busy, failureLabel: t.failed,
    onConfirm: async () => {
     const input = action === 'save' ? { action, ...(editing ? { id: editing } : {}), targetId, brief, weekday: Number(weekday), count: Number(count), enabled, confirmation: phrase } : { action, id, confirmation: phrase };
     const result = await execute(input);
     if (result.error) return result.error;
     if (action === 'run') {
      if (result.ok !== true || typeof result.drafts !== 'number') return t.upstream_failure;
      setFeedback(t.scheduledRan);
     } else {
      if (result.ok !== true || !result.id) return t.upstream_failure;
      setFeedback(action === 'save' ? t.scheduledSaved : t.scheduledDeleted);
      clearEditor();
     }
     return null;
    },
   });
   if (accepted) {
    try {
     const list = await execute({ action: 'list' });
     if (list.agents) setItems(list.agents);
    } catch { setError(t.upstream_failure); }
    status.current?.focus();
   }
  });
 }
 return <section className={`ui-panel ${styles.panel}`} aria-busy={pending}>
  <h2><IconCalendarWeek size={20} aria-hidden="true" /> {t.scheduledTitle}</h2>
  <p>{t.scheduledIntro}</p>
  <p ref={status} tabIndex={-1} role="status">{feedback}</p>{error ? <p role="alert">{error}</p> : null}
  {!items.length ? <p>{t.scheduledEmpty}</p> : <ul className={styles.list}>{items.map(agent => <li key={agent.id}>
   <div className={styles.identity}><strong>{agent.targetName ?? agent.targetId}</strong><p>{agent.brief}</p><p>{dayName(agent.weekday)} · {agent.count} · {agent.enabled ? t.active : t.paused} · {agent.lastRunOn ? `${t.lastRun}: ${agent.lastRunOn}` : t.neverRan}</p></div>
   <div className={styles.actions}>
    <Button disabled={pending} onClick={() => edit(agent)} aria-label={`${t.edit}: ${agent.targetName ?? agent.targetId}`}><IconPencil size={16} aria-hidden="true" />{t.edit}</Button>
    <Button disabled={pending || !agent.enabled} onClick={() => mutate('run', agent.id)} aria-label={`${t.runScheduled}: ${agent.targetName ?? agent.targetId}`}><IconPlayerPlay size={16} aria-hidden="true" />{t.runScheduled}</Button>
    <Button variant="danger" disabled={pending} onClick={() => mutate('delete', agent.id)} aria-label={`${t.remove}: ${agent.targetName ?? agent.targetId}`}><IconTrash size={16} aria-hidden="true" />{t.remove}</Button>
   </div>
  </li>)}</ul>}
  <h2>{editing ? t.edit : t.newScheduled}</h2>
  {channels.length ? <form className={styles.form} onSubmit={e => { e.preventDefault(); mutate('save'); }}>
   <label className="ui-field">{t.channel}<select name="target" className="ui-input" value={targetId} disabled={pending} onChange={e => setTargetId(e.target.value)} required>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="ui-field">{t.brief}<AutoTextarea name="brief" className="ui-input" value={brief} maxLength={briefMax} disabled={pending} onChange={e => setBrief(e.target.value)} required /></label>
   <label className="ui-field">{t.weekday}<select name="weekday" className="ui-input" value={weekday} disabled={pending} onChange={e => setWeekday(e.target.value)}>{[0, 1, 2, 3, 4, 5, 6].map(day => <option key={day} value={day}>{dayName(day)}</option>)}</select></label>
   <label className="ui-field">{t.draftsPerWeek}<input name="count" type="number" min={1} max={maxDrafts} className="ui-input" value={count} disabled={pending} onChange={e => setCount(e.target.value)} required /></label>
   <label className="ui-field"><input name="enabled" type="checkbox" checked={enabled} disabled={pending} onChange={e => setEnabled(e.target.checked)} /> {t.active}</label>
   <div className={styles.actions}><Button type="submit" disabled={pending}>{pending ? t.busy : t.saveScheduled}</Button>{editing ? <Button disabled={pending} onClick={clearEditor}>{t.cancel}</Button> : null}</div>
  </form> : <p>{t.scheduledEmpty}</p>}
  {confirmation}{removal}
 </section>;
}
