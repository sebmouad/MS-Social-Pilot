'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { SidebarDock } from '@/components/SidebarDock';
import { mixAutoFillConfirmation, saveMixConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

type Rule = { labelId: string; perWeek: number | '' };
type StoredRule = { labelId: string; perWeek: number; id: string; targetId: string | null; groupId: string | null; ranDry: boolean };
type Line = { labelId: string; perWeek: number; planned: number; readyDrafts: number };
const keyFor = (key: string) => key || 'none';

export function ContentMix({ targets, groups, labels, rules, status, windowDays, maxPerWeek, mixAutoFill, canEditChannels, canEditGroups, canEditAutoFill }: { targets: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }>; labels: Array<{ id: string; name: string }>; rules: StoredRule[]; status: Array<{ targetId: string; lines: Line[] }>; windowDays: number; maxPerWeek: number; mixAutoFill: boolean; canEditChannels: boolean; canEditGroups: boolean; canEditAutoFill: boolean }) {
  const [stored, setStored] = useState(rules);
  const [scopeKey, setScopeKey] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Rule[]>>({});
  const [review, setReview] = useState(false);
  const [autoFillReview, setAutoFillReview] = useState(false);
  const [autoFillEnabled, setAutoFillEnabled] = useState(mixAutoFill);
  const [autoFillDesired, setAutoFillDesired] = useState(mixAutoFill);
  const action = useAction();
  const scope = scopeKey.startsWith('t:') ? { targetId: scopeKey.slice(2) } : scopeKey.startsWith('g:') ? { groupId: scopeKey.slice(2) } : null;
  const canEdit = scope && ('targetId' in scope ? canEditChannels : canEditGroups);
  const own = scope ? stored.filter(r => ('targetId' in scope ? r.targetId === scope.targetId : r.groupId === scope.groupId)) : [];
  const draftKey = keyFor(scopeKey);
  const rows: Rule[] = drafts[draftKey] ?? own.map(({ labelId, perWeek }) => ({ labelId, perWeek }));
  const name = (id: string) => labels.find(l => l.id === id)?.name ?? 'Removed label';
  const free = labels.filter(l => !rows.some(r => r.labelId === l.id));
  const confirmation = scope ? saveMixConfirmation(scope) : '';
  const planned = status.filter(s => targets.some(t => t.id === s.targetId));
  const invalidRows = rows.filter(r => typeof r.perWeek !== 'number' || !Number.isInteger(r.perWeek) || r.perWeek < 1 || r.perWeek > maxPerWeek);
  const setRows = (next: Rule[]) => setDrafts(current => ({ ...current, [draftKey]: next }));
  const discard = () => setDrafts(current => { const next = { ...current }; delete next[draftKey]; return next; });

  async function save() {
    if (!scope || invalidRows.length) return;
    const savedScope = scope;
    const savedKey = draftKey;
    const savedRows = rows as Array<{ labelId: string; perWeek: number }>;
    const ok = await action.run(async () => {
      const result = await send<{ rules: number }>('PUT', '/api/publishing/content-mix', { scope: savedScope, rules: savedRows, confirmation: saveMixConfirmation(savedScope) });
      if (result.rules !== savedRows.length) throw new Error('The saved rules could not be verified. Refresh to see the current mix.');
      setStored(current => [...current.filter(r => !('targetId' in savedScope ? r.targetId === savedScope.targetId : r.groupId === savedScope.groupId)), ...savedRows.map(r => ({ ...r, id: `${savedKey}:${r.labelId}`, targetId: 'targetId' in savedScope ? savedScope.targetId ?? null : null, groupId: 'groupId' in savedScope ? savedScope.groupId ?? null : null, ranDry: false }))]);
      setDrafts(current => { const next = { ...current }; delete next[savedKey]; return next; });
      return 'Content mix saved.';
    });
    if (ok) setReview(false);
  }

  async function saveAutoFill() {
    const desired = autoFillDesired;
    const ok = await action.run(async () => {
      const result = await send<{ enabled: boolean }>('PUT', '/api/publishing/content-mix', { action: 'setAutoFill', enabled: desired, confirmation: mixAutoFillConfirmation(desired) });
      if (result.enabled !== desired) throw new Error('The setting could not be verified. Refresh to check its current state.');
      setAutoFillEnabled(desired);
      return desired ? 'Automatic content-mix scheduling is on.' : 'Automatic content-mix scheduling is off.';
    });
    if (ok) setAutoFillReview(false);
  }

  return <div className={styles.root}>
    <SidebarDock>
      <section className={styles.section} aria-label="Content-mix controls">
        <h2>Content mix</h2>
        <label className={styles.form}><span className={styles.meta}>Edit a channel or group</span><select value={scopeKey} onChange={e => setScopeKey(e.target.value)} disabled={action.busy}><option value="">Choose…</option>
          <optgroup label="Channels">{targets.map(t => <option key={t.id} value={`t:${t.id}`}>{t.name}{drafts[keyFor(`t:${t.id}`)] ? ' · Unsaved changes' : ''}</option>)}</optgroup>{groups.length > 0 && <optgroup label="Groups">{groups.map(g => <option key={g.id} value={`g:${g.id}`}>{g.name}{drafts[keyFor(`g:${g.id}`)] ? ' · Unsaved changes' : ''}</option>)}</optgroup>}</select></label>
        <p className={styles.help}>Rules set weekly label targets across a rolling {windowDays}-day window.</p>
      </section>
      <section className={styles.section} aria-label="Automatic content-mix scheduling">
        <h2>Automatic scheduling</h2>
        <p className={styles.help}>{autoFillEnabled ? 'When enabled, the scheduler can add eligible drafts to fill unmet content-mix targets.' : 'Off. Saving mix rules alone never schedules posts.'}</p>
        {canEditAutoFill ? <>
          <label className={styles.check}><input type="checkbox" checked={autoFillDesired} disabled={action.busy} onChange={e => setAutoFillDesired(e.target.checked)} />Enable automatic scheduling</label>
          {autoFillDesired !== autoFillEnabled && <div className={styles.actions}><Button variant="primary" disabled={action.busy} onClick={() => setAutoFillReview(true)}>Review setting</Button><Button disabled={action.busy} onClick={() => setAutoFillDesired(autoFillEnabled)}>Discard</Button></div>}
        </> : <p className={styles.help}>Only workspace owners and admins with access to all channels can change this setting.</p>}
      </section>
    </SidebarDock>
    {action.banner}
    <section className={styles.section}><h2>Planned posts</h2>
      <p className={styles.help}>Counts include only posts whose full destination set is visible to you. Ready drafts have passed the workspace approval requirement.</p>
      {planned.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Planned posts against the content mix</caption><thead><tr><th scope="col">Channel</th><th scope="col">Label</th><th scope="col">Planned</th><th scope="col">Target</th><th scope="col">Ready drafts</th></tr></thead>
        <tbody>{planned.flatMap(s => s.lines.map(l => <tr key={`${s.targetId}:${l.labelId}`}><th scope="row">{targets.find(t => t.id === s.targetId)?.name}</th><td>{name(l.labelId)}</td><td>{l.planned}{l.planned < l.perWeek ? ' (short)' : ''}</td><td>{l.perWeek}</td><td>{l.readyDrafts}</td></tr>))}</tbody></table></div>
        : <p className={styles.empty}>No content mix is set up yet.</p>}
    </section>
    <section className={styles.section}><h2>{scope ? `Rules for ${'groupId' in scope ? groups.find(g => g.id === scope.groupId)?.name ?? 'group' : targets.find(t => t.id === scope.targetId)?.name ?? 'channel'}` : 'Edit mix rules'}</h2>
      {scope ? <>
        {rows.length ? <ul className={styles.form}>{rows.map((r, index) => <li key={r.labelId} className={styles.slotRow}><span>{name(r.labelId)}</span>
          <label><span className="sr-only">Posts per week for {name(r.labelId)}</span><input type="number" min={1} max={maxPerWeek} step={1} value={r.perWeek} disabled={!canEdit || action.busy} aria-invalid={r.perWeek === '' || invalidRows.includes(r)} aria-describedby={r.perWeek === '' || invalidRows.includes(r) ? `mix-rule-error-${index}` : undefined} onChange={e => setRows(rows.map(x => x.labelId === r.labelId ? { ...x, perWeek: e.target.value === '' ? '' : Number(e.target.value) } : x))} /> per week</label>
          {canEdit && <Button size="sm" variant="danger" disabled={action.busy} onClick={() => setRows(rows.filter(x => x.labelId !== r.labelId))}>Remove</Button>}
          {(r.perWeek === '' || invalidRows.includes(r)) && <p id={`mix-rule-error-${index}`} className="ui-field-error" role="alert">Enter a whole number from 1 to {maxPerWeek}.</p>}
        </li>)}</ul>
          : <p className={styles.empty}>No rules here yet.</p>}
        {canEdit ? <div className={styles.actions}>
          <label><span className="sr-only">Add a label</span><select value="" disabled={action.busy || free.length === 0} onChange={e => e.target.value && setRows([...rows, { labelId: e.target.value, perWeek: 1 }])}><option value="">Add a label…</option>{free.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <Button variant="primary" disabled={drafts[draftKey] === undefined || action.busy || invalidRows.length > 0} onClick={() => setReview(true)}>Review changes</Button>{drafts[draftKey] !== undefined && <Button disabled={action.busy} onClick={discard}>Discard changes</Button>}
        </div> : <p className={styles.help}>{'groupId' in scope ? 'Group mixes can be changed by owners and admins with access to all channels.' : 'Only workspace owners and admins can change the content mix.'}</p>}
      </> : <p className={styles.empty}>Choose a channel or group from the sidebar to review its rules.</p>}
    </section>
    <ConfirmDialog feedback={action.feedback} open={review} confirmationMode="review" title="Review content mix" description={`This replaces the rules for this ${scope && 'groupId' in scope ? 'group' : 'channel'} with ${rows.length} label rule${rows.length === 1 ? '' : 's'}. No post is created or rescheduled by saving.`} confirmation={confirmation} actionLabel="Save content mix" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()}>
      <ul>{rows.map(r => <li key={r.labelId}>{r.perWeek || 'Invalid target'} per week · {name(r.labelId)}</li>)}</ul></ConfirmDialog>
    <ConfirmDialog feedback={action.feedback} open={autoFillReview} confirmationMode="review" title={`${autoFillDesired ? 'Enable' : 'Disable'} automatic scheduling?`} description={autoFillDesired ? 'Eligible drafts may be scheduled by the content-mix automation. Saving mix rules by itself does not enable this setting.' : 'The content-mix automation will stop scheduling new posts. Existing scheduled posts keep their current times.'} confirmation={mixAutoFillConfirmation(autoFillDesired)} actionLabel={autoFillDesired ? 'Enable scheduling' : 'Disable scheduling'} busy={action.busy} onCancel={() => { setAutoFillReview(false); setAutoFillDesired(autoFillEnabled); }} onConfirm={() => void saveAutoFill()} />
  </div>;
}
