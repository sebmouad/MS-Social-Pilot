'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { saveMixConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

type Rule = { labelId: string; perWeek: number };
type StoredRule = Rule & { id: string; targetId: string | null; groupId: string | null; ranDry: boolean };
type Line = { labelId: string; perWeek: number; planned: number; readyDrafts: number };

export function ContentMix({ targets, groups, labels, rules, status, windowDays, maxPerWeek, canEditChannels, canEditGroups }: { targets: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }>; labels: Array<{ id: string; name: string }>; rules: StoredRule[]; status: Array<{ targetId: string; lines: Line[] }>; windowDays: number; maxPerWeek: number; canEditChannels: boolean; canEditGroups: boolean }) {
  const [stored, setStored] = useState(rules);
  const [scopeKey, setScopeKey] = useState('');
  const [draft, setDraft] = useState<Rule[] | null>(null);
  const [review, setReview] = useState(false);
  const action = useAction();
  const scope = scopeKey.startsWith('t:') ? { targetId: scopeKey.slice(2) } : scopeKey.startsWith('g:') ? { groupId: scopeKey.slice(2) } : null;
  const canEdit = scope && ('targetId' in scope ? canEditChannels : canEditGroups);
  const own = scope ? stored.filter(r => ('targetId' in scope ? r.targetId === scope.targetId : r.groupId === scope.groupId)) : [];
  const rows: Rule[] = draft ?? own.map(({ labelId, perWeek }) => ({ labelId, perWeek }));
  const name = (id: string) => labels.find(l => l.id === id)?.name ?? 'Removed label';
  const free = labels.filter(l => !rows.some(r => r.labelId === l.id));
  const confirmation = scope ? saveMixConfirmation(scope) : '';
  const planned = status.filter(s => targets.some(t => t.id === s.targetId));

  async function save() {
    if (!scope) return;
    const ok = await action.run(async () => {
      const result = await send<{ rules: number }>('PUT', '/api/publishing/content-mix', { scope, rules: rows, confirmation });
      if (result.rules !== rows.length) throw new Error('The saved rules could not be verified. Refresh to see the current mix.');
      setStored(s => [...s.filter(r => !('targetId' in scope ? r.targetId === scope.targetId : r.groupId === scope.groupId)), ...rows.map(r => ({ ...r, id: `${scopeKey}:${r.labelId}`, targetId: 'targetId' in scope ? scope.targetId ?? null : null, groupId: 'groupId' in scope ? scope.groupId ?? null : null, ranDry: false }))]);
      setDraft(null);
      return 'Content mix saved.';
    });
    if (ok) setReview(false);
  }

  return <div className={styles.root}>
    {action.banner}
    <section className={styles.section}><h2>Content mix</h2>
      <p className={styles.help}>Say how many posts of each label a channel or group should have scheduled across a rolling {windowDays}-day window. Labels are the categories.</p>
      {planned.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Planned posts against the content mix</caption><thead><tr><th scope="col">Channel</th><th scope="col">Label</th><th scope="col">Planned</th><th scope="col">Target</th><th scope="col">Ready drafts</th></tr></thead>
        <tbody>{planned.flatMap(s => s.lines.map(l => <tr key={`${s.targetId}:${l.labelId}`}><th scope="row">{targets.find(t => t.id === s.targetId)?.name}</th><td>{name(l.labelId)}</td><td>{l.planned}{l.planned < l.perWeek ? ' (short)' : ''}</td><td>{l.perWeek}</td><td>{l.readyDrafts}</td></tr>))}</tbody></table></div>
        : <p className={styles.empty}>No content mix is set up yet.</p>}
    </section>
    <section className={styles.section}><h2>Edit a mix</h2>
      <label className={styles.form}><span className={styles.meta}>Channel or group</span><select value={scopeKey} onChange={e => { setScopeKey(e.target.value); setDraft(null); }} disabled={action.busy}><option value="">Choose…</option>
        <optgroup label="Channels">{targets.map(t => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}</optgroup>{groups.length > 0 && <optgroup label="Groups">{groups.map(g => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}</optgroup>}</select></label>
      {scope && <>
        {rows.length ? <ul className={styles.form}>{rows.map(r => <li key={r.labelId} className={styles.slotRow}><span>{name(r.labelId)}</span>
          <label><span className="sr-only">Posts per week for {name(r.labelId)}</span><input type="number" min={1} max={maxPerWeek} value={r.perWeek} disabled={!canEdit} onChange={e => setDraft(rows.map(x => x.labelId === r.labelId ? { ...x, perWeek: Math.max(1, Math.min(maxPerWeek, Number(e.target.value) || 1)) } : x))} /> per week</label>
          {canEdit && <Button size="sm" variant="danger" onClick={() => setDraft(rows.filter(x => x.labelId !== r.labelId))}>Remove</Button>}</li>)}</ul>
          : <p className={styles.empty}>No rules here yet.</p>}
        {canEdit ? <div className={styles.actions}>
          <label><span className="sr-only">Add a label</span><select value="" onChange={e => e.target.value && setDraft([...rows, { labelId: e.target.value, perWeek: 1 }])}><option value="">Add a label…</option>{free.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <Button variant="primary" disabled={draft === null || action.busy} onClick={() => setReview(true)}>Review changes</Button>{draft && <Button disabled={action.busy} onClick={() => setDraft(null)}>Discard changes</Button>}
        </div> : <p className={styles.help}>{'groupId' in scope ? 'Group mixes can be changed by owners and admins with access to all channels.' : 'Only workspace owners and admins can change the content mix.'}</p>}
      </>}
    </section>
    <ConfirmDialog feedback={action.feedback} open={review} title="Review content mix" description={`This replaces the rules for this ${scope && 'groupId' in scope ? 'group' : 'channel'} with ${rows.length} label rule${rows.length === 1 ? '' : 's'}. No post is created or rescheduled by saving.`} confirmation={confirmation} actionLabel="Save content mix" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()}>
      <ul>{rows.map(r => <li key={r.labelId}>{r.perWeek} × {name(r.labelId)}</li>)}</ul></ConfirmDialog>
  </div>;
}
