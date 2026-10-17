'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { replaceSlotsConfirmation, slotKey } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

type Slot = { dayOfWeek: number; hour: number; minute: number };
type Stored = Slot & { id: string; targetId: string | null };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');
const sorted = (slots: Slot[]) => [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour || a.minute - b.minute);

export function QueueTimes({ slots, targets, canEditShared, canEditChannels, limit }: { slots: Stored[]; targets: Array<{ id: string; name: string }>; canEditShared: boolean; canEditChannels: boolean; limit: number }) {
  const [stored, setStored] = useState(slots);
  const [scope, setScope] = useState<string>('');
  const canEdit = scope === '' ? canEditShared : canEditChannels;
  const current = useMemo(() => stored.filter(s => (scope === '' ? s.targetId === null : s.targetId === scope)), [stored, scope]);
  const [draft, setDraft] = useState<Slot[] | null>(null);
  const [add, setAdd] = useState<Slot>({ dayOfWeek: 1, hour: 9, minute: 0 });
  const [review, setReview] = useState(false);
  const action = useAction();
  const rows = draft ?? sorted(current);
  const targetId = scope === '' ? null : scope;
  const confirmation = replaceSlotsConfirmation(targetId);
  const choose = (value: string) => { setScope(value); setDraft(null); };
  const addTime = () => { if (rows.some(r => slotKey(r) === slotKey(add))) return; setDraft(sorted([...rows, add])); };

  async function save() {
    const ok = await action.run(async () => {
      const result = await send<{ targetId: string | null; count: number }>('PUT', '/api/publishing/queue-slots', { targetId, slots: rows, confirmation });
      if (result.count !== rows.length || result.targetId !== targetId) throw new Error('The saved times could not be verified. Refresh to see the current timetable.');
      setStored(s => [...s.filter(x => x.targetId !== targetId), ...rows.map(r => ({ ...r, id: slotKey(r), targetId }))]);
      setDraft(null);
      return `Queue times saved (${result.count}).`;
    });
    if (ok) setReview(false);
  }

  return <div className={styles.root}>
    {action.banner}
    <section className={styles.section}><h2>Weekly queue times</h2>
      <p className={styles.help}>Queued posts take the next free time. Channels without their own times use the shared ones.</p>
      <label className={styles.form}><span className={styles.meta}>Timetable</span><select value={scope} onChange={e => choose(e.target.value)} disabled={action.busy}><option value="">Shared by all channels</option>{targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {rows.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Queue times</caption><thead><tr><th scope="col">Day</th><th scope="col">Time</th>{canEdit && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{rows.map(r => <tr key={slotKey(r)}><th scope="row">{DAYS[r.dayOfWeek]}</th><td>{pad(r.hour)}:{pad(r.minute)}</td>{canEdit && <td><Button size="sm" variant="danger" disabled={action.busy} onClick={() => setDraft(rows.filter(x => slotKey(x) !== slotKey(r)))}>Remove</Button></td>}</tr>)}</tbody></table></div>
        : <p className={styles.empty}>{scope === '' ? 'No shared queue times yet.' : 'This channel has no own times and follows the shared timetable.'}</p>}
      {canEdit ? <form className={styles.slotRow} onSubmit={e => { e.preventDefault(); addTime(); }}>
        <label className={styles.form}><span className={styles.meta}>Day</span><select value={add.dayOfWeek} onChange={e => setAdd(a => ({ ...a, dayOfWeek: Number(e.target.value) }))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
        <label className={styles.form}><span className={styles.meta}>Time</span><input type="time" required value={`${pad(add.hour)}:${pad(add.minute)}`} onChange={e => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isInteger(h) && Number.isInteger(m)) setAdd(a => ({ ...a, hour: h!, minute: m! })); }} /></label>
        <Button type="submit" disabled={action.busy || rows.length >= limit}>Add time</Button>
      </form> : <p className={styles.help}>Only workspace owners and admins can change queue times{scope === '' ? ' for all channels' : ''}.</p>}
      {canEdit && <div className={styles.actions}><Button variant="primary" disabled={draft === null || action.busy} onClick={() => setReview(true)}>Review changes</Button>{draft && <Button disabled={action.busy} onClick={() => setDraft(null)}>Discard changes</Button>}</div>}
    </section>
    <ConfirmDialog feedback={action.feedback} open={review} title="Review queue times" description={`This replaces the ${scope === '' ? 'shared' : 'channel'} timetable with ${rows.length} time${rows.length === 1 ? '' : 's'}. Posts already scheduled keep their time.`} confirmation={confirmation} actionLabel="Save queue times" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()} />
  </div>;
}
