'use client';
import type { DownloadCatalog } from './download-copy';
import { uiCopy, type ReportCopy, type UiLocale } from './copy';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatInZone } from './format';
import { AutoTextarea } from '@/components/AutoTextarea';
import { useToast } from '@/components/Toast';
import { DataTable } from '@/components/DataTable';
import { Badge, SegmentedControl } from '@/components';
import { ReportDownloads } from './ReportDownloads';
import { IconChartBar, IconCalendar, IconHistory, IconFileAnalytics, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { RouteNotice } from '@/components/RouteNotice';
import type { ReportUiPolicy } from '@/modules/analytics/report-ui-config';
import styles from './workflows.module.css';

export type TemplateRow = { id: string; name: string; sections: string[]; rangeKey: string; scheduleCount: number };
export type ScheduleRow = { id: string; channelId: string; channelName: string | null; templateId: string | null; templateName: string | null; frequency: string; recipientCount: number; recipients: string[]; nextRunAt: string; nextRunLabel?: string; lastOutcome: string };
export type RunRow = { id: string; channelId: string; kind: string; status: string; periodStart: string; periodEnd: string; startedAt: string; startedLabel?: string; rowCount: number | null; truncated: boolean; note: string | null; deliveries: Array<{ mask: string; status: string }> };
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
const safeFilename = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value);
/** Server-formatted label when given (avoids hydration mismatches from differing time-zone data), else format here. */

export function ReportsManager({ templates, templateOptions, schedules, runs, canSchedule, canManage, channels, policy, limits, defaultPeriod, timeZone, hasMoreTemplates, hasMoreSchedules, page, runsPage = 1, runsHasMore = false, canGenerate = canSchedule, locale = 'en', copy, downloadCopy }: {
  copy?: ReportCopy; downloadCopy?: DownloadCatalog; templates: TemplateRow[]; templateOptions: Array<{ id: string; name: string }>; schedules: ScheduleRow[]; runs: RunRow[]; canSchedule: boolean; channels: Array<{ id: string; name: string }>; canManage: boolean;
  policy: ReportUiPolicy; limits: ReportUiLimits; defaultPeriod: DefaultPeriod | null; timeZone: string;
  hasMoreTemplates: boolean; hasMoreSchedules: boolean; page: number; runsPage?: number; runsHasMore?: boolean; canGenerate?: boolean; locale?: UiLocale;
}) {
  const t = uiCopy(locale, copy);
  const existingSchedules = (count: number) => t(count === 1 ? '{0} existing schedule' : '{0} existing schedules', count);
  const FALLBACK_ERROR = t("The result could not be confirmed. Refresh the page and check the current state before trying again.");
  const safeError = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : FALLBACK_ERROR;
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
  const toast = useToast();
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

  const say = (text: string, error = false) => {
    setNotice(current => ({ error, text, key: (current?.key ?? 0) + 1 }));
    if (error) toast.failed(text, () => window.location.reload(), t("Refresh and check"));
    else toast.notify({ title: text, tone: 'success' });
  };
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
      channelId: !manual.channelId ? t("Choose a channel.") : '',
      start: !dayCount ? t("Enter a valid start date on or before the end date.") : '',
      end: !dayCount ? t("Enter a valid end date on or after the start date.") : dayCount > defaultPeriod.maxDays ? t("Choose a date range of {0} days or fewer.", defaultPeriod.maxDays) : '',
    });
    if (!valid) return;
    const key = `manual:${manual.channelId}:${manual.start}:${manual.end}:${manual.templateId}`;
    const requestId = requestIds.current.get(key) ?? crypto.randomUUID(); requestIds.current.set(key, requestId);
    makePending({ url: '/api/analytics/report-workflows/run', body: { channelId: manual.channelId, templateId: manual.templateId || null, start: manual.start, end: manual.end, requestId }, title: t("Prepare this report?"), detail: t("The report will be prepared for download. Nothing will be emailed."), confirmation: `GENERATE CHANNEL REPORT ${manual.channelId}`, confirmLabel: t("Prepare report"), successMessage: t("Report prepared."), requestKey: key, manual: true, acknowledgement: t("I understand this report is prepared for download and will not be emailed.") });
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
        if (bytes !== output.bytes || bytes > limits.maxBytes) throw new Error(t("The prepared report size could not be verified. Check report history before trying again."));
        requestIds.current.delete(action.requestKey ?? '');
        setPrepared({ filename: output.filename, csv: output.csv, html: output.html, json: preparedJson(output.json, limits), truncated: output.truncated, notIncluded: output.notIncluded.filter((item): item is string => typeof item === 'string'), rowCount: Number(output.rowCount), bytes });
        setPending(null); setForm(null); setAcknowledged(false); say(t("Report prepared. Download a CSV, JSON or printable page below. Nothing was emailed."));
        router.refresh();
        return;
      }
      setPending(null); setForm(null); setEditingTemplate(null); setEditingSchedule(null); setAcknowledged(false);
      say(action.successMessage);
      router.refresh();
    } catch (error) { const message = error instanceof Error && !(error instanceof TypeError) ? error.message : FALLBACK_ERROR; setDialogError(message); toast.failed(message, () => router.refresh(), t("Refresh and check")); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tpl.name.trim();
    const nameError = !name ? t("Enter a template name.") : nameMax && name.length > nameMax ? t("Use {0} characters or fewer.", nameMax) : '';
    const sectionError = tpl.sections.length === 0 ? t("Choose at least one report section.") : '';
    const formElement = event.currentTarget;
    const valid = tplValidation.validate(formElement, { name: nameError, sections: sectionError });
    if (!valid) return;
    const row = editingTemplate;
    const confirmation = row ? `UPDATE REPORT TEMPLATE ${row.id}` : `CREATE REPORT TEMPLATE ${name}`;
    makePending({ url: '/api/analytics/report-workflows/templates', body: row ? { action: 'update', id: row.id, name, sections: tpl.sections, rangeKey: tpl.rangeKey } : { action: 'create', name, sections: tpl.sections, rangeKey: tpl.rangeKey }, title: row ? t("Save template changes?") : t("Create this template?"), detail: row ? t('This updates the shared template. {0}', row.scheduleCount ? t('{0} existing schedules use it.', row.scheduleCount) : t('No schedules use it yet.')) : t("A template saves report choices for reuse. It does not send a report."), confirmLabel: row ? t("Save changes") : t("Create template"), successMessage: row ? t("Template changes saved.") : t("Template created."), confirmation });
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipients = [...new Set(sch.recipients.split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipientError = !recipients.length ? t("Enter at least one email address.") : recipients.some(value => !address.test(value)) ? t("Check the email addresses and try again.") : recipientMax && recipients.length > recipientMax ? t("Use no more than {0} recipients.", recipientMax) : '';
    const valid = schValidation.validate(event.currentTarget, { channelId: !sch.channelId ? t("Choose a channel.") : '', recipients: recipientError });
    if (!valid) return;
    const row = editingSchedule;
    const confirmation = row ? `UPDATE REPORT SCHEDULE ${row.id}` : `CREATE REPORT SCHEDULE ${sch.channelId} ${sch.frequency}`;
    makePending({ url: '/api/analytics/report-workflows/schedules', body: row ? { action: 'update', id: row.id, frequency: sch.frequency, recipients, templateId: sch.templateId || null } : { action: 'create', channelId: sch.channelId, frequency: sch.frequency, recipients, templateId: sch.templateId || null }, title: row ? t("Save schedule changes?") : t("Create this schedule?"), detail: row ? t("The next run will use these recipients and report choices.") : t("This will email the selected recipients weekly or monthly. The first run is set using your workspace time zone."), confirmation, confirmLabel: row ? t("Save changes") : t("Create schedule"), successMessage: row ? t("Schedule changes saved.") : t("Schedule created."), acknowledgement: row ? t("I understand the next report will use these recipients and choices.") : t("I understand reports will be emailed to these recipients.") });
  }

  function removeTemplate(row: TemplateRow) {
    makePending({ url: '/api/analytics/report-workflows/templates', body: { action: 'delete', id: row.id }, title: t("Delete “{0}”?", row.name), detail: row.scheduleCount ? t('This deletes the template. {0} schedules will keep running without it.', row.scheduleCount) : t("This deletes the saved template. Existing reports are unchanged."), confirmation: `DELETE REPORT TEMPLATE ${row.id}`, confirmLabel: t("Delete template"), successMessage: t("Template deleted."), destructive: true, acknowledgement: t("I understand this removes the saved template.") });
  }

  function removeSchedule(row: ScheduleRow) {
    makePending({ url: '/api/analytics/report-workflows/schedules', body: { action: 'delete', id: row.id }, title: t("Delete this schedule?"), detail: t('{0} will stop sending reports to {1} recipients. Past reports and run history remain.', row.channelName ?? t('This channel'), row.recipientCount), confirmation: `DELETE REPORT SCHEDULE ${row.id}`, confirmLabel: t("Delete schedule"), successMessage: t("Schedule deleted."), destructive: true, acknowledgement: t("I understand future reports will no longer be sent.") });
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
      if (limits && bytes > limits.maxBytes) throw new Error(t("The prepared CSV is larger than the current download limit. Contact your workspace administrator."));
      if (Number.isSafeInteger(body.bytes) && body.bytes !== bytes) throw new Error(t("The prepared report size could not be verified. Check report history before trying again."));
      requestIds.current.delete(row.id);
      setPrepared({ filename: body.filename, csv: body.csv, html: body.html, json: preparedJson(body.json, limits), truncated: body.truncated, notIncluded: body.notIncluded.filter((item: unknown): item is string => typeof item === 'string'), rowCount: body.rowCount, bytes });
      say(t("Report prepared. Download a CSV, JSON or printable page below. Nothing was emailed."));
    } catch (error) { say(error instanceof Error && !(error instanceof TypeError) ? error.message : FALLBACK_ERROR, true); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const toggleSection = (id: string) => setTpl(current => ({ ...current, sections: current.sections.includes(id) ? current.sections.filter(section => section !== id) : [...current.sections, id] }));
  const templatesHref = (next: number) => `/insights/reports?page=${next}${runsPage > 1 ? `&runsPage=${runsPage}` : ''}`;
  const runsHref = (next: number) => `/insights/reports?page=${page}${next > 1 ? `&runsPage=${next}` : ''}`;
  const templatePager = page > 1 || hasMoreTemplates || hasMoreSchedules;
  const runPager = runsPage > 1 || runsHasMore;
  const runStatus = (run: RunRow) => run.status === 'completed' ? (run.kind === 'manual' ? t("Prepared") : t("Completed")) : ({ claimed: t("Starting"), generating: t("Preparing"), delivering: t("Sending"), partial: t("Partly sent"), failed: t("Failed"), uncertain: t("Delivery not confirmed"), skipped: t("Skipped") } as Record<string, string>)[run.status] ?? t("Status unavailable");

  return <div className={styles.root}>
    <div className={styles.sidebarActions}>
      {canManage && <Button variant="primary" onClick={() => openTemplate()}>{t("New template")}</Button>}
      {canManage && canGenerate && defaultPeriod && <Button variant="secondary" disabled={!channels.length} aria-disabled={!channels.length} onClick={() => channels.length && openManual()}>{t("Prepare report")}</Button>}
      {canManage && canGenerate && !defaultPeriod && <p className={styles.sidebarHint}>{t("A default UTC report period is unavailable. You can still prepare reports from existing schedules.")}</p>}
      {!channels.length && canManage && canGenerate && <p className={styles.sidebarHint}>{t("Choose an available channel before preparing a report.")}</p>}
      {canManage && canSchedule && <Button variant="secondary" disabled={!channels.length} aria-disabled={!channels.length} onClick={() => channels.length && openSchedule()}>{t("New schedule")}</Button>}
      {!channels.length && canManage && canSchedule && <p className={styles.sidebarHint}>{t("Connect and select a channel before creating a schedule.")}</p>}
      {templatePager && <nav className={styles.sidebarPager} aria-label={t("Template and schedule pages")}>
        {page > 1 ? <a className="ui-button ui-button--secondary ui-button--sm" rel="prev" href={templatesHref(page - 1)}>{t("Previous page")}</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">{t("Previous page")}</span>}
        <span aria-current="page" aria-label={t("Page {0}", page)}>{t("Page")} {page}</span>
        {hasMoreTemplates || hasMoreSchedules ? <a className="ui-button ui-button--secondary ui-button--sm" rel="next" href={templatesHref(page + 1)}>{t("Next page")}</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">{t("Next page")}</span>}
      </nav>}
      {runPager && <nav className={styles.sidebarPager} aria-label={t("Report history pages")}>
        {runsPage > 1 ? <a className="ui-button ui-button--secondary ui-button--sm" rel="prev" href={runsHref(runsPage - 1)}>{t("Previous history page")}</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">{t("Previous history page")}</span>}
        <span aria-current="page" aria-label={t("History page {0}", runsPage)}>{t("History page")} {runsPage}</span>
        {runsHasMore ? <a className="ui-button ui-button--secondary ui-button--sm" rel="next" href={runsHref(runsPage + 1)}>{t("Next history page")}</a> : <span className="ui-button ui-button--secondary ui-button--sm" aria-disabled="true">{t("Next history page")}</span>}
      </nav>}
    </div>

    {notice && <RouteNotice error={notice.error} focusKey={`reports:${notice.key}`}>{notice.text}</RouteNotice>}
    <section className={styles.panel} aria-labelledby="tpl-h"><div className={styles.panelHeading}><div><h2 id="tpl-h"><IconFileAnalytics aria-hidden="true" /> {t("Report templates")}</h2><p>{t("Save the sections and period your team reuses.")}</p></div></div>
      {templates.length ? <DataTable caption={t("Report templates")} rows={templates} rowKey={row => row.id} columns={[
        { key: 'name', label: t("Template"), render: row => <strong>{row.name}</strong> },
        { key: 'period', label: t("Period and sections"), render: row => <>{t(policy.rangeOptions.find(option => option.id === row.rangeKey)?.label ?? t("Saved period"))}<span className={styles.secondaryLine}>{row.sections.map(section => t(sectionLabels.get(section) ?? t("Saved section"))).join(', ') || t("No sections selected")}</span></> },
        { key: 'schedules', label: t("Schedules"), render: row => row.scheduleCount },
        ...(canManage ? [{ key: 'edit', label: t("Edit"), render: (row: TemplateRow) => <Button size="sm" variant="secondary" disabled={busy} onClick={() => openTemplate(row)}>{t("Edit")}</Button> }] : []),
      ]} rowActions={canManage ? row => [{ key: 'delete', label: t("Delete"), icon: <IconTrash />, danger: true, disabled: busy, onSelect: () => removeTemplate(row) }] : undefined} rowActionsLabel={row => t("Actions for {0}", row.name)} /> : <div className={styles.emptyState}><h3>{page > 1 ? t("No templates on this page") : t("No templates yet")}</h3><p>{page > 1 ? t("Use Previous page to return to saved templates.") : canManage ? t("Create a template to reuse the report sections and period your team needs.") : t("A workspace editor can create a reusable report template.")}</p></div>}
    </section>

    <section className={styles.panel} aria-labelledby="sch-h"><div className={styles.panelHeading}><div><h2 id="sch-h"><IconCalendar aria-hidden="true" /> {t("Scheduled reports")}</h2><p>{canSchedule ? t("Reports go to the selected recipients on the workspace schedule.") : t("Existing schedules stay available for review and editing.")}</p></div></div>
      {!canSchedule && <p className={styles.info} role="status">{t("Scheduled email is temporarily unavailable. You can still review and edit saved schedules.")}</p>}
      {schedules.length ? <DataTable caption={t("Scheduled reports")} rows={schedules} rowKey={row => row.id} columns={[
        { key: 'channel', label: t("Channel and frequency"), render: row => <><strong>{row.channelName ?? t("Unavailable channel")}</strong><span className={styles.secondaryLine}>{t(policy.frequencyOptions.find(option => option.id === row.frequency)?.label ?? t('Saved frequency ({0})', row.frequency))}</span></> },
        { key: 'report', label: t("Report"), render: row => row.templateName ?? (row.templateId ? t("Saved template unavailable") : t("All selected sections")) },
        { key: 'recipients', label: t("Recipients"), render: row => <>{row.recipientCount}{canManage && row.recipients.length > 0 && <span className={styles.secondaryLine}>{row.recipients.join(', ')}</span>}</> },
        { key: 'next', label: t("Next run"), render: row => <>{row.nextRunLabel ?? formatInZone(row.nextRunAt, timeZone, locale, t('Time unavailable'))}<span className={styles.secondaryLine}>{timeZone}</span></> },
        { key: 'outcome', label: t("Last result"), render: row => t(OUTCOME[row.lastOutcome] ?? t("Status unavailable")) },
        ...(canManage ? [{ key: 'edit', label: t("Actions"), render: (row: ScheduleRow) => <div className={styles.actions}>{canGenerate && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void prepare(row)}>{busy ? t("Preparing…") : t("Prepare now")}</Button>}<Button size="sm" variant="secondary" disabled={busy} onClick={() => openSchedule(row)}>{t("Edit")}</Button></div> }] : []),
      ]} rowActions={canManage ? row => [{ key: 'delete', label: t("Delete"), icon: <IconTrash />, danger: true, disabled: busy, onSelect: () => removeSchedule(row) }] : undefined} rowActionsLabel={row => t("Actions for {0}", row.channelName ?? t("Unavailable channel"))} /> : <div className={styles.emptyState}><h3>{page > 1 ? t("No schedules on this page") : t("No scheduled reports")}</h3><p>{page > 1 ? t("Use Previous page to return to saved schedules.") : canSchedule && canManage ? t("Create a schedule to send reports to people who need them.") : canSchedule ? t("No report schedules are set up for channels you can access.") : t("No report schedules are set up for channels you can access.")}</p></div>}
      {prepared && <div className={styles.prepared} role="region" aria-labelledby="prepared-title"><div><h3 id="prepared-title">{t("Report prepared")}</h3><p>{prepared.rowCount} {t("rows ·")} {prepared.bytes.toLocaleString(locale)} {t("bytes")}{prepared.truncated ? t(" · Shortened to fit the configured limit") : ''}</p>{prepared.notIncluded.length > 0 && <p>{t("Not included yet:")} {prepared.notIncluded.map(section => t(sectionLabels.get(section) ?? t("Some sections"))).join(', ')}.</p>}</div><ReportDownloads copy={downloadCopy} locale={locale} prepared={prepared} /></div>}
      <p>{t("Published posts includes a content log, daily UTC publication totals and currently failed destinations updated in the period. Failed rows are current state, not attempt history. Logs may be shortened; daily totals cover the full period.")}</p>
      <p className={styles.note}>{t("Reports use stored analytics. Missing data is shown as unavailable, not zero. “Prepare report” creates a download and does not email anyone; scheduled runs send to their saved recipients.")}</p>
      <p className={styles.note}>{t("Top posts includes saved destination text, media links and article details. Content may have changed since publication; links may expire.")}</p>
    </section>

    <section className={styles.panel} aria-labelledby="run-h"><div className={styles.panelHeading}><div><h2 id="run-h"><IconHistory aria-hidden="true" /> {t("Report history")}</h2><p>{t("Preparation and email outcomes, by channel and reporting period.")}</p></div></div>
      {!canGenerate && <p className={styles.info} role="status">{t("Report preparation and history are temporarily unavailable. Existing templates and schedules remain available.")}</p>}
      {runs.length ? <DataTable caption={t("Report history")} rows={runs} rowKey={run => run.id} columns={[
        { key: 'result', label: t("Result"), render: run => <><Badge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : ['partial', 'uncertain'].includes(run.status) ? 'warning' : 'neutral'}>{runStatus(run)}</Badge><span className={styles.secondaryLine}>{run.kind === 'manual' ? t("Prepared for download") : t("Scheduled email")}</span></> },
        { key: 'period', label: t("Channel and period"), render: run => <>{channels.find(channel => channel.id === run.channelId)?.name ?? t("Channel unavailable")}<span className={styles.secondaryLine}>{run.periodStart} {t("to")} {run.periodEnd}</span></> },
        { key: 'started', label: t("Started"), render: run => <>{run.startedLabel ?? formatInZone(run.startedAt, timeZone, locale, t('Time unavailable'))}<span className={styles.secondaryLine}>{timeZone}</span></> },
        { key: 'rows', label: t("Rows"), align: 'end', render: run => <>{run.rowCount === null ? '—' : run.rowCount}{run.truncated ? t(" · shortened") : ''}{run.note && <span className={styles.secondaryLine}>{run.note}</span>}</> },
        { key: 'delivery', label: t("Delivery"), render: run => run.deliveries.length ? run.deliveries.map((delivery, index) => <span className={styles.deliveryLine} key={`${delivery.mask}-${index}`}>{delivery.mask} · {t(DELIVERY[delivery.status] ?? t("status unavailable"))}</span>) : run.kind === 'manual' && run.status === 'completed' ? t("Download prepared") : t("No recipient details") },
      ]} /> : <div className={styles.emptyState}><h3>{runsPage > 1 ? t("No runs on this page") : t("No report runs yet")}</h3><p>{runsPage > 1 ? t("Use Previous history page to return to report history.") : t("Prepared downloads and scheduled deliveries will appear here after the first report runs.")}</p></div>}
    </section>

    <Dialog closeLabel={t('Close')} open={form === 'template'} title={editingTemplate ? t("Edit template") : t("New template")} description={t("A template saves report sections and a preferred period for reuse.")} busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>{t("Cancel")}</Button><Button type="submit" form="tpl-form" variant="primary" disabled={busy}>{busy ? t("Saving…") : editingTemplate ? t("Save changes") : t("Create template")}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`template-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="tpl-form" className={styles.form} onSubmit={event => { event.preventDefault(); void saveTemplate(event); }} noValidate>
        <label className={styles.field} htmlFor="report-template-name">{t("Template name")}<input id="report-template-name" name="name" required maxLength={nameMax} disabled={busy} value={tpl.name} aria-invalid={tplValidation.errors.name ? true : undefined} aria-describedby={tplValidation.errors.name ? 'report-template-name-error' : undefined} onChange={event => setTpl(current => ({ ...current, name: event.target.value }))} /><FieldError id="report-template-name-error">{tplValidation.errors.name}</FieldError></label>
        <label className={styles.field} htmlFor="report-template-range">{t("Preferred period")}<select id="report-template-range" name="rangeKey" disabled={busy} value={tpl.rangeKey} onChange={event => setTpl(current => ({ ...current, rangeKey: event.target.value }))}>{!policy.rangeOptions.some(option => option.id === tpl.rangeKey) && <option value={tpl.rangeKey}>{t("Saved period (kept from this template)")}</option>}{policy.rangeOptions.map(option => <option key={option.id} value={option.id}>{t(option.label)}</option>)}</select></label>
        <fieldset className={styles.checks} disabled={busy} aria-describedby={tplValidation.errors.sections ? 'report-template-sections-error' : undefined}><legend>{t("Sections")}</legend>{policy.sectionOptions.map(option => <label className={styles.sectionChoice} key={option.id}><input name="sections" type="checkbox" checked={tpl.sections.includes(option.id)} onChange={() => toggleSection(option.id)} /><IconChartBar aria-hidden="true" /><span>{t(option.label)}</span></label>)}{editingTemplate?.sections.filter(id => !supportedSet.has(id)).map(id => <label className={styles.check} key={id}><input name="sections" type="checkbox" checked disabled /><span>{t(sectionLabels.get(id) ?? t("Saved section"))} {t("· kept from this template (unavailable in new reports)")}</span></label>)}<FieldError id="report-template-sections-error">{tplValidation.errors.sections}</FieldError></fieldset>
        {editingTemplate && editingTemplate.scheduleCount > 0 && <p className={styles.note}>{t("Changes apply to")} {existingSchedules(editingTemplate.scheduleCount)} {t("using this template.")}</p>}
      </form>
    </Dialog>

    <Dialog closeLabel={t('Close')} open={form === 'schedule'} title={editingSchedule ? t("Edit schedule") : t("New schedule")} description={t("Choose a channel, how often the report is sent, and who receives it.")} busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>{t("Cancel")}</Button><Button type="submit" form="sch-form" variant="primary" disabled={busy || (!editingSchedule && !canSchedule)}>{busy ? t("Saving…") : editingSchedule ? t("Save changes") : t("Review schedule")}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`schedule-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="sch-form" className={styles.form} onSubmit={event => { event.preventDefault(); void saveSchedule(event); }} noValidate>
        <label className={styles.field} htmlFor="report-schedule-channel">{t("Channel")}<select id="report-schedule-channel" name="channelId" required disabled={busy || Boolean(editingSchedule)} value={sch.channelId} aria-invalid={schValidation.errors.channelId ? true : undefined} aria-describedby={schValidation.errors.channelId ? 'report-schedule-channel-error' : undefined} onChange={event => setSch(current => ({ ...current, channelId: event.target.value }))}>{editingSchedule && !channels.some(channel => channel.id === sch.channelId) && <option value={sch.channelId}>{editingSchedule.channelName ?? t("Unavailable channel")} {t("(no longer available)")}</option>}{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><FieldError id="report-schedule-channel-error">{schValidation.errors.channelId}</FieldError></label>
        {!policy.frequencyOptions.some(option => option.id === sch.frequency)
          ? <label className={styles.field}>{t('Frequency')}<select name="frequency" disabled={busy} value={sch.frequency} onChange={event => setSch(current => ({ ...current, frequency: event.target.value }))}><option value={sch.frequency}>{t('Saved frequency (kept from this schedule)')}</option>{policy.frequencyOptions.map(option => <option key={option.id} value={option.id}>{t(option.label)}</option>)}</select></label>
          : <fieldset className={styles.frequency}><legend>{t("Frequency")}</legend><SegmentedControl legend={t("Frequency")} value={sch.frequency} onChange={frequency => setSch(current => ({ ...current, frequency }))} options={[
          ...policy.frequencyOptions.map(option => ({ value: option.id, label: t(option.label), disabled: busy })),
        ]} /><input type="hidden" name="frequency" value={sch.frequency} /></fieldset>}
        <label className={styles.field} htmlFor="report-schedule-template">{t("Template")}<select id="report-schedule-template" name="templateId" disabled={busy} value={sch.templateId} onChange={event => setSch(current => ({ ...current, templateId: event.target.value }))}><option value="">{t("All selected sections")}</option>{editingSchedule?.templateId && !templateOptions.some(template => template.id === editingSchedule.templateId) && <option value={editingSchedule.templateId}>{editingSchedule.templateName ?? t("Saved template")} {t("(unavailable here; saved choice retained)")}</option>}{templateOptions.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label className={styles.field} htmlFor="report-schedule-recipients">{t("Recipient email addresses")}<AutoTextarea id="report-schedule-recipients" name="recipients" rows={3} required disabled={busy} value={sch.recipients} aria-invalid={schValidation.errors.recipients ? true : undefined} aria-describedby={schValidation.errors.recipients ? 'report-schedule-recipients-error' : 'report-schedule-recipients-help'} onChange={event => setSch(current => ({ ...current, recipients: event.target.value }))} /><span id="report-schedule-recipients-help">{t("Separate addresses with commas, spaces, or semicolons.")}{recipientMax ? t(" Up to {0} recipients.", recipientMax) : ''}</span><FieldError id="report-schedule-recipients-error">{schValidation.errors.recipients}</FieldError></label>
      </form>
    </Dialog>

    <Dialog closeLabel={t('Close')} open={form === 'manual'} title={t("Prepare report")} description={t("Create a download for one channel and a chosen UTC date range. This does not send email.")} busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>{t("Cancel")}</Button><Button type="submit" form="manual-form" variant="primary" disabled={busy || !channels.length}>{busy ? t("Preparing…") : t("Review report")}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`manual-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="manual-form" className={styles.form} onSubmit={submitManual} noValidate>
        <label className={styles.field} htmlFor="report-manual-channel">{t("Channel")}<select id="report-manual-channel" name="channelId" required disabled={busy} value={manual.channelId} aria-invalid={manualValidation.errors.channelId ? true : undefined} aria-describedby={manualValidation.errors.channelId ? 'report-manual-channel-error' : undefined} onChange={event => setManual(current => ({ ...current, channelId: event.target.value }))}>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><FieldError id="report-manual-channel-error">{manualValidation.errors.channelId}</FieldError></label>
        <label className={styles.field} htmlFor="report-manual-template">{t("Template")}<select id="report-manual-template" name="templateId" disabled={busy} value={manual.templateId} onChange={event => setManual(current => ({ ...current, templateId: event.target.value }))}><option value="">{t("Use the default report sections")}</option>{manual.templateId && !templateOptions.some(template => template.id === manual.templateId) && <option value={manual.templateId}>{templates.find(template => template.id === manual.templateId)?.name ?? t("Saved template")} {t("(unavailable)")}</option>}{templateOptions.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label className={styles.field} htmlFor="report-manual-start">{t("From (UTC)")}<input id="report-manual-start" name="start" type="date" required disabled={busy} value={manual.start} aria-invalid={manualValidation.errors.start ? true : undefined} aria-describedby={manualValidation.errors.start ? 'report-manual-start-error' : undefined} onChange={event => setManual(current => ({ ...current, start: event.target.value }))} /><FieldError id="report-manual-start-error">{manualValidation.errors.start}</FieldError></label>
        <label className={styles.field} htmlFor="report-manual-end">{t("Through (UTC)")}<input id="report-manual-end" name="end" type="date" required disabled={busy} value={manual.end} aria-invalid={manualValidation.errors.end ? true : undefined} aria-describedby={`report-manual-range-help${manualValidation.errors.end ? ' report-manual-end-error' : ''}`} onChange={event => setManual(current => ({ ...current, end: event.target.value }))} /><span id="report-manual-range-help">{t("Choose an inclusive range of up to")} {defaultPeriod?.maxDays ?? '—'} {t("days.")}</span><FieldError id="report-manual-end-error">{manualValidation.errors.end}</FieldError></label>
      </form>
    </Dialog>

    <Dialog closeLabel={t('Close')} open={Boolean(pending)} title={pending?.title ?? ''} description={pending?.detail} busy={busy} onClose={() => !busy && setPending(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setPending(null)}>{t("Cancel")}</Button><Button variant={pending?.destructive ? 'danger' : 'primary'} disabled={busy || Boolean(pending?.acknowledgement && !acknowledged)} onClick={() => pending && void write(pending)}>{busy ? t("Saving…") : pending?.confirmLabel ?? t("Confirm")}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`write-error:${dialogError}`}>{dialogError}</RouteNotice>}
      {pending?.acknowledgement && <label className={styles.acknowledgement}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>{pending.acknowledgement}</span></label>}
    </Dialog>
  </div>;
}
