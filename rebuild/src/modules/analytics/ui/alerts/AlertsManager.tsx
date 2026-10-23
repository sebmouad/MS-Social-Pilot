'use client';
import { alertsCopy, type AlertsCopy } from '@/modules/analytics/alerts/copy';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/DataTable';
import { Badge } from '@/components';
import { IconBellRinging } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { RouteNotice } from '@/components/RouteNotice';
import reportStyles from '@/modules/analytics/ui/reports/workflows.module.css';

export type AlertRuleRow = {
  id: string; channelId: string; channelName: string | null; channelAvailable: boolean; name: string;
  metric: string; operator: string; threshold: number; windowDays: number; enabled: boolean;
  state: string; lastActual: number | null; lastEvaluatedAt: string | null;
};
export type AlertFiringRow = {
  id: string; ruleName: string; channelName: string | null; metric: string; operator: string; threshold: number;
  actual: number; firedAt: string; firedLabel: string; resolvedAt: string | null;
};

type Draft = { channelId: string; name: string; metric: string; operator: string; threshold: string; windowDays: string; enabled: boolean };

/**
 * Metric alerts panel on the Reports page. Rules and firings share the
 * page's channel scope; a firing also lands in the notification center.
 */
export function AlertsManager({ rules, firings, canManage, channels, locale = 'en', copy }: {
  rules: AlertRuleRow[]; firings: AlertFiringRow[]; canManage: boolean;
  channels: Array<{ id: string; name: string }>; locale?: 'en' | 'fr'; copy?: Record<string, { en: string; fr: string }>;
}) {
  const t: AlertsCopy = alertsCopy(locale, copy);
  const router = useRouter();
  const [form, setForm] = useState<'rule' | null>(null);
  const [editing, setEditing] = useState<AlertRuleRow | null>(null);
  const [draft, setDraft] = useState<Draft>({ channelId: channels[0]?.id ?? '', name: '', metric: 'views', operator: 'below', threshold: '', windowDays: '7', enabled: true });
  const [removing, setRemoving] = useState<AlertRuleRow | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const validation = useFormValidation();
  const inFlight = useRef(false);
  const metricLabel = (metric: string) => metric === 'followers' ? t.metricFollowers : metric === 'views' ? t.metricViews : metric === 'engagements' ? t.metricEngagements : t.metricPosts;
  const stateLabel = (row: AlertRuleRow) => !row.enabled ? t.disabled : row.state === 'firing' ? t.firing : row.state === 'ok' ? t.ok : t.unknown;

  const openRule = (row?: AlertRuleRow) => {
    setEditing(row ?? null);
    setDraft(row ? { channelId: row.channelId, name: row.name, metric: row.metric, operator: row.operator, threshold: String(row.threshold), windowDays: String(row.windowDays), enabled: row.enabled } : { channelId: channels[0]?.id ?? '', name: '', metric: 'views', operator: 'below', threshold: '', windowDays: '7', enabled: true });
    validation.clearAll(); setDialogError(''); setForm('rule');
  };

  async function write(url: string, body: Record<string, unknown>, successMessage: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setDialogError('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || (result as { ok?: unknown }).ok !== true) throw new Error(result && typeof result === 'object' && 'error' in result && typeof (result as { error: unknown }).error === 'string' ? (result as { error: string }).error : t.saveFailed);
      setForm(null); setEditing(null); setRemoving(null); setAcknowledged(false);
      setNotice({ error: false, text: successMessage });
      router.refresh();
    } catch (error) { setDialogError(error instanceof Error ? error.message : t.saveFailed); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const threshold = Number(draft.threshold);
    const valid = validation.validate(event.currentTarget, {
      channelId: !draft.channelId ? t.chooseChannel : '',
      name: !draft.name.trim() ? t.enterName : '',
      threshold: draft.threshold.trim() === '' || !Number.isFinite(threshold) || threshold < 0 ? t.enterThreshold : '',
    });
    if (!valid) return;
    const row = editing;
    const confirmation = row ? `UPDATE METRIC ALERT ${row.id}` : `CREATE METRIC ALERT ${draft.channelId} ${draft.metric}`;
    void write('/api/analytics/alerts', row
      ? { action: 'update', id: row.id, name: draft.name.trim(), metric: draft.metric, operator: draft.operator, threshold, windowDays: Number(draft.windowDays), enabled: draft.enabled, confirmation }
      : { action: 'create', channelId: draft.channelId, name: draft.name.trim(), metric: draft.metric, operator: draft.operator, threshold, windowDays: Number(draft.windowDays), enabled: draft.enabled, confirmation },
      row ? t.saved : t.created);
  }

  return <>
    {notice && <RouteNotice error={notice.error} focusKey={`alerts:${notice.text}`}>{notice.text}</RouteNotice>}
    <section className={reportStyles.panel} aria-labelledby="alert-h">
      <div className={reportStyles.panelHeading}>
        <div><h2 id="alert-h"><IconBellRinging aria-hidden="true" /> {t.title}</h2><p>{t.description}</p></div>
        {canManage && <Button variant="primary" disabled={!channels.length} onClick={() => channels.length && openRule()}>{t.newRule}</Button>}
      </div>
      {rules.length ? <DataTable caption={t.title} rows={rules} rowKey={row => row.id} columns={[
        { key: 'rule', label: t.rule, render: row => <><strong>{row.name}</strong><span className={reportStyles.secondaryLine}>{row.channelName ?? row.channelId}{row.channelAvailable ? '' : ' · ⚠'}</span></> },
        { key: 'condition', label: t.condition, render: row => <>{metricLabel(row.metric)} {row.operator === 'above' ? t.above : t.below} {row.threshold.toLocaleString(locale)}<span className={reportStyles.secondaryLine}>{row.windowDays === 30 ? t.window30 : t.window7}</span></> },
        { key: 'state', label: t.state, render: row => <><Badge tone={row.state === 'firing' && row.enabled ? 'warning' : 'neutral'}>{stateLabel(row)}</Badge>{row.lastActual !== null && <span className={reportStyles.secondaryLine}>{t.actual}: {row.lastActual.toLocaleString(locale)}</span>}</> },
        ...(canManage ? [{ key: 'edit', label: t.edit, render: (row: AlertRuleRow) => <div className={reportStyles.actions}><Button size="sm" variant="secondary" disabled={busy} onClick={() => openRule(row)}>{t.edit}</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => { setRemoving(row); setAcknowledged(false); setDialogError(''); }}>{t.delete}</Button></div> }] : []),
      ]} /> : <div className={reportStyles.emptyState}><h3>{t.noRulesTitle}</h3><p>{canManage ? t.noRulesBody : t.noRulesReadOnly}</p></div>}
    </section>

    <section className={reportStyles.panel} aria-labelledby="alert-firings-h">
      <div className={reportStyles.panelHeading}><div><h2 id="alert-firings-h">{t.firingsTitle}</h2></div></div>
      {firings.length ? <DataTable caption={t.firingsTitle} rows={firings} rowKey={row => row.id} columns={[
        { key: 'rule', label: t.rule, render: row => <><strong>{row.ruleName}</strong><span className={reportStyles.secondaryLine}>{row.channelName ?? ''}</span></> },
        { key: 'condition', label: t.condition, render: row => <>{metricLabel(row.metric)} {row.operator === 'above' ? t.above : t.below} {row.threshold.toLocaleString(locale)}<span className={reportStyles.secondaryLine}>{t.actual}: {row.actual.toLocaleString(locale)}</span></> },
        { key: 'state', label: t.state, render: row => <><Badge tone={row.resolvedAt ? 'neutral' : 'warning'}>{row.resolvedAt ? t.resolved : t.firing}</Badge><span className={reportStyles.secondaryLine}>{row.firedLabel}</span></> },
      ]} /> : <div className={reportStyles.emptyState}><h3>{t.firingsTitle}</h3><p>{t.firingsEmpty}</p></div>}
    </section>

    <Dialog closeLabel={t.cancel} open={form === 'rule'} title={editing ? t.edit : t.newRule} description={t.description} busy={busy} onClose={() => !busy && setForm(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setForm(null)}>{t.cancel}</Button><Button type="submit" form="alert-form" variant="primary" disabled={busy}>{busy ? t.saving : t.save}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`alert-error:${dialogError}`}>{dialogError}</RouteNotice>}
      <form id="alert-form" className={reportStyles.form} onSubmit={save} noValidate>
        <label className={reportStyles.field} htmlFor="alert-channel">{t.channel}<select id="alert-channel" name="channelId" required disabled={busy || Boolean(editing)} value={draft.channelId} aria-invalid={validation.errors.channelId ? true : undefined} aria-describedby={validation.errors.channelId ? 'alert-channel-error' : undefined} onChange={event => setDraft(current => ({ ...current, channelId: event.target.value }))}>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select><FieldError id="alert-channel-error">{validation.errors.channelId}</FieldError></label>
        <label className={reportStyles.field} htmlFor="alert-name">{t.name}<input id="alert-name" name="name" required maxLength={80} disabled={busy} value={draft.name} aria-invalid={validation.errors.name ? true : undefined} aria-describedby={validation.errors.name ? 'alert-name-error' : undefined} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /><FieldError id="alert-name-error">{validation.errors.name}</FieldError></label>
        <label className={reportStyles.field} htmlFor="alert-metric">{t.metric}<select id="alert-metric" name="metric" disabled={busy} value={draft.metric} onChange={event => setDraft(current => ({ ...current, metric: event.target.value }))}>{['followers', 'views', 'engagements', 'posts'].map(metric => <option key={metric} value={metric}>{metricLabel(metric)}</option>)}</select></label>
        <label className={reportStyles.field} htmlFor="alert-operator">{t.operator}<select id="alert-operator" name="operator" disabled={busy} value={draft.operator} onChange={event => setDraft(current => ({ ...current, operator: event.target.value }))}><option value="above">{t.above}</option><option value="below">{t.below}</option></select></label>
        <label className={reportStyles.field} htmlFor="alert-threshold">{t.threshold}<input id="alert-threshold" name="threshold" required inputMode="decimal" disabled={busy} value={draft.threshold} aria-invalid={validation.errors.threshold ? true : undefined} aria-describedby={validation.errors.threshold ? 'alert-threshold-error' : undefined} onChange={event => setDraft(current => ({ ...current, threshold: event.target.value }))} /><FieldError id="alert-threshold-error">{validation.errors.threshold}</FieldError></label>
        <label className={reportStyles.field} htmlFor="alert-window">{t.window}<select id="alert-window" name="windowDays" disabled={busy} value={draft.windowDays} onChange={event => setDraft(current => ({ ...current, windowDays: event.target.value }))}><option value="7">{t.window7}</option><option value="30">{t.window30}</option></select></label>
        <label className={reportStyles.field} htmlFor="alert-enabled"><input id="alert-enabled" name="enabled" type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => setDraft(current => ({ ...current, enabled: event.target.checked }))} /> {t.enabled}</label>
      </form>
    </Dialog>

    <Dialog closeLabel={t.cancel} open={Boolean(removing)} title={t.deleteTitle} description={removing ? t.deleteDetail : undefined} busy={busy} onClose={() => !busy && setRemoving(null)} actions={<><Button data-dialog-cancel variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>{t.cancel}</Button><Button variant="danger" disabled={busy || !acknowledged} onClick={() => removing && void write('/api/analytics/alerts', { action: 'delete', id: removing.id, confirmation: `DELETE METRIC ALERT ${removing.id}` }, t.deleted)}>{busy ? t.saving : t.deleteConfirm}</Button></>}>
      {dialogError && <RouteNotice error className="ui-error" focusKey={`alert-delete-error:${dialogError}`}>{dialogError}</RouteNotice>}
      {removing && <label className={reportStyles.acknowledgement}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} /><span>{t.acknowledgeDelete}</span></label>}
    </Dialog>
  </>;
}
