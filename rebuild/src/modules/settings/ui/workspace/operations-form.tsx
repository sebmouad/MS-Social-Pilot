'use client';
// Renders only settings with live consumers: calendar week start, report business hours, UTM tagging,
// composer spacing, best-time suggestions/queue preference, undo send, link shortening, AI voice and the negative-comment alert.
import { useRef, useState } from 'react';
import { Select, useToast } from '@/components';
import { Button } from '@/components/Button';
import { workspaceOperationsCopy } from '@/modules/settings/workspace-operations-copy';
import { WORKSPACE_OPERATION_BOUNDS as B, workspaceOperationsConfirmation, type WorkspaceOperations } from '@/modules/settings/workspace-operations';
import styles from './policy.module.css';

type Draft = Omit<WorkspaceOperations, 'utmSource' | 'utmMedium' | 'utmCampaignTemplate' | 'aiTone' | 'aiBrandVoice' | 'aiAvoidWords'> & Record<'utmSource' | 'utmMedium' | 'utmCampaignTemplate' | 'aiTone' | 'aiBrandVoice' | 'aiAvoidWords', string>;
const toDraft = (value: WorkspaceOperations): Draft => ({ ...value, utmSource: value.utmSource ?? '', utmMedium: value.utmMedium ?? '', utmCampaignTemplate: value.utmCampaignTemplate ?? '', aiTone: value.aiTone ?? '', aiBrandVoice: value.aiBrandVoice ?? '', aiAvoidWords: value.aiAvoidWords ?? '' });

export function WorkspaceOperationsForm({ workspaceId, initial, locale = 'en' }: { workspaceId: string; initial: WorkspaceOperations; locale?: 'en' | 'fr' }) {
  const toast = useToast();
  const t = workspaceOperationsCopy[locale];
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [confirmation, setConfirmation] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const expected = workspaceOperationsConfirmation(workspaceId);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const hoursInvalid = draft.businessEnd <= draft.businessStart;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current || hoursInvalid) return; inFlight.current = true; setBusy(true); setMessage(''); setError(false);
    try {
      const response = await fetch('/api/settings/workspace/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: draft, confirmation }) });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !result.settings) throw new Error(result.error ?? t.unconfirmed);
      setDraft(toDraft(result.settings)); setConfirmation(''); setMessage(t.saved); toast.notify({ title: t.saved });
    } catch (cause) { const message = cause instanceof Error ? cause.message : t.unconfirmed; setError(true); setMessage(message); toast.failed(message, () => document.querySelector<HTMLInputElement>('input[required]')?.focus(), t.save); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const toggleDay = (day: number) => set('businessDays', draft.businessDays.includes(day) ? draft.businessDays.filter(item => item !== day) : [...draft.businessDays, day].sort((a, b) => a - b));
  const aiText = (key: 'aiTone' | 'aiBrandVoice' | 'aiAvoidWords', max: number, title: string, hint?: string) => <label className={styles.field}><span>{title}</span><input disabled={busy} maxLength={max} value={draft[key]} onChange={event => set(key, event.target.value)} autoComplete="off" />{hint && <small>{hint}</small>}</label>;
  const hour = (key: 'businessStart' | 'businessEnd', min: number, max: number, title: string) => <label className={styles.field}><span>{title}</span><input type="number" inputMode="numeric" min={min} max={max} step={1} required disabled={busy} value={draft[key]} onChange={event => set(key, Number(event.target.value))} /></label>;
  const number = (key: 'spamGapMinutes' | 'undoSendSeconds', max: number, title: string, hint: string) => <label className={styles.field}><span>{title}</span><input type="number" inputMode="numeric" min={0} max={max} step={1} required disabled={busy} value={draft[key]} onChange={event => set(key, Number(event.target.value))} /><small>{hint}</small></label>;
  const text = (key: 'utmSource' | 'utmMedium' | 'utmCampaignTemplate', max: number, title: string) => <label className={styles.field}><span>{title}</span><input disabled={busy} maxLength={max} value={draft[key]} onChange={event => set(key, event.target.value)} autoComplete="off" /></label>;
  return <form noValidate className={styles.form} onSubmit={submit}>
    <fieldset className={styles.group} disabled={busy}><legend>{t.hoursLegend}</legend>
      <label className={styles.field}><span>{t.weekStartsOn}</span><Select aria-label={t.weekStartsOn} disabled={busy} value={String(draft.weekStartsOn)} onChange={value => set('weekStartsOn', Number(value))} options={t.dayNames.map((name, index) => ({ value: String(index), label: name }))} /><small>{t.weekStartsOnHint}</small></label>
      <fieldset className={styles.group}><legend>{t.businessHours}</legend>
        {t.days.map((name, index) => <label key={name}><input type="checkbox" checked={draft.businessDays.includes(index)} onChange={() => toggleDay(index)} /> {name}</label>)}
        {hour('businessStart', 0, 23, t.businessFrom)}{hour('businessEnd', 1, 24, t.businessTo)}
        <small className={styles.hint}>{t.businessHoursHint}</small>
      </fieldset>
    </fieldset>
    <label className={styles.field}><span>{t.bestTimeMode}</span><Select aria-label={t.bestTimeMode} disabled={busy} value={draft.bestTimeMode} onChange={value => set('bestTimeMode', value as Draft['bestTimeMode'])} options={[{ value: 'suggest', label: t.bestTimeSuggest }, { value: 'apply', label: t.bestTimeApply }]} /></label>
    <fieldset className={styles.group} disabled={busy}><legend>{t.linksLegend}</legend>
      {text('utmSource', B.utmPart, t.utmSource)}{text('utmMedium', B.utmPart, t.utmMedium)}{text('utmCampaignTemplate', B.utmCampaign, t.utmCampaign)}
      <small className={styles.hint}>{t.utmHint}</small>
      <label><input type="checkbox" checked={draft.shortenerEnabled} onChange={event => set('shortenerEnabled', event.target.checked)} /> {t.shortenLinks}</label>
      <small className={styles.hint}>{t.shortenHint}</small>
    </fieldset>
    <fieldset className={styles.group} disabled={busy}><legend>{t.spacingOnlyLegend}</legend>
      {number('spamGapMinutes', B.spamGapMinutes, t.spamGap, t.spamGapHint)}
      {number('undoSendSeconds', B.undoSendSeconds, t.undoSend, t.undoSendHint)}
    </fieldset>
    <fieldset className={styles.group} disabled={busy}><legend>{t.aiLegend}</legend>
      <label><input type="checkbox" checked={draft.aiEnabled} onChange={event => set('aiEnabled', event.target.checked)} /> {t.aiEnabled}</label>
      {aiText('aiTone', B.aiTone, t.aiTone)}{aiText('aiBrandVoice', B.aiBrandVoice, t.aiBrandVoice, t.aiBrandVoiceHint)}{aiText('aiAvoidWords', B.aiAvoidWords, t.aiAvoidWords, t.aiAvoidWordsHint)}
    </fieldset>
    <fieldset className={styles.group} disabled={busy}><legend>{t.moderationLegend}</legend>
      <label><input type="checkbox" checked={draft.watchNegativeComments} onChange={event => set('watchNegativeComments', event.target.checked)} /> {t.watchNegativeComments}</label>
    </fieldset>
    <label className={styles.field}><span>{t.confirmation}</span><input required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /><small>{expected}</small></label>
    <Button type="submit" variant="primary" disabled={busy || hoursInvalid || confirmation !== expected}>{busy ? t.saving : t.save}</Button>
    {message && <p className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
  </form>;
}
