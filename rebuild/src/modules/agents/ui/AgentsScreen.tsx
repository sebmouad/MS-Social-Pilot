'use client';
import { useRef, useState, useTransition } from 'react';
import { IconPencil, IconSparkles, IconTrash } from '@tabler/icons-react';
import type { Agent, AgentRun } from '../server/service';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useConfirm } from '@/components/useConfirm';
import type { AgentCopy } from '../copy';
import styles from './agents.module.css';
export type AgentResult = { agents?: Agent[]; runs?: AgentRun[]; suggestion?: string; error?: string; hasMore?: boolean; pageSize?: number; offset?: number; ok?: boolean; id?: string; runId?: string; reviewRequired?: boolean };
/** One injected action boundary keeps all mutations in the authenticated shared service. */
export function AgentsScreen({ agents, runs = [], hasMore = false, pageSize, copy: t, locale, execute }: { agents: Agent[]; runs?: AgentRun[]; hasMore?: boolean; pageSize: number; copy: AgentCopy; locale: 'en' | 'fr'; execute: (input: unknown) => Promise<AgentResult> }) {
 const [pending, start] = useTransition();
 const [items, setItems] = useState(agents); const [selected, setSelected] = useState(agents[0]?.id ?? '');
 const [editing, setEditing] = useState<string>();
 const [name, setName] = useState(''); const [instructions, setInstructions] = useState(''); const [voice, setVoice] = useState('');
 const [text, setText] = useState(''); const [kind, setKind] = useState('post'); const [suggestion, setSuggestion] = useState(''); const [feedback, setFeedback] = useState(''); const [error, setError] = useState('');
 const [history, setHistory] = useState(runs); const [more, setMore] = useState(hasMore); const [offset, setOffset] = useState(0);
 const status = useRef<HTMLParagraphElement>(null); const nameInput = useRef<HTMLInputElement>(null);
 const [confirm, confirmation] = useConfirm({ title: t.confirm, cancel: t.cancel, confirm: t.confirm, danger: false });
 const [removeConfirm, removal] = useConfirm({ title: t.remove, cancel: t.cancel, confirm: t.remove });
 async function refreshHistory(nextOffset = offset) {
  const next = await execute({ action: 'history', offset: nextOffset });
  if (next.error || !next.runs) throw new Error(t.failed);
  setHistory(next.runs); setMore(next.hasMore === true); setOffset(nextOffset);
 }
 function clearEditor() { setEditing(undefined); setName(''); setInstructions(''); setVoice(''); }
 function edit(agent: Agent) { setEditing(agent.id); setName(agent.name); setInstructions(agent.instructions); setVoice(agent.voice); nameInput.current?.focus(); }
 function mutate(action: 'save' | 'delete' | 'draft', id?: string) {
  const phrase = action === 'save' ? `SAVE ${name.trim()}` : `${action.toUpperCase()} ${id}`;
  const ask = action === 'delete' ? removeConfirm : confirm;
  start(async () => {
   setError(''); setFeedback('');
   const accepted = await ask(action === 'save' ? t.saveReview : action === 'delete' ? t.deleteReview : t.draftReview, {
    exactConfirmation: phrase, confirmationLabel: t.confirmation, pendingLabel: t.busy, failureLabel: t.failed,
    onConfirm: async () => {
     const input = action === 'save' ? { action, ...(editing ? { id: editing } : {}), name, instructions, voice, confirmation: phrase } : action === 'draft' ? { action, id, text, kind, confirmation: phrase } : { action, id, confirmation: phrase };
     const result = await execute(input);
     if (result.error) return result.error;
     if (action === 'draft') {
      if (!result.suggestion || !result.runId || result.reviewRequired !== true) return t.upstream_failure;
      setSuggestion(result.suggestion); setFeedback(t.review);
     } else {
      if (result.ok !== true || !result.id) return t.upstream_failure;
      setFeedback(action === 'save' ? t.saved : t.deleted);
      if (action === 'save' || editing === id) clearEditor();
     }
     return null;
    },
   });
   if (accepted) {
    // Refresh failures after an acknowledged mutation never invite a second write.
    try {
     const list = await execute({ action: 'list' });
     if (list.agents) { setItems(list.agents); setSelected(current => list.agents!.some(a => a.id === current) ? current : list.agents![0]?.id ?? ''); }
     await refreshHistory();
    } catch { setError(t.upstream_failure); }
    status.current?.focus();
   }
  });
 }
 return <section className={styles.root} data-module="agents" aria-busy={pending}>
  <PageHeader module="agents" title={t.title} description={t.intro} />
  <p ref={status} tabIndex={-1} role="status">{feedback}</p>{error ? <p role="alert">{error}</p> : null}
  <div className={styles.workspace}>
   <section className={`ui-panel ${styles.panel}`}><h2>{t.choose}</h2>
    {!items.length ? <p>{t.empty}</p> : <ul className={styles.list}>{items.map(agent => <li key={agent.id}>
     <div className={styles.identity}><strong>{agent.name}</strong><p>{agent.instructions}</p></div>
     <div className={styles.actions}><Button disabled={pending} onClick={() => edit(agent)} aria-label={`${t.edit}: ${agent.name}`}><IconPencil size={16} aria-hidden="true" />{t.edit}</Button><Button variant="danger" disabled={pending} onClick={() => mutate('delete', agent.id)} aria-label={`${t.remove}: ${agent.name}`}><IconTrash size={16} aria-hidden="true" />{t.remove}</Button></div>
    </li>)}</ul>}
    <h2>{editing ? t.edit : t.create}</h2><form className={styles.form} onSubmit={e => { e.preventDefault(); mutate('save'); }}>
     <label className="ui-field">{t.name}<input ref={nameInput} name="name" autoComplete="off" className="ui-input" value={name} disabled={pending} onChange={e => setName(e.target.value)} required /></label>
     <label className="ui-field">{t.instructions}<AutoTextarea name="instructions" className="ui-input" value={instructions} disabled={pending} onChange={e => setInstructions(e.target.value)} required /></label>
     <label className="ui-field">{t.voice}<AutoTextarea name="voice" className="ui-input" value={voice} disabled={pending} onChange={e => setVoice(e.target.value)} /></label>
     <div className={styles.actions}><Button type="submit" disabled={pending}>{pending ? t.busy : t.save}</Button>{editing ? <Button disabled={pending} onClick={clearEditor}>{t.cancel}</Button> : null}</div>
    </form>
   </section>
   <section className={`ui-panel ${styles.panel}`}><h2><IconSparkles size={20} aria-hidden="true" /> {t.draft}</h2>
    {items.length ? <form className={styles.form} onSubmit={e => { e.preventDefault(); mutate('draft', selected); }}>
     <label className="ui-field">{t.choose}<select name="agent" className="ui-input" value={selected} disabled={pending} onChange={e => setSelected(e.target.value)} required>{items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     <label className="ui-field">{t.material}<AutoTextarea name="material" className="ui-input" value={text} disabled={pending} onChange={e => setText(e.target.value)} required /></label>
     <label className="ui-field">{t.draft}<select name="kind" className="ui-input" value={kind} disabled={pending} onChange={e => setKind(e.target.value)}><option value="post">{t.post}</option><option value="reply">{t.reply}</option></select></label>
     <Button type="submit" disabled={pending}>{pending ? t.busy : t.draft}</Button>
    </form> : <p>{t.empty}</p>}
    <div aria-live="polite">{suggestion ? <article className={styles.suggestion}><h3>{t.suggestion}</h3><p>{t.review}</p><p className={styles.text}>{suggestion}</p></article> : null}</div>
   </section>
  </div>
  <section className={`ui-panel ${styles.panel}`}><h2>{t.history}</h2>{history.length ? <ol className={styles.list}>{history.map(run => <li key={run.id}><div className={styles.identity}><strong>{run.name ?? t.unknownAgent}</strong><p>{run.kind === 'reply' ? t.reply : t.post} · {run.status === 'completed' ? t.completed : run.status === 'failed' ? t.failedRun : t.pendingRun}</p></div><time dateTime={new Date(run.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(run.createdAt))} {t.timeZone}</time></li>)}</ol> : <p>{t.noHistory}</p>}
   {offset > 0 || more ? <nav className={styles.actions} aria-label={t.history}><Button disabled={pending || offset === 0} onClick={() => start(async () => { try { await refreshHistory(Math.max(0, offset - pageSize)); } catch { setError(t.failed); } })}>{t.previous}</Button><Button disabled={pending || !more} onClick={() => start(async () => { try { await refreshHistory(offset + pageSize); } catch { setError(t.failed); } })}>{t.next}</Button></nav> : null}
  </section>{confirmation}{removal}
 </section>;
}
