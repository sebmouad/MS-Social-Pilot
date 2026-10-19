'use client';
// Renders only settings with live consumers (publish-time UTM tagging, composer spacing warning).
// Other stored operations values are sent back unchanged.
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { workspaceOperationsCopy } from '@/modules/settings/workspace-operations-copy';
import { WORKSPACE_OPERATION_BOUNDS as B, workspaceOperationsConfirmation, type WorkspaceOperations } from '@/modules/settings/workspace-operations';
import styles from './policy.module.css';

const t = workspaceOperationsCopy.en;
type Draft = Omit<WorkspaceOperations, 'utmSource' | 'utmMedium' | 'utmCampaignTemplate' | 'aiTone' | 'aiBrandVoice' | 'aiAvoidWords'> & Record<'utmSource' | 'utmMedium' | 'utmCampaignTemplate' | 'aiTone' | 'aiBrandVoice' | 'aiAvoidWords', string>;
const toDraft = (value: WorkspaceOperations): Draft => ({ ...value, utmSource: value.utmSource ?? '', utmMedium: value.utmMedium ?? '', utmCampaignTemplate: value.utmCampaignTemplate ?? '', aiTone: value.aiTone ?? '', aiBrandVoice: value.aiBrandVoice ?? '', aiAvoidWords: value.aiAvoidWords ?? '' });

export function WorkspaceOperationsForm({ workspaceId, initial }: { workspaceId: string; initial: WorkspaceOperations }) {
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
      setDraft(toDraft(result.settings)); setConfirmation(''); setMessage(t.saved);
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : t.unconfirmed); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const number = (key: 'spamGapMinutes', max: number, title: string, hint: string) => <label className={styles.field}><span>{title}</span><input type="number" inputMode="numeric" min={0} max={max} step={1} required disabled={busy} value={draft[key]} onChange={event => set(key, Number(event.target.value))} /><small>{hint}</small></label>;
  const text = (key: 'utmSource' | 'utmMedium' | 'utmCampaignTemplate', max: number, title: string) => <label className={styles.field}><span>{title}</span><input disabled={busy} maxLength={max} value={draft[key]} onChange={event => set(key, event.target.value)} autoComplete="off" /></label>;
  return <form className={styles.form} onSubmit={submit}>
    <fieldset className={styles.group} disabled={busy}><legend>{t.linksLegend}</legend>
      {text('utmSource', B.utmPart, t.utmSource)}{text('utmMedium', B.utmPart, t.utmMedium)}{text('utmCampaignTemplate', B.utmCampaign, t.utmCampaign)}
      <small className={styles.hint}>{t.utmHint}</small>
    </fieldset>
    <fieldset className={styles.group} disabled={busy}><legend>{t.spacingOnlyLegend}</legend>
      {number('spamGapMinutes', B.spamGapMinutes, t.spamGap, t.spamGapHint)}
    </fieldset>
    <label className={styles.field}><span>{t.confirmation}</span><input required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /><small>{expected}</small></label>
    <Button type="submit" variant="primary" disabled={busy || hoursInvalid || confirmation !== expected}>{busy ? t.saving : t.save}</Button>
    {message && <p className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{message}</p>}
  </form>;
}
