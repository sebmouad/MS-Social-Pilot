'use client';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconCalendarEvent, IconSun, IconRss, IconNotes, IconTrendingUp, IconPlus } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { Dialog } from '@/components/Dialog';
import { useConfirm } from '@/components/useConfirm';
import { useFormValidation, FieldError } from '@/components/FormValidation';
import type { Copy } from '../copy';
import type { Policy } from '../config';
import { AREAS, type Area, type Feed, type KeyDate, type Note, type Season, type Locale } from '../contracts';
import { confirmation } from '../server/validation';
import { calendarAction } from './actions';
import { CALENDAR_EXTRAS_SCREENS } from '../manifest';
import styles from './calendar-extras.module.css';
export const paths = Object.fromEntries(AREAS.map(area => [area, CALENDAR_EXTRAS_SCREENS[area].href])) as Record<Area, string>;
const icons = { dates: IconCalendarEvent, seasons: IconSun, feeds: IconRss, notes: IconNotes, trends: IconTrendingUp };
type Row = KeyDate | Season | Note | Feed;
export type WorkspaceProps = {
 area: Area; workspaceId: string; locale: Locale; policy: Policy; copy: Copy; channels: Array<{ id: string; name: string }>; allChannels: boolean; canWrite: boolean;
 groups?: Array<{ id: string; name: string }>; rows: Row[]; hasMore: boolean; offset: number; limit: number; from: string; to: string; targetId: string; showAll?: boolean; error?: string; children?: ReactNode;
};
export function CalendarTools(props: Pick<WorkspaceProps, 'area' | 'copy' | 'from' | 'to' | 'targetId' | 'channels' | 'showAll'>) {
 const { area, copy: c } = props;
 return <div className={styles.tools}>
  <nav aria-label={c.dates}>{AREAS.map(a => { const Icon = icons[a]; return <a key={a} href={paths[a]} aria-current={a === area ? 'page' : undefined}><Icon size={18} aria-hidden="true" />{c[a]}</a>; })}</nav>
  <form className={styles.tools} action={paths[area]}>
   <label className="ui-field"><span>{c.from}</span><input className="ui-input" type="text" inputMode="numeric" name="from" defaultValue={props.from} autoComplete="off" /></label>
   <label className="ui-field"><span>{c.to}</span><input className="ui-input" type="text" inputMode="numeric" name="to" defaultValue={props.to} autoComplete="off" /></label>
   <label className="ui-field"><span>{c.channels}</span><select className="ui-input" name="targetId" defaultValue={props.targetId}><option value="">{c.allChannels}</option>{props.targetId && !props.channels.some(ch => ch.id === props.targetId) && <option value={props.targetId}>{c.unknown}</option>}{props.channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}</select></label>
   {area === 'trends' && <label className={styles.choice}><input type="checkbox" name="showAll" value="true" defaultChecked={props.showAll} />{c.showAll}</label>}
   <Button type="submit">{c.apply}</Button>
  </form>
 </div>;
}
export function CalendarWorkspace(props: WorkspaceProps) {
 const { area, copy: c, policy, rows, channels, canWrite } = props;
 const router = useRouter();
 const [editor, setEditor] = useState<Row | 'new' | null>(null);
 const [notice, setNotice] = useState('');
 const [address, setAddress] = useState('');
 const [ask, dialog] = useConfirm({ title: c.review, cancel: c.cancel, confirm: area === 'feeds' ? c.revoke : c.remove });
 const noticeRef = useRef<HTMLParagraphElement>(null);
 const fmt = (day: string) => new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
 const Icon = icons[area];
 const pager = (offset: number) => `${paths[area]}?${new URLSearchParams({ from: props.from, to: props.to, offset: String(offset), ...(props.showAll ? { showAll: 'true' } : {}), ...(props.targetId ? { targetId: props.targetId } : {}) })}`;
 async function remove(row: Row) {
  await ask(`${area === 'feeds' ? c.revoke : c.remove}: ${'title' in row ? row.title : 'label' in row ? row.label : row.name}`, {
   exactConfirmation: confirmation(area, 'delete', row.id), confirmationLabel: c.confirmation, pendingLabel: c.saving, failureLabel: c.failure,
   onConfirm: async () => {
    const result = await calendarAction(area, { operation: 'delete', id: row.id, confirmation: confirmation(area, 'delete', row.id) });
    if (!result.ok) return result.error;
    if (result.receipt.confirmed !== true || result.receipt.id !== row.id || result.receipt.operation !== 'delete' || result.receipt.area !== area) return c.failure;
    setNotice(c.saved); router.refresh(); return null;
   },
  });
 }
 return <div className={styles.workspace} data-module={area === 'notes' ? 'analytics' : 'publishing'}>
  <CalendarTools {...props} />
  <PageHeader module={area === 'notes' ? 'analytics' : 'publishing'} icon={<Icon size={22} />} title={c[area]} description={c[`${area}Hint`]} actions={canWrite && area !== 'trends' ? <Button variant="primary" leading={<IconPlus size={18} />} onClick={() => { setAddress(''); setEditor('new'); }}>{c.add}</Button> : undefined} />
  {props.error && <p role="alert" className="ui-error">{props.error}</p>}
  {!canWrite && <p className={styles.meta}>{c.readOnly}</p>}
  {notice && <p role="status" tabIndex={-1} ref={noticeRef}>{notice}</p>}
  {address && <section className={styles.panel}><h2>{c.privateAddress}</h2><p className={styles.meta}>{c.copyAddress}</p><textarea className={styles.address} aria-label={c.privateAddress} value={address} readOnly onFocus={e => e.currentTarget.select()} /></section>}
  {area === 'seasons' && <p className={styles.notice}>{c.seasonNotice}</p>}
  {props.children}
  {area !== 'trends' && <section className={styles.panel} aria-label={c[area]}>
   {rows.length === 0 ? <p className={styles.meta}>{c.noMatches}</p> : <ul className={styles.agenda}>{rows.map(row => {
    const date = 'date' in row ? row.date : 'startsOn' in row ? row.startsOn : 'day' in row ? row.day : null;
    const title = 'title' in row ? row.title : 'label' in row ? row.label : row.name;
    const ids = 'targetIds' in row ? row.targetIds : 'targetId' in row ? row.targetId ? [row.targetId] : [] : row.pageIds;
    return <li className={styles.row} key={row.id}>
     <time dateTime={date ?? undefined}>{date ? fmt(date) : c.updated}</time>
     <div><h3>{title}</h3><p className={styles.meta}>{ids.length ? ids.map(id => channels.find(ch => ch.id === id)?.name ?? c.unknown).join(', ') : c.allChannels}</p>
      {'yearly' in row && row.yearly && <p className={styles.meta}>{c.yearly}</p>}
      {'rule' in row && <p className={styles.meta}>{c[row.rule]} · {fmt(row.endsOn)}{row.rule === 'shift' ? ` · ${row.shiftMinutes} ${c.shiftMinutes}` : row.rule === 'more' ? ` · ${row.extraTimes.join(', ')}` : ''}</p>}
      {'lastUsedAt' in row && <p className={styles.meta}>{row.lastUsedAt ? new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(row.lastUsedAt)) : c.never}</p>}
     </div>
     {canWrite && <div className={styles.actions}>{area !== 'feeds' && <Button size="sm" onClick={() => setEditor(row)} aria-label={`${c.edit}: ${title}`}>{c.edit}</Button>}<Button variant="quiet" size="sm" onClick={() => void remove(row)} aria-label={`${area === 'feeds' ? c.revoke : c.remove}: ${title}`}>{area === 'feeds' ? c.revoke : c.remove}</Button></div>}
    </li>;
   })}</ul>}
  </section>}
  {(props.offset > 0 || props.hasMore) && <nav className={styles.pager} aria-label={c[area]}>{props.offset > 0 ? <a className="ui-button ui-button--secondary" href={pager(Math.max(0, props.offset - props.limit))}>{c.previous}</a> : <span />}{props.hasMore && <a className="ui-button ui-button--secondary" href={pager(props.offset + props.limit)}>{c.next}</a>}</nav>}
  {editor && <EntryEditor key={typeof editor === 'string' ? editor : editor.id} {...props} entry={editor} onClose={() => setEditor(null)} onSaved={url => { setEditor(null); setAddress(url ?? ''); setNotice(c.saved); router.refresh(); requestAnimationFrame(() => noticeRef.current?.focus()); }} />}
  {dialog}
 </div>;
}
function EntryEditor(props: WorkspaceProps & { entry: Row | 'new'; onClose: () => void; onSaved: (url?: string) => void }) {
 const { area, copy: c, policy: p, entry } = props;
 const existing = entry === 'new' ? null : entry;
 const operation = existing ? 'update' : 'create';
 const exact = confirmation(area, operation, existing?.id ?? props.workspaceId);
 const id = useId();
 const [busy, setBusy] = useState(false);
 const [uncertain, setUncertain] = useState(false);
 const [error, setError] = useState('');
 const pending = useRef(false);
 const errorRef = useRef<HTMLParagraphElement>(null);
 const validation = useFormValidation();
 const field = (name: string, label: string, type = 'text', value?: string | number) => <label className="ui-field"><span>{label}</span><input {...validation.fieldProps(name)} className="ui-input" name={name} type={type} defaultValue={value} required maxLength={type === 'text' ? p.maxTitle : undefined} min={name === 'shiftMinutes' ? -p.maxShiftMinutes : undefined} max={name === 'shiftMinutes' ? p.maxShiftMinutes : undefined} autoComplete="off" /><FieldError {...validation.errorProps(name)} /></label>;
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (pending.current || uncertain) return;
  const form = event.currentTarget;
  const controls = Array.from(form.elements).filter((e): e is HTMLInputElement => e instanceof HTMLInputElement);
  if (!validation.validate(form, Object.fromEntries(controls.filter(e => !e.validity.valid).map(e => [e.name, c.invalid])))) return;
  const f = new FormData(form);
  const groupId = String(f.get('groupId') ?? '') || null;
  const targetIds = groupId ? [] : f.getAll('targetIds').map(String);
  const data = area === 'dates' ? { title: String(f.get('title')), date: String(f.get('date')), yearly: f.has('yearly'), targetIds }
   : area === 'seasons' ? { name: String(f.get('name')), startsOn: String(f.get('startsOn')), endsOn: String(f.get('endsOn')), rule: String(f.get('rule')), shiftMinutes: Number(f.get('shiftMinutes')), extraTimes: String(f.get('extraTimes')).split(',').map(t => t.trim()).filter(Boolean), targetIds }
   : area === 'notes' ? { label: String(f.get('label')), day: String(f.get('day')), color: String(f.get('color')), targetId: String(f.get('targetId')) || null }
   : { name: String(f.get('name')), targetIds, groupId };
  pending.current = true; setBusy(true); setError('');
  try {
   const result = await calendarAction(area, { operation, ...(existing ? { id: existing.id } : {}), data, confirmation: String(f.get('confirmation')) });
   if (!result.ok) { setError(result.error); setUncertain(result.uncertain ?? false); return; }
   const r = result.receipt;
   if (!r.confirmed || r.area !== area || r.operation !== operation || !r.id || existing && r.id !== existing.id) { setUncertain(true); setError(c.failure); return; }
   props.onSaved(r.url);
  } catch { setUncertain(true); setError(c.failure); }
  finally { pending.current = false; setBusy(false); requestAnimationFrame(() => errorRef.current?.focus()); }
 }
 const ids = existing && 'targetIds' in existing ? existing.targetIds : [];
 return <Dialog open title={`${existing ? c.edit : c.add} · ${c[area]}`} closeLabel={c.cancel} onClose={props.onClose} busy={busy} actions={<><Button data-dialog-cancel onClick={props.onClose} disabled={busy}>{c.cancel}</Button><Button variant="primary" type="submit" form={id} busy={busy} disabled={uncertain}>{busy ? c.saving : c.save}</Button></>}>
  <form id={id} className={styles.form} onSubmit={submit} noValidate>
   {area === 'dates' && <>{field('title', c.title, 'text', existing && 'title' in existing ? existing.title : '')}{field('date', c.date, 'date', existing && 'date' in existing ? existing.date : props.from)}<label className={styles.choice}><input type="checkbox" name="yearly" defaultChecked={existing && 'yearly' in existing ? existing.yearly : false} />{c.yearly}</label></>}
   {area === 'seasons' && <>{field('name', c.name, 'text', existing && 'name' in existing ? existing.name : '')}{field('startsOn', c.from, 'date', existing && 'startsOn' in existing ? existing.startsOn : props.from)}{field('endsOn', c.to, 'date', existing && 'endsOn' in existing ? existing.endsOn : props.to)}<label className="ui-field"><span>{c.rule}</span><select className="ui-input" name="rule" defaultValue={existing && 'rule' in existing ? existing.rule : p.enabledRules[0]}>{existing && 'rule' in existing && !p.enabledRules.includes(existing.rule) && <option value={existing.rule} disabled>{c.unknown}</option>}{p.enabledRules.map(r => <option key={r} value={r}>{c[r]}</option>)}</select></label>{field('shiftMinutes', c.shiftMinutes, 'number', existing && 'shiftMinutes' in existing ? existing.shiftMinutes : 0)}<label className="ui-field"><span>{c.extraTimes}</span><input className="ui-input" name="extraTimes" defaultValue={existing && 'extraTimes' in existing ? existing.extraTimes.join(', ') : ''} autoComplete="off" /></label></>}
   {area === 'notes' && <>{field('label', c.label, 'text', existing && 'label' in existing ? existing.label : '')}{field('day', c.date, 'date', existing && 'day' in existing ? existing.day : props.from)}<label className="ui-field"><span>{c.color}</span><select className="ui-input" name="color" defaultValue={existing && 'color' in existing ? existing.color : p.colors[0]}>{p.colors.map(color => <option key={color} value={color}>{c[color]}</option>)}</select></label><label className="ui-field"><span>{c.channels}</span><select className="ui-input" name="targetId" defaultValue={existing && 'targetId' in existing ? existing.targetId ?? '' : props.targetId}>{props.allChannels && <option value="">{c.global}</option>}{props.channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}</select></label></>}
   {area === 'feeds' && <>{field('name', c.name)}{(props.groups?.length ?? 0) > 0 && <label className="ui-field"><span>{c.group}</span><select className="ui-input" name="groupId"><option value="">{c.noGroup}</option>{props.groups?.map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label>}</>}
   {area !== 'notes' && <fieldset><legend>{c.channels}</legend><p className={styles.meta}>{c.selectionHint}</p><div className={styles.choices}>{props.channels.map(ch => <label className={styles.choice} key={ch.id}><input name="targetIds" type="checkbox" value={ch.id} defaultChecked={ids.includes(ch.id) || props.targetId === ch.id} />{ch.name}</label>)}</div></fieldset>}
   <label className="ui-field"><span>{c.confirmation}: <code translate="no">{exact}</code></span><input className="ui-input" name="confirmation" required autoComplete="off" spellCheck={false} {...validation.fieldProps('confirmation')} /><FieldError {...validation.errorProps('confirmation')} /></label>
   {error && <p role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
  </form>
 </Dialog>;
}
