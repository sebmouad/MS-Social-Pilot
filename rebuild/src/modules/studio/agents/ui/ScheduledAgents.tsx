'use client';
import { useRef, useState, useTransition } from 'react';
import { IconCalendarWeek, IconPencil, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import type { ScheduledAgent, ScheduledChannel, ScheduledRun } from '../server/scheduled';
import type { AutopilotTier, ResolvedAutopilotPolicy } from '../server/autopilot';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import type { AgentCopy } from '../copy';
import styles from './agents.module.css';

export type ScheduledResult = { agents?: ScheduledAgent[]; channels?: ScheduledChannel[]; history?: ScheduledRun[]; policy?: ResolvedAutopilotPolicy; error?: string; ok?: boolean; id?: string; drafts?: number; maxDrafts?: number; briefMax?: number };
const CREATE = 'CREATE SCHEDULED AGENT';
const tierLabel = (t: AgentCopy, tier: AutopilotTier) => tier === 'manual' ? t.autopilotManual : tier === 'assisted' ? t.autopilotAssisted : t.autopilotSupervised;

export function ScheduledAgents({ agents, channels, maxDrafts, briefMax, history: initialHistory, policy: initialPolicy, canManageTier, copy: t, locale, execute }: { agents: ScheduledAgent[]; channels: ScheduledChannel[]; maxDrafts: number; briefMax: number; history: ScheduledRun[]; policy: ResolvedAutopilotPolicy | null; canManageTier: boolean; copy: AgentCopy; locale: 'en' | 'fr'; execute: (input: unknown) => Promise<ScheduledResult> }) {
 const [pending, start] = useTransition();
 const [items, setItems] = useState(agents);
 const [history, setHistory] = useState(initialHistory);
 const [policy, setPolicy] = useState(initialPolicy);
 const [tier, setTier] = useState<AutopilotTier>(initialPolicy?.tier ?? 'assisted');
 const [maxSends, setMaxSends] = useState(String(initialPolicy?.maxSendsPerDay ?? 10));
 const [quietStart, setQuietStart] = useState(String(initialPolicy?.quietStartHour ?? 22));
 const [quietEnd, setQuietEnd] = useState(String(initialPolicy?.quietEndHour ?? 7));
 const [scope, setScope] = useState<string[]>(initialPolicy?.targetIds ?? []);
 const [draftsOnly, setDraftsOnly] = useState<string[]>(initialPolicy?.draftsOnlyTargetIds ?? []);
 const toggle = (list: string[], id: string, set: (next: string[]) => void) => set(list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
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
 const dayName = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 4 + day)));
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
     if (list.history) setHistory(list.history);
     if (list.policy) { setPolicy(list.policy); setTier(list.policy.tier); }
    } catch { setError(t.upstream_failure); }
    status.current?.focus();
   }
  });
 }
 function changeTier() {
  const phrase = `SET AUTOPILOT TIER ${tier}`;
  // The confirmation dialog opens as an urgent update; only the refresh after it is a transition.
  // (Awaiting the dialog inside the transition leaves it unflushed.)
  setError(''); setFeedback('');
  void confirm(t.autopilotReview, {
   exactConfirmation: phrase, confirmationLabel: t.confirmation, pendingLabel: t.busy, failureLabel: t.failed,
   onConfirm: async () => {
    const result = await execute({ action: 'tier', tier, guardrails: { maxSendsPerDay: Number(maxSends), quietStartHour: Number(quietStart), quietEndHour: Number(quietEnd), ...(scope.length ? { targetIds: scope } : {}), ...(draftsOnly.length ? { draftsOnlyTargetIds: draftsOnly } : {}) }, confirmation: phrase });
    if (result.error || result.ok !== true || !result.policy) return result.error ?? t.upstream_failure;
    setPolicy(result.policy); setFeedback(t.autopilotChanged);
    return null;
   },
  }).then(accepted => { if (accepted) status.current?.focus(); });
 }
 return <section className={`ui-panel ${styles.panel}`} aria-busy={pending}>
  {policy ? <>
   <h2>{t.autopilotTitle}</h2>
   <p>{t.autopilotIntro}</p>
   <p role="status">{t.autopilotTier}: <strong>{tierLabel(t, policy.tier)}</strong></p>
   {canManageTier ? <form className={styles.form} onSubmit={e => { e.preventDefault(); changeTier(); }}>
    <fieldset><legend>{t.autopilotTier}</legend>
     {(['manual', 'assisted', 'supervised_auto'] as const).map(option => <label key={option} className="ui-field"><input type="radio" name="tier" value={option} checked={tier === option} disabled={pending} onChange={() => setTier(option)} /> {tierLabel(t, option)} <small>{option === 'manual' ? t.autopilotManualHint : option === 'assisted' ? t.autopilotAssistedHint : t.autopilotSupervisedHint}</small></label>)}
    </fieldset>
    <fieldset><legend>{t.autopilotGuardrails}</legend>
     <label className="ui-field">{t.autopilotMaxSends}<input name="maxSends" type="number" min={0} max={200} className="ui-input" value={maxSends} disabled={pending} onChange={e => setMaxSends(e.target.value)} required /></label>
     <label className="ui-field">{t.autopilotQuietStart}<input name="quietStart" type="number" min={0} max={23} className="ui-input" value={quietStart} disabled={pending} onChange={e => setQuietStart(e.target.value)} required /></label>
     <label className="ui-field">{t.autopilotQuietEnd}<input name="quietEnd" type="number" min={0} max={23} className="ui-input" value={quietEnd} disabled={pending} onChange={e => setQuietEnd(e.target.value)} required /></label>
     <fieldset><legend>{t.autopilotScope}</legend>{channels.length ? channels.map(c => <label key={c.id} className="ui-field"><input type="checkbox" checked={scope.includes(c.id)} disabled={pending} onChange={() => toggle(scope, c.id, setScope)} /> {c.name}</label>) : <p>{t.autopilotScopeAll}</p>}</fieldset>
     <fieldset><legend>{t.autopilotDraftsOnly}</legend>{channels.length ? channels.map(c => <label key={c.id} className="ui-field"><input type="checkbox" checked={draftsOnly.includes(c.id)} disabled={pending} onChange={() => toggle(draftsOnly, c.id, setDraftsOnly)} /> {c.name}</label>) : <p>{t.autopilotDraftsOnlyNone}</p>}</fieldset>
    </fieldset>
    <div className={styles.actions}><Button type="submit" disabled={pending}>{pending ? t.busy : t.autopilotChange}</Button></div>
   </form> : null}
  </> : null}
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
  <h2>{t.scheduledHistory}</h2>
  {history.length ? <ol className={styles.list}>{history.map((run, index) => {
    const agent = items.find(item => item.id === run.agentId);
    const ok = run.code === null;
    const tierName = run.tier === 'manual' || run.tier === 'assisted' || run.tier === 'supervised_auto' ? tierLabel(t, run.tier) : null;
    return <li key={`${run.agentId}-${run.at}-${index}`}><div className={styles.identity}><strong>{agent?.targetName ?? agent?.targetId ?? t.unknownAgent}</strong><p>{ok ? `${t.completed} · ${t.historyDrafts.replace('{count}', String(run.drafts ?? 0))}${tierName ? ` · ${tierName}` : ''}${typeof run.scheduled === 'number' && run.scheduled > 0 ? ` · ${t.autopilotSends.replace('{count}', String(run.scheduled))}` : ''}` : t.failedRun}</p></div><time dateTime={run.at}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(run.at))} {t.timeZone}</time></li>;
  })}</ol> : <p>{t.noHistory}</p>}
  {confirmation}{removal}
 </section>;
}
