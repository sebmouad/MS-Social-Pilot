'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { SidebarDock } from '@/components/SidebarDock';
import { replaceSlotsConfirmation, slotKey } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

type Slot = { dayOfWeek: number; hour: number; minute: number };
type Stored = Slot & { id: string; targetId: string | null };
type AddInput = { dayOfWeek: number; time: string };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');
const sorted = (slots: Slot[]) => [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute);
const scopeKey = (scope: string) => scope || 'shared';

export function QueueTimes({ slots, targets, canEditShared, canEditChannels, limit, initialSlot, timeZone }: { slots: Stored[]; targets: Array<{ id: string; name: string }>; canEditShared: boolean; canEditChannels: boolean; limit: number; initialSlot: Slot; timeZone: string }) {
  const [stored, setStored] = useState(slots);
  const [scope, setScope] = useState('');
  const canEdit = scope === '' ? canEditShared : canEditChannels;
  const current = useMemo(() => stored.filter(s => (scope === '' ? s.targetId === null : s.targetId === scope)), [stored, scope]);
  const [drafts, setDrafts] = useState<Record<string, Slot[]>>({});
  const [addInputs, setAddInputs] = useState<Record<string, AddInput>>({});
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const draft = drafts[scopeKey(scope)] ?? null;
  const initialAdd: AddInput = { dayOfWeek: initialSlot.dayOfWeek, time: `${pad(initialSlot.hour)}:${pad(initialSlot.minute)}` };
  const add = addInputs[scopeKey(scope)] ?? initialAdd;
  const rows = draft ?? sorted(current);
  const targetId = scope === '' ? null : scope;
  const confirmation = replaceSlotsConfirmation(targetId);
  const action = useAction();
  const timeErrorId = `queue-time-error-${scopeKey(scope)}`;
  const setRowsDraft = (next: Slot[]) => setDrafts(values => ({ ...values, [scopeKey(scope)]: sorted(next) }));
  const resetCurrentDraft = () => {
    setDrafts(values => { const next = { ...values }; delete next[scopeKey(scope)]; return next; });
    setAddInputs(values => { const next = { ...values }; delete next[scopeKey(scope)]; return next; });
    setAddErrors(values => { const next = { ...values }; delete next[scopeKey(scope)]; return next; });
  };
  const changeAdd = (next: AddInput) => {
    setAddInputs(values => ({ ...values, [scopeKey(scope)]: next }));
    setAddErrors(values => { const result = { ...values }; delete result[scopeKey(scope)]; return result; });
  };
  const addTime = () => {
    const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(add.time);
    if (!match) { setAddErrors(values => ({ ...values, [scopeKey(scope)]: 'Enter a valid time before adding this slot.' })); return; }
    const [hour, minute] = add.time.split(':').map(Number);
    const next = { dayOfWeek: add.dayOfWeek, hour: hour!, minute: minute! };
    if (rows.some(row => slotKey(row) === slotKey(next))) { setAddErrors(values => ({ ...values, [scopeKey(scope)]: 'That time is already in this timetable.' })); return; }
    setRowsDraft([...rows, next]);
    changeAdd(initialAdd);
  };

  async function save() {
    const savedScope = scope;
    const savedTargetId = targetId;
    const savedRows = rows;
    const ok = await action.run(async () => {
      const result = await send<{ targetId: string | null; count: number }>('PUT', '/api/publishing/queue-slots', { targetId: savedTargetId, slots: savedRows, confirmation: replaceSlotsConfirmation(savedTargetId) });
      if (result.count !== savedRows.length || result.targetId !== savedTargetId) throw new Error('The saved times could not be verified. Refresh to see the current timetable.');
      setStored(existing => [...existing.filter(item => item.targetId !== savedTargetId), ...savedRows.map(row => ({ ...row, id: slotKey(row), targetId: savedTargetId }))]);
      setDrafts(values => { const next = { ...values }; delete next[scopeKey(savedScope)]; return next; });
      setAddInputs(values => { const next = { ...values }; delete next[scopeKey(savedScope)]; return next; });
      setAddErrors(values => { const next = { ...values }; delete next[scopeKey(savedScope)]; return next; });
      return `Queue times saved (${result.count}).`;
    });
    if (ok) setReview(false);
  }

  const unsaved = (value: string) => Boolean(drafts[scopeKey(value)]);
  return <div className={styles.root}>
    <SidebarDock><section className={styles.section} aria-label="Queue timetable selection">
      <h2>Timetable</h2>
      <label className={styles.form}><span className={styles.meta}>Apply times for</span><select value={scope} onChange={event => setScope(event.currentTarget.value)} disabled={action.busy}>
        <option value="">Shared by all channels{unsaved('') ? ' · Unsaved changes' : ''}</option>
        {targets.map(target => <option key={target.id} value={target.id}>{target.name}{unsaved(target.id) ? ' · Unsaved changes' : ''}</option>)}
      </select></label>
      <p className={styles.help}>Times use {timeZone.replaceAll('_', ' ')}. Shared times are available to every channel. A channel’s own times are additional; a post for multiple channels can use one only when every selected channel has that same time.</p>
    </section></SidebarDock>
    <div>{action.banner}</div>
    <section className={styles.section}><h2>{scope === '' ? 'Shared queue times' : `${targets.find(target => target.id === scope)?.name ?? 'Channel'} queue times`}</h2>
      <p className={styles.help}>Queued posts take the next available saved time. Saving changes affects future queue placements; posts already scheduled keep their time.</p>
      <p className={styles.help}>The workspace timezone is {timeZone.replaceAll('_', ' ')}.</p>
      {rows.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{scope === '' ? 'Shared queue times' : 'Channel queue times'}</caption><thead><tr><th scope="col">Day</th><th scope="col">Time</th>{canEdit && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={slotKey(row)}><th scope="row">{DAYS[row.dayOfWeek]}</th><td>{pad(row.hour)}:{pad(row.minute)}</td>{canEdit && <td><Button size="sm" variant="danger" disabled={action.busy} onClick={() => setRowsDraft(rows.filter(item => slotKey(item) !== slotKey(row)))}>Remove</Button></td>}</tr>)}</tbody></table></div>
        : <p className={styles.empty}>{scope === '' ? 'No shared queue times yet.' : 'This channel has no own times and currently uses the shared times.'}</p>}
      {canEdit ? <form noValidate className={styles.slotRow} onSubmit={event => { event.preventDefault(); if (!action.busy && rows.length < limit) addTime(); }}>
        <label className={styles.form}><span className={styles.meta}>Day</span><select value={add.dayOfWeek} disabled={action.busy} onChange={event => changeAdd({ ...add, dayOfWeek: Number(event.currentTarget.value) })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
        <label className={styles.form}><span className={styles.meta}>Time ({timeZone.replaceAll('_', ' ')})</span><input type="time" value={add.time} disabled={action.busy} aria-invalid={Boolean(addErrors[scopeKey(scope)])} aria-describedby={addErrors[scopeKey(scope)] ? timeErrorId : undefined} onChange={event => changeAdd({ ...add, time: event.currentTarget.value })} /></label>
        <Button type="submit" disabled={action.busy || rows.length >= limit}>Add time</Button>
        {addErrors[scopeKey(scope)] ? <p id={timeErrorId} className="ui-field-error" role="alert">{addErrors[scopeKey(scope)]}</p> : null}
        {rows.length >= limit ? <p className={styles.help}>This timetable has reached its limit of {limit} times.</p> : null}
      </form> : <p className={styles.help}>Only workspace owners and admins can change queue times{scope === '' ? ' for all channels' : ''}.</p>}
      {canEdit && <div className={styles.actions}><Button variant="primary" disabled={draft === null || action.busy} onClick={() => setReview(true)}>Review changes</Button>{draft && <Button disabled={action.busy} onClick={resetCurrentDraft}>Discard changes</Button>}</div>}
    </section>
    <ConfirmDialog feedback={action.feedback} open={review} title="Review queue times" confirmationMode="review" description={`This replaces the ${scope === '' ? 'shared' : targets.find(target => target.id === scope)?.name ?? 'selected channel'} timetable with ${rows.length} time${rows.length === 1 ? '' : 's'}. Posts already scheduled keep their time.`} confirmation={confirmation} actionLabel="Save queue times" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()}><ul>{rows.map(row => <li key={slotKey(row)}>{DAYS[row.dayOfWeek]} {pad(row.hour)}:{pad(row.minute)} {timeZone.replaceAll('_', ' ')}</li>)}</ul></ConfirmDialog>
  </div>;
}
