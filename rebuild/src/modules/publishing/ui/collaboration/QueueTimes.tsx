'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { replaceSlotsConfirmation, slotKey } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';
import { useCollaborationCopy } from '../compose/CopyProvider';
import { fillComposerCopy } from '../../composer-catalog';

type Slot = { dayOfWeek: number; hour: number; minute: number };
type Stored = Slot & { id: string; targetId: string | null };
type AddInput = { dayOfWeek: number; time: string };

const pad = (n: number) => String(n).padStart(2, '0');
const sorted = (slots: Slot[]) => [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute);
const scopeKey = (scope: string) => scope || 'shared';

export function QueueTimes({ slots, targets, canEditShared, canEditChannels, limit, initialSlot, timeZone }: { slots: Stored[]; targets: Array<{ id: string; name: string }>; canEditShared: boolean; canEditChannels: boolean; limit: number; initialSlot: Slot; timeZone: string }) {
  const c = useCollaborationCopy();
  const DAYS = [c.day0, c.day1, c.day2, c.day3, c.day4, c.day5, c.day6];
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
    if (!match) { setAddErrors(values => ({ ...values, [scopeKey(scope)]: c.enter_a_valid_time_before_adding_this_slot })); return; }
    const [hour, minute] = add.time.split(':').map(Number);
    const next = { dayOfWeek: add.dayOfWeek, hour: hour!, minute: minute! };
    if (rows.some(row => slotKey(row) === slotKey(next))) { setAddErrors(values => ({ ...values, [scopeKey(scope)]: c.that_time_is_already_in_this_timetable })); return; }
    setRowsDraft([...rows, next]);
    changeAdd(initialAdd);
  };

  async function save() {
    const savedScope = scope;
    const savedTargetId = targetId;
    const savedRows = rows;
    const ok = await action.run(async () => {
      const result = await action.send<{ targetId: string | null; count: number }>('PUT', '/api/publishing/queue-slots', { targetId: savedTargetId, slots: savedRows, confirmation: replaceSlotsConfirmation(savedTargetId) });
      if (result.count !== savedRows.length || result.targetId !== savedTargetId) throw new Error(c.the_saved_times_could_not_be_verified_refresh_to_see_the_current);
      setStored(existing => [...existing.filter(item => item.targetId !== savedTargetId), ...savedRows.map(row => ({ ...row, id: slotKey(row), targetId: savedTargetId }))]);
      setDrafts(values => { const next = { ...values }; delete next[scopeKey(savedScope)]; return next; });
      setAddInputs(values => { const next = { ...values }; delete next[scopeKey(savedScope)]; return next; });
      setAddErrors(values => { const next = { ...values }; delete next[scopeKey(savedScope)]; return next; });
      return fillComposerCopy(c.queueSaved, { count: result.count });
    });
    if (ok) setReview(false);
  }

  const unsaved = (value: string) => Boolean(drafts[scopeKey(value)]);
  return <div className={styles.root}>
    <section className={styles.section} aria-label={c.queue_timetable_selection}>
      <h2>{c.timetable}</h2>
      <label className={styles.form}><span className={styles.meta}>{c.apply_times_for}</span><select value={scope} onChange={event => setScope(event.currentTarget.value)} disabled={action.busy}>
        <option value="">{c.sharedChannels}{unsaved('') ? c.unsaved_changes : ''}</option>
        {targets.map(target => <option key={target.id} value={target.id}>{target.name}{unsaved(target.id) ? c.unsaved_changes : ''}</option>)}
      </select></label>
      <p className={styles.help}>{fillComposerCopy(c.queueZoneHelp, { zone: timeZone.replaceAll('_', ' ') })}</p>
    </section>
    <div>{action.banner}</div>
    <section className={styles.section}><h2>{scope === '' ? c.shared_queue_times : fillComposerCopy(c.channelQueueTitle, { name: targets.find(target => target.id === scope)?.name ?? c.channel })}</h2>
      <p className={styles.help}>{c.queued_posts_take_the_next_available_saved_time_saving_changes_affects_future}</p>
      <p className={styles.help}>{fillComposerCopy(c.workspaceZone, { zone: timeZone.replaceAll('_', ' ') })}</p>
      {rows.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{scope === '' ? c.shared_queue_times : c.channel_queue_times}</caption><thead><tr><th scope="col">{c.day}</th><th scope="col">{c.time}</th>{canEdit && <th scope="col">{c.actions}</th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={slotKey(row)}><th scope="row">{DAYS[row.dayOfWeek]}</th><td>{pad(row.hour)}:{pad(row.minute)}</td>{canEdit && <td><Button size="sm" variant="danger" disabled={action.busy} onClick={() => setRowsDraft(rows.filter(item => slotKey(item) !== slotKey(row)))}>{c.remove}</Button></td>}</tr>)}</tbody></table></div>
        : <p className={styles.empty}>{scope === '' ? c.no_shared_queue_times_yet : c.this_channel_has_no_own_times_and_currently_uses_the_shared_times}</p>}
      {canEdit ? <form noValidate className={styles.slotRow} onSubmit={event => { event.preventDefault(); if (!action.busy && rows.length < limit) addTime(); }}>
        <label className={styles.form}><span className={styles.meta}>{c.day}</span><select value={add.dayOfWeek} disabled={action.busy} onChange={event => changeAdd({ ...add, dayOfWeek: Number(event.currentTarget.value) })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
        <label className={styles.form}><span className={styles.meta}>{fillComposerCopy(c.timeZoneLabel, { zone: timeZone.replaceAll('_', ' ') })}</span><input type="time" value={add.time} disabled={action.busy} aria-invalid={Boolean(addErrors[scopeKey(scope)])} aria-describedby={addErrors[scopeKey(scope)] ? timeErrorId : undefined} onChange={event => changeAdd({ ...add, time: event.currentTarget.value })} /></label>
        <Button type="submit" disabled={action.busy || rows.length >= limit}>{c.add_time}</Button>
        {addErrors[scopeKey(scope)] ? <p id={timeErrorId} className="ui-field-error" role="alert">{addErrors[scopeKey(scope)]}</p> : null}
        {rows.length >= limit ? <p className={styles.help}>{fillComposerCopy(c.queueLimit, { max: limit })}</p> : null}
      </form> : <p className={styles.help}>{fillComposerCopy(c.queuePermissions, { scope: scope === '' ? c.for_all_channels : '' })}</p>}
      {canEdit && <div className={styles.actions}><Button variant="primary" disabled={draft === null || action.busy} onClick={() => setReview(true)}>{c.review_changes}</Button>{draft && <Button disabled={action.busy} onClick={resetCurrentDraft}>{c.discard_changes}</Button>}</div>}
    </section>
    <ConfirmDialog feedback={action.feedback} open={review} title={c.review_queue_times} confirmationMode="review" description={fillComposerCopy(c.queueReview, { scope: scope === '' ? c.shared : targets.find(target => target.id === scope)?.name ?? c.selected_channel, count: rows.length, plural: rows.length === 1 ? '' : 's' })} confirmation={confirmation} actionLabel={c.save_queue_times} busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()}><ul>{rows.map(row => <li key={slotKey(row)}>{DAYS[row.dayOfWeek]} {pad(row.hour)}:{pad(row.minute)} {timeZone.replaceAll('_', ' ')}</li>)}</ul></ConfirmDialog>
  </div>;
}
