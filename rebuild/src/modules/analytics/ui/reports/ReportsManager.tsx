'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import type { ReportUiPolicy } from '@/modules/analytics/report-ui-config';
import styles from './workflows.module.css';

export type TemplateRow = { id: string; name: string; sections: string[]; rangeKey: string; scheduleCount: number };
export type ScheduleRow = { id: string; channelId: string; channelName: string | null; templateId: string | null; templateName: string | null; frequency: string; recipientCount: number; recipients: string[]; nextRunAt: string; lastOutcome: string };
export type RunRow = { id: string; channelId: string; kind: string; status: string; periodStart: string; periodEnd: string; startedAt: string; rowCount: number | null; truncated: boolean; note: string | null; deliveries: Array<{ mask: string; status: string }> };
export type ReportUiLimits = { nameMax: number; maxRecipients: number; maxRows: number; maxBytes: number };

type TemplateDraft = { name: string; rangeKey: string; sections: string[] };
type ScheduleDraft = { channelId: string; frequency: string; recipients: string; templateId: string };
type PendingAction = { url: string; body: Record<string, unknown>; title: string; detail: string; confirmLabel: string; successMessage: string; confirmation: string; destructive?: boolean; acknowledgement?: string; requestKey?: string; manual?: boolean };
/** A JSON rendering is offered only when present and within the current download limit; older prepared runs have none. */
function preparedJson(value: unknown, limits: { maxBytes: number } | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return limits && new TextEncoder().encode(value).byteLength > limits.maxBytes ? null : value;
}
type Prepared = { filename: string; csv: string; html: string; json: string | null; truncated: boolean; notIncluded: string[]; rowCount: number; bytes: number };
type DefaultPeriod = { start: string; end: string; maxDays: number };

const DELIVERY: Record<string, string> = { attempting: 'not confirmed', sent: 'sent', failed: 'not sent', unavailable: 'not sent', uncertain: 'not confirmed' };
const OUTCOME: Record<string, string> = { never: 'Not run yet', generated: 'Last report completed', failed: 'Last run did not complete' };
const FALLBACK_ERROR = 'The result could not be confirmed. Refresh the page and check the current state before trying again.';
const safeError = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : FALLBACK_ERROR;
const safeFilename = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value);
const when = (iso: string, timeZone: string) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date); } catch { return 'Time unavailable'; }
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function ReportsManager({ templates, templateOptions, schedules, runs, canSchedule, canManage, channels, policy, limits, defaultPeriod, timeZone, hasMoreTemplates, hasMoreSchedules, page, runsPage = 1, runsHasMore = false, canGenerate = canSchedule }: {
  templates: TemplateRow[]; templateOptions: Array<{ id: string; name: string }>; schedules: ScheduleRow[]; runs: RunRow[]; canSchedule: boolean; channels: Array<{ id: string; name: string }>; canManage: boolean;
  policy: ReportUiPolicy; limits: ReportUiLimits; defaultPeriod: DefaultPeriod | null; timeZone: string;
  hasMoreTemplates: boolean; hasMoreSchedules: boolean; page: number; runsPage?: number; runsHasMore?: boolean; canGenerate?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<'template' | 'schedule' | 'manual' | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TemplateRow | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [tpl, setTpl] = useState<TemplateDraft>({ name: '', rangeKey: policy.defaultRange, sections: [...policy.defaultSections] });
  const [sch, setSch] = useState<ScheduleDraft>({ channelId: channels[0]?.id ?? '', frequency: policy.defaultFrequency, recipients: '', templateId: '' });
  const [manual, setManual] = useState({ channelId: channels[0]?.id ?? '', templateId: '', start: defaultPeriod?.start ?? '', end: defaultPeriod?.end ?? '' });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const inFlight = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const tplValidation = useFormValidation();
  const schValidation = useFormValidation();
  const manualValidation = useFormValidation();
  const sectionLabels = new Map<string, string>(policy.sectionLabels.map(item => [item.id, item.label]));
  const supportedSections: string[] = policy.sectionOptions.map(item => item.id);
  const supportedSet = new Set(supportedSections);
  const nameMax = limits.nameMax;
  const recipientMax = limits.maxRecipients;

  const say = (text: string, error = false) => setNotice(current => ({ error, text, key: (current?.key ?? 0) + 1 }));
  const openTemplate = (row?: TemplateRow) => {
    const resumeDraft = Boolean(row && editingTemplate?.id === row.id);
    setEditingTemplate(row ?? null); setEditingSchedule(null);
    if (!resumeDraft) setTpl(row ? { name: row.name, rangeKey: row.rangeKey, sections: [...row.sections] } : { name: '', rangeKey: policy.defaultRange, sections: [...policy.defaultSections] });
    tplValidation.clearAll(); setDialogError(''); setForm('template');
  };
  const openSchedule = (row?: ScheduleRow) => {
    const resumeDraft = Boolean(row && editingSchedule?.id === row.id);
    setEditingSchedule(row ?? null); setEditingTemplate(null);
    if (!resumeDraft) setSch(row ? { channelId: row.channelId, frequency: row.frequency, recipients: row.recipients.join(', '), templateId: row.templateId ?? '' } : { channelId: channels[0]?.id ?? '', frequency: policy.defaultFrequency, recipients: '', templateId: '' });
    schValidation.clearAll(); setDialogError(''); setForm('schedule');
  };
  const makePending = (action: PendingAction) => { setAcknowledged(false); setDialogError(''); setPending(action); };

  const openManual = () => {
    if (!defaultPeriod) return;
    setManual(current => ({ ...current, channelId: current.channelId || channels[0]?.id || '', start: current.start || defaultPeriod.start, end: current.end || defaultPeriod.end }));
    manualValidation.clearAll(); setDialogError(''); setForm('manual');
  };

  function submitManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!defaultPeriod) return;
    const parseUtcDay = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
      return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? milliseconds : null;
    };
    const start = parseUtcDay(manual.start);
    const end = parseUtcDay(manual.end);
    const dayCount = start !== null && end !== null && end >= start ? Math.floor((end - start) / 86_400_000) + 1 : 0;
    const valid = manualValidation.validate(event.currentTarget, {
      channelId: !manual.channelId ? 'Choose a channel.' : '',
      start: !dayCount ? 'Enter a valid start date on or before the end date.' : '',
      end: !dayCount ? 'Enter a valid end date on or after the start date.' : dayCount > defaultPeriod.maxDays ? `Choose a date range of ${defaultPeriod.maxDays} days or fewer.` : '',
    });
    if (!valid) return;
    const key = `manual:${manual.channelId}:${manual.start}:${manual.end}:${manual.templateId}`;
    const requestId = requestIds.current.get(key) ?? crypto.randomUUID(); requestIds.current.set(key, requestId);
    makePending({ url: '/api/analytics/report-workflows/run', body: { channelId: manual.channelId, templateId: manual.templateId || null, start: manual.start, end: manual.end, requestId }, title: 'Prepare this report?', detail: 'The report will be prepared for download. Nothing will be emailed.', confirmation: `GENERATE CHANNEL REPORT ${manual.channelId}`, confirmLabel: 'Prepare report', successMessage: 'Report prepared.', requestKey: key, manual: true, acknowledgement: 'I understand this report is prepared for download and will not be emailed.' });
  }

  async function write(action: PendingAction) {
    if (inFlight.current || (action.acknowledgement && !acknowledged)) return;
    inFlight.current = true; setBusy(true); setDialogError('');
    try {
      const response = await fetch(action.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action.body, confirmation: action.confirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || (body as { ok?: unknown }).ok !== true) throw new Error(safeError(body));
      if (action.manual) {
        const output = body as Record<string, unknown>;
        if (!safeFilename(output.filename) || typeof output.csv !== 'string' || typeof output.html !== 'string' || !Number.isSafeInteger(output.rowCount) || Number(output.rowCount) < 0 || Number(output.rowCount) > limits.maxRows || typeof output.truncated !== 'boolean' || !Array.isArray(output.notIncluded) || !Number.isSafeInteger(output.bytes)) throw new Error(FALLBACK_ERROR);
        const bytes = new TextEncoder().encode(output.csv).byteLength;
        if (bytes !== output.bytes || bytes > limits.maxBytes) throw new Error('The prepared report size could not be verified. Check report history before trying again.');
        requestIds.current.delete(action.requestKey ?? '');
        setPrepared({ filename: output.filename, csv: output.csv, html: output.html, json: preparedJson(output.json, limits), truncated: output.truncated, notIncluded: output.notIncluded.filter((item): item is string => typeof item === 'string'), rowCount: Number(output.rowCount), bytes });
        setPending(null); setForm(null); setAcknowledged(false); say('Report prepared. Download a CSV, JSON or printable page below. Nothing was emailed.');
        router.refresh();
        return;
      }
      setPending(null); setForm(null); setEditingTemplate(null); setEditingSchedule(null); setAcknowledged(false);
      say(action.successMessage);
      router.refresh();
    } catch (error) { setDialogError(error instanceof Error && !(error instanceof TypeError) ? error.message : FALLBACK_ERROR); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tpl.name.trim();
    const nameError = !name ? 'Enter a template name.' : nameMax && name.length > nameMax ? `Use ${nameMax} characters or fewer.` : '';
    const sectionError = tpl.sections.length === 0 ? 'Choose at least one report section.' : '';
    const formElement = event.currentTarget;
    const valid = tplValidation.validate(formElement, { name: nameError, sections: sectionError });
    if (!valid) return;
    const row = editingTemplate;
    const confirmation = row ? `UPDATE REPORT TEMPLATE ${row.id}` : `CREATE REPORT TEMPLATE ${name}`;
    makePending({ url: '/api/analytics/report-workflows/templates', body: row ? { action: 'update', id: row.id, name, sections: tpl.sections, rangeKey: tpl.rangeKey } : { action: 'create', name, sections: tpl.sections, rangeKey: tpl.rangeKey }, title: row ? 'Save template changes?' : 'Create this template?', detail: row ? `This updates the shared template. ${row.scheduleCount ? `${row.scheduleCount} existing schedule${row.scheduleCount === 1 ? '' : 's'} use it.` : 'No schedules use it yet.'}` : 'A template saves report choices for reuse. It does not send a report.', confirmLabel: row ? 'Save changes' : 'Create template', successMessage: row ? 'Template changes saved.' : 'Template created.', confirmation });
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipients = [...new Set(sch.recipients.split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipientError = !recipients.length ? 'Enter at least one email address.' : recipients.some(value => !address.test(value)) ? 'Check the email addresses and try again.' : recipientMax && recipients.length > recipientMax ? `Use no more than ${recipientMax} recipients.` : '';
    const valid = schValidation.validate(event.currentTarget, { channelId: !sch.channelId ? 'Choose a channel.' : '', recipients: recipientError });
    if (!valid) return;
    const row = editingSchedule;
    const confirmation = row ? `UPDATE REPORT SCHEDULE ${row.id}` : `CREATE REPORT SCHEDULE ${sch.channelId} ${sch.frequency}`;
    makePending({ url: '/api/analytics/report-workflows/schedules', body: row ? { action: 'update', id: row.id, frequency: sch.frequency, recipients, templateId: sch.templateId || null } : { action: 'create', channelId: sch.channelId, frequency: sch.frequency, recipients, templateId: sch.templateId || null }, title: row ? 'Save schedule changes?' : 'Create this schedule?', detail: row ? 'The next run will use these recipients and report choices.' : 'This will email the selected recipients weekly or monthly. The first run is set using your workspace time zone.', confirmation, confirmLabel: row ? 'Save changes' : 'Create schedule', successMessage: row ? 'Schedule changes saved.' : 'Schedule created.', acknowledgement: row ? 'I understand the next report will use these recipients and choices.' : 'I understand reports will be emailed to these recipients.' });
  }

  function removeTemplate(row: TemplateRow) {
    makePending({ url: '/api/analytics/report-workflows/templates', body: { action: 'delete', id: row.id }, title: `Delete “${row.name}”?`, detail: row.scheduleCount ? `This deletes the template. ${row.scheduleCount} schedule${row.scheduleCount === 1 ? '' : 's'} will keep running without it.` : 'This deletes the saved template. Existing reports are unchanged.', confirmation: `DELETE REPORT TEMPLATE ${row.id}`, confirmLabel: 'Delete template', successMessage: 'Template deleted.', destructive: true, acknowledgement: 'I understand this removes the saved template.' });
  }

  function removeSchedule(row: ScheduleRow) {
    makePending({ url: '/api/analytics/report-workflows/schedules', body: { action: 'delete', id: row.id }, title: 'Delete this schedule?', detail: `${row.channelName ?? 'This channel'} will stop sending reports to ${plural(row.recipientCount, 'recipient')}. Past reports and run history remain.`, confirmation: `DELETE REPORT SCHEDULE ${row.id}`, confirmLabel: 'Delete schedule', successMessage: 'Schedule deleted.', destructive: true, acknowledgement: 'I understand future reports will no longer be sent.' });
  }

  async function prepare(row: ScheduleRow) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    const requestId = requestIds.current.get(row.id) ?? crypto.randomUUID();
    requestIds.current.set(row.id, requestId);
    try {
      const response = await fetch('/api/analytics/report-workflows/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduleId: row.id, requestId, confirmation: `GENERATE REPORT ${row.id}` }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok !== true || !safeFilename(body.filename) || typeof body.csv !== 'string' || typeof body.html !== 'string' || !Number.isSafeInteger(body.rowCount) || body.rowCount < 0 || body.rowCount > limits.maxRows || typeof body.truncated !== 'boolean' || !Array.isArray(body.notIncluded)) throw new Error(safeError(body));
      const bytes = new TextEncoder().encode(body.csv).byteLength;
      if (limits && bytes > limits.maxBytes) throw new Error('The prepared CSV is larger than the current download limit. Contact your workspace administrator.');
      if (Number.isSafeInteger(body.bytes) && body.bytes !== bytes) throw new Error('The prepared report size could not be verified. Check report history before trying again.');
      requestIds.current.delete(row.id);
      setPrepared({ filename: body.filename, csv: body.csv, html: body.html, json: preparedJson(body.json, limits), truncated: body.truncated, notIncluded: body.notIncluded.filter((item: unknown): item is string => typeof item === 'string'), rowCount: body.rowCount, bytes });
      say('Report prepared. Download a CSV, JSON or printable page below. Nothing was emailed.');
    } catch (error) { say(error instanceof Error && !(error instanceof TypeError) ? error.message : FALLBACK_ERROR, true); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function download(kind: 'csv' | 'html' | 'json') {
    if (!prepared) return;
    const content = kind === 'csv' ? prepared.csv : kind === 'json' ? prepared.json : prepared.html;
    if (content === null) return;
    const url = URL.createObjectURL(new Blob([content], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : kind === 'json' ? 'application/json;charset=utf-8' : 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${prepared.filename}.${kind}`; link.hidden = true; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const toggleSection = (id: string) => setTpl(current => ({ ...current, sections: current.sections.includes(id) ? current.sections.filter(section => section !== id) : [...current.sections, id] }));
  const templatesHref = (next: number) => `/analytics/reports?page=${next}${runsPage > 1 ? `&runsPage=${runsPage}` : ''}`;
  const runsHref = (next: number) => `/analytics/reports?page=${page}${next > 1 ? `&runsPage=${next}` : ''}`;
  const templatePager = page > 1 || hasMoreTemplates || hasMoreSchedules;
  const runPager = runsPage > 1 || runsHasMore;
  const runStatus = (run: RunRow) => run.status === 'completed' ? (run.kind === 'manual' ? 'Prepared' : 'Completed') : ({ claimed: 'Starting', generating: 'Preparing', delivering: 'Sending', partial: 'Partly sent', failed: 'Failed', uncertain: 'Delivery not confirmed', skipped: 'Skipped' } as Record<string, string>)[run.status] ?? 'Status unavailable';

  return <div className={styles.root}>
    <SidebarDock><div className={styles.sidebarActions}>
      {canManage && <Button variant="primary" onClick={() => openTemplate()}>New template</Button>}
      {canManage && canGenerate && defaultPeriod && <Button variant="secondary" disabled={!channels.length} aria-disabled={!channels.length} onClick={() => channels.length && openManual()}>Prepare report</Button>}
      {canManage && canGenerate && !defaultPeriod && <p className={styles.sidebarHint}>A default UTC report period is unavailable. You can still prepare reports from existing schedules.</p>}
      {!channels.length && canManage && canGenerate && <p className={styles.sidebarHint}>Choose an available channel before preparing a report.</p>}
      {canManage && canSchedule && <Button variant="secondary" disabled={!channels.length} aria-disabled={!channels.length} onClick={() => channels.length && openSchedule()}>New schedule</Button>}
      {!channels.length && canManage && canSchedule && <p className={styles.sidebarHint}>Connect and select a channel before creating a schedule.</p>}
      {templatePager && <nav className={styles.sidebarPager} aria-label="Template and schedule pages">
        {page > 1 ? <a className="ui-button ui-button--secondary ui-button--sm" rel="prev" href={templatesHref(page - 1)}>Previous page</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">Previous page</span>}
        <span aria-current="page" aria-label={`Page ${page}`}>Page {page}</span>
        {hasMoreTemplates || hasMoreSchedules ? <a className="ui-button ui-button--secondary ui-button--sm" rel="next" href={templatesHref(page + 1)}>Next page</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">Next page</span>}
      </nav>}
      {runPager && <nav className={styles.sidebarPager} aria-label="Report history pages">
        {runsPage > 1 ? <a className="ui-button ui-button--secondary ui-button--sm" rel="prev" href={runsHref(runsPage - 1)}>Previous history page</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">Previous history page</span>}
        <span aria-current="page" aria-label={`History page ${runsPage}`}>History page {runsPage}</span>
        {runsHasMore ? <a className="ui-button ui-button--secondary ui-button--sm" rel="next" href={runsHref(runsPage + 1)}>Next history page</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">Next history page</span>}
      </nav>}
    </div></SidebarDock>

    {notice && <RouteNotice error={notice.error} focusKey={`reports:${notice.key}`}>{notice.text}</RouteNotice>}
    <section className={styles.panel} aria-labelledby="tpl-h"><div className={styles.panelHeading}><div><h2 id="tpl-h">Report templates</h2><p>Save the sections and period your team reuses.</p></div></div>
      {templates.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="ui-visually-hidden">Report templates</caption><thead><tr><th scope="col">Template</th><th scope="col">Period and sections</th><th scope="col">Schedules</th>{canManage && <th scope="col">Actions</th>}</tr></thead><tbody>{templates.map(row => <tr key={row.id}>
        <th scope="row"><strong>{row.name}</strong></th><td>{policy.rangeOptions.find(option => option.id === row.rangeKey)?.label ?? 'Saved period'}<span className={styles.secondaryLine}>{row.sections.map(section => sectionLabels.get(section) ?? 'Saved section').join(', ') || 'No sections selected'}</span></td><td>{row.scheduleCount}</td>
        {canManage && <td><div className={styles.actions}><Button size="sm" variant="secondary" disabled={busy} onClick={() => openTemplate(row)}>Edit</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => removeTemplate(row)}>Delete</Button></div></td>}
      </tr>)}</tbody></table></div> : <div className={styles.emptyState}><h3>{page > 1 ? 'No templates on this page' : 'No templates yet'}</h3><p>{page > 1 ? 'Use Previous page to return to saved templates.' : canManage ? 'Create a template to reuse the report sections and period your team needs.' : 'A workspace editor can create a reusable report template.'}</p></div>}
    </section>

    <section className={styles.panel} aria-labelledby="sch-h"><div className={styles.panelHeading}><div><h2 id="sch-h">Scheduled reports</h2><p>{canSchedule ? 'Reports go to the selected recipients on the workspace schedule.' : 'Existing schedules stay available for review and editing.'}</p></div></div>
      {!canSchedule && <p className={styles.info} role="status">Scheduled email is temporarily unavailable. You can still review and edit saved schedules.</p>}
      {schedules.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="ui-visually-hidden">Scheduled reports</caption><thead><tr><th scope="col">Channel and frequency</th><th scope="col">Report</th><th scope="col">Recipients</th><th scope="col">Next run</th><th scope="col">Last result</th>{canManage && <th scope="col">Actions</th>}</tr></thead><tbody>{schedules.map(row => <tr key={row.id}>
        <th scope="row"><strong>{row.channelName ?? 'Unavailable channel'}</strong><span className={styles.secondaryLine}>{policy.frequencyOptions.find(option => option.id === row.frequency)?.label ?? `Saved frequency (${row.frequency})`}</span></th>
        <td>{row.templateName ?? (row.templateId ? 'Saved template unavailable' : 'All selected sections')}</td><td>{row.recipientCount}{canManage && row.recipients.length > 0 && <span className={styles.secondaryLine}>{row.recipients.join(', ')}</span>}</td>
        <td>{when(row.nextRunAt, timeZone)}<span className={styles.secondaryLine}>{timeZone}</span></td><td>{OUTCOME[row.lastOutcome] ?? 'Status unavailable'}</td>
        {canManage && <td><div className={styles.actions}>{canGenerate && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void prepare(row)}>{busy ? 'Preparing…' : 'Prepare now'}</Button>}<Button size="sm" variant="secondary" disabled={busy} onClick={() => openSchedule(row)}>Edit</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => removeSchedule(row)}>Delete</Button></div></td>}
      </tr>)}</tbody></table></div> : <div className={styles.emptyState}><h3>{page > 1 ? 'No schedules on this page' : 'No scheduled reports'}</h3><p>{page > 1 ? 'Use Previous page to return to saved schedules.' : canSchedule && canManage ? 'Create a schedule to send reports to people who need them.' : canSchedule ? 'No report schedules are set up for channels you can access.' : 'No report schedules are set up for channels you can access.'}</p></div>}
      {prepared && <div className={styles.prepared} role="region" aria-labelledby="prepared-title"><div><h3 id="prepared-title">Report prepared</h3><p>{prepared.rowCount} rows · {prepared.bytes.toLocaleString('en')} bytes{prepared.truncated ? ' · Shortened to fit the configured limit' : ''}</p>{prepared.notIncluded.length > 0 && <p>Not included yet: {prepared.notIncluded.map(section => sectionLabels.get(section) ?? 'Some sections').join(', ')}.</p>}</div><div className={styles.actions}><Button size="sm" onClick={() => download('csv')}>Download CSV</Button>{prepared.json !== null && <Button size="sm" variant="secondary" onClick={() => download('json')}>Download JSON</Button>}<Button size="sm" variant="secondary" onClick={() => download('html')}>Download printable page</Button></div></div>}
      <p className={styles.note}>Reports use stored analytics. Missing data is shown as unavailable, not zero. “Prepare report” creates a download and does not email anyone; scheduled runs send to their saved recipients.</p>
    </section>

    <section className={styles.panel} aria-labelledby="run-h"><div className={styles.panelHeading}><div><h2 id="run-h">Report history</h2><p>Preparation and email outcomes, by channel and reporting period.</p></div></div>
      {!canGenerate && <p className={styles.info} role="status">Report preparation and history are temporarily unavailable. Existing templates and schedules remain available.</p>}
      {runs.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="ui-visually-hidden">Report history</caption><thead><tr><th scope="col">Result</th><th scope="col">Channel and period</th><th scope="col">Started</th><th scope="col">Rows</th><th scope="col">Delivery</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}>
        <th scope="row">{runStatus(run)}<span className={styles.secondaryLine}>{run.kind === 'manual' ? 'Prepared for download' : 'Scheduled email'}</span></th>
        <td>{channels.find(channel => channel.id === run.channelId)?.name ?? 'Channel unavailable'}<span className={styles.secondaryLine}>{run.periodStart} to {run.periodEnd}</span></td><td>{when(run.startedAt, timeZone)}<span className={styles.secondaryLine}>{timeZone}</span></td><td>{run.rowCount === null ? '—' : run.rowCount}{run.truncated ? ' · shortened' : ''}{run.note ? <span className={styles.secondaryLine}>{run.note}</span> : null}</td><td>{run.deliveries.length ? run.deliveries.map((delivery, index) => <span className={styles.deliveryLine} key={`${delivery.mask}-${index}`}>{delivery.mask} · {DELIVERY[delivery.status] ?? 'status unavailable'}</span>) : run.kind === 'manual' && run.status === 'completed' ? 'Download prepared' : 'No recipient details'}</td>
      </tr>)}</tbody></table></div> : <div className={styles.emptyState}><h3>{runsPage > 1 ? 'No runs on this page' : 'No report runs yet'}</h3><p>{runsPage > 1 ? 'Use Previous history page to return to report history.' : 'Prepared downloads and scheduled deliveries will appear here after the first report runs.'}</p></div>}
    </section>

    <Dialog open={form === 'template'} title={editingTemplate ? 'Edit template' : 'New template'} description="A template saves report sections and a preferred period for reuse." busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="tpl-form" variant="primary" disabled={busy}>{busy ? 'Saving…' : editingTemplate ? 'Save changes' : 'Create template'}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`template-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="tpl-form" className={styles.form} onSubmit={event => { event.preventDefault(); void saveTemplate(event); }} noValidate>
        <label className={styles.field} htmlFor="report-template-name">Template name<input id="report-template-name" name="name" required maxLength={nameMax} disabled={busy} value={tpl.name} aria-invalid={tplValidation.errors.name ? true : undefined} aria-describedby={tplValidation.errors.name ? 'report-template-name-error' : undefined} onChange={event => setTpl(current => ({ ...current, name: event.target.value }))} /><FieldError id="report-template-name-error">{tplValidation.errors.name}</FieldError></label>
        <label className={styles.field} htmlFor="report-template-range">Preferred period<select id="report-template-range" name="rangeKey" disabled={busy} value={tpl.rangeKey} onChange={event => setTpl(current => ({ ...current, rangeKey: event.target.value }))}>{!policy.rangeOptions.some(option => option.id === tpl.rangeKey) && <option value={tpl.rangeKey}>Saved period (kept from this template)</option>}{policy.rangeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <fieldset className={styles.checks} disabled={busy} aria-describedby={tplValidation.errors.sections ? 'report-template-sections-error' : undefined}><legend>Sections</legend>{policy.sectionOptions.map(option => <label className={styles.check} key={option.id}><input name="sections" type="checkbox" checked={tpl.sections.includes(option.id)} onChange={() => toggleSection(option.id)} /><span>{option.label}</span></label>)}{editingTemplate?.sections.filter(id => !supportedSet.has(id)).map(id => <label className={styles.check} key={id}><input name="sections" type="checkbox" checked disabled /><span>{sectionLabels.get(id) ?? 'Saved section'} · kept from this template (unavailable in new reports)</span></label>)}<FieldError id="report-template-sections-error">{tplValidation.errors.sections}</FieldError></fieldset>
        {editingTemplate && editingTemplate.scheduleCount > 0 && <p className={styles.note}>Changes apply to {plural(editingTemplate.scheduleCount, 'existing schedule')} using this template.</p>}
      </form>
    </Dialog>

    <Dialog open={form === 'schedule'} title={editingSchedule ? 'Edit schedule' : 'New schedule'} description="Choose a channel, how often the report is sent, and who receives it." busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="sch-form" variant="primary" disabled={busy || (!editingSchedule && !canSchedule)}>{busy ? 'Saving…' : editingSchedule ? 'Save changes' : 'Review schedule'}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`schedule-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="sch-form" className={styles.form} onSubmit={event => { event.preventDefault(); void saveSchedule(event); }} noValidate>
        <label className={styles.field} htmlFor="report-schedule-channel">Channel<select id="report-schedule-channel" name="channelId" required disabled={busy || Boolean(editingSchedule)} value={sch.channelId} aria-invalid={schValidation.errors.channelId ? true : undefined} aria-describedby={schValidation.errors.channelId ? 'report-schedule-channel-error' : undefined} onChange={event => setSch(current => ({ ...current, channelId: event.target.value }))}>{editingSchedule && !channels.some(channel => channel.id === sch.channelId) && <option value={sch.channelId}>{editingSchedule.channelName ?? 'Unavailable channel'} (no longer available)</option>}{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><FieldError id="report-schedule-channel-error">{schValidation.errors.channelId}</FieldError></label>
        <label className={styles.field} htmlFor="report-schedule-frequency">Frequency<select id="report-schedule-frequency" name="frequency" disabled={busy} value={sch.frequency} onChange={event => setSch(current => ({ ...current, frequency: event.target.value }))}>{!policy.frequencyOptions.some(option => option.id === sch.frequency) && <option value={sch.frequency}>Saved frequency (kept from this schedule)</option>}{policy.frequencyOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label className={styles.field} htmlFor="report-schedule-template">Template<select id="report-schedule-template" name="templateId" disabled={busy} value={sch.templateId} onChange={event => setSch(current => ({ ...current, templateId: event.target.value }))}><option value="">All selected sections</option>{editingSchedule?.templateId && !templateOptions.some(template => template.id === editingSchedule.templateId) && <option value={editingSchedule.templateId}>{editingSchedule.templateName ?? 'Saved template'} (unavailable here; saved choice retained)</option>}{templateOptions.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label className={styles.field} htmlFor="report-schedule-recipients">Recipient email addresses<AutoTextarea id="report-schedule-recipients" name="recipients" rows={3} required disabled={busy} value={sch.recipients} aria-invalid={schValidation.errors.recipients ? true : undefined} aria-describedby={schValidation.errors.recipients ? 'report-schedule-recipients-error' : 'report-schedule-recipients-help'} onChange={event => setSch(current => ({ ...current, recipients: event.target.value }))} /><span id="report-schedule-recipients-help">Separate addresses with commas, spaces, or semicolons.{recipientMax ? ` Up to ${recipientMax} recipients.` : ''}</span><FieldError id="report-schedule-recipients-error">{schValidation.errors.recipients}</FieldError></label>
      </form>
    </Dialog>

    <Dialog open={form === 'manual'} title="Prepare report" description="Create a download for one channel and a chosen UTC date range. This does not send email." busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="manual-form" variant="primary" disabled={busy || !channels.length}>{busy ? 'Preparing…' : 'Review report'}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`manual-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="manual-form" className={styles.form} onSubmit={submitManual} noValidate>
        <label className={styles.field} htmlFor="report-manual-channel">Channel<select id="report-manual-channel" name="channelId" required disabled={busy} value={manual.channelId} aria-invalid={manualValidation.errors.channelId ? true : undefined} aria-describedby={manualValidation.errors.channelId ? 'report-manual-channel-error' : undefined} onChange={event => setManual(current => ({ ...current, channelId: event.target.value }))}>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><FieldError id="report-manual-channel-error">{manualValidation.errors.channelId}</FieldError></label>
        <label className={styles.field} htmlFor="report-manual-template">Template<select id="report-manual-template" name="templateId" disabled={busy} value={manual.templateId} onChange={event => setManual(current => ({ ...current, templateId: event.target.value }))}><option value="">Use the default report sections</option>{manual.templateId && !templateOptions.some(template => template.id === manual.templateId) && <option value={manual.templateId}>{templates.find(template => template.id === manual.templateId)?.name ?? 'Saved template'} (unavailable)</option>}{templateOptions.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label className={styles.field} htmlFor="report-manual-start">From (UTC)<input id="report-manual-start" name="start" type="date" required disabled={busy} value={manual.start} aria-invalid={manualValidation.errors.start ? true : undefined} aria-describedby={manualValidation.errors.start ? 'report-manual-start-error' : undefined} onChange={event => setManual(current => ({ ...current, start: event.target.value }))} /><FieldError id="report-manual-start-error">{manualValidation.errors.start}</FieldError></label>
        <label className={styles.field} htmlFor="report-manual-end">Through (UTC)<input id="report-manual-end" name="end" type="date" required disabled={busy} value={manual.end} aria-invalid={manualValidation.errors.end ? true : undefined} aria-describedby={`report-manual-range-help${manualValidation.errors.end ? ' report-manual-end-error' : ''}`} onChange={event => setManual(current => ({ ...current, end: event.target.value }))} /><span id="report-manual-range-help">Choose an inclusive range of up to {defaultPeriod?.maxDays ?? 1} days.</span><FieldError id="report-manual-end-error">{manualValidation.errors.end}</FieldError></label>
      </form>
    </Dialog>

    <Dialog open={Boolean(pending)} title={pending?.title ?? ''} description={pending?.detail} busy={busy} onClose={() => !busy && setPending(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</Button><Button variant={pending?.destructive ? 'danger' : 'primary'} disabled={busy || Boolean(pending?.acknowledgement && !acknowledged)} onClick={() => pending && void write(pending)}>{busy ? 'Saving…' : pending?.confirmLabel ?? 'Confirm'}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`write-error:${dialogError}`}>{dialogError}</RouteNotice>}
      {pending?.acknowledgement && <label className={styles.acknowledgement}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>{pending.acknowledgement}</span></label>}
    </Dialog>
  </div>;
}
