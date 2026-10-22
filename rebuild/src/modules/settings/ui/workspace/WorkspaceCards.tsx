'use client';
import { useRef, useState, type ReactNode } from 'react';
import { Select, Switch, useToast } from '@/components';
import { Button } from '@/components/Button';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';
import { workspaceOperationsConfirmation, WORKSPACE_OPERATION_BOUNDS as B, type WorkspaceOperations } from '@/modules/settings/workspace-operations';
import type { SectionsCopy } from '@/modules/settings/ui/sections-copy';
import styles from './cards.module.css';

type Locale = 'en' | 'fr';
type Fields = Partial<Record<keyof WorkspaceOperations, unknown>>;

/** One card = one independent save. `onSave` returns an error text, or null on success. */
function Card({ id, title, detail, canSave, dirty, invalid, copy, onSave, children }: { id: string; title: string; detail: string; canSave: boolean; dirty: boolean; invalid?: string; copy: SectionsCopy; onSave: () => Promise<string | null>; children: ReactNode }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current || invalid) return;
    inFlight.current = true; setBusy(true); setError('');
    const failure = await onSave().catch(() => copy.unavailable);
    inFlight.current = false; setBusy(false);
    if (failure) { setError(failure); toast.failed(failure, () => void save(), copy.save); return; }
    toast.notify({ title: `${title} · ${copy.saved}` });
  }
  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <header className={styles.head}><h2 id={`${id}-title`}>{title}</h2><p>{detail}</p></header>
    <form noValidate className={styles.body} onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className={styles.fields} disabled={busy || !canSave}>{children}</fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {invalid && <p className={styles.error} role="alert">{invalid}</p>}
      <footer className={styles.foot}>
        {!canSave ? <span className={styles.note}>{copy.readOnly}</span> : <Button type="submit" variant="primary" size="sm" disabled={busy || !dirty || Boolean(invalid)}>{busy ? copy.saving : copy.save}</Button>}
      </footer>
    </form>
  </section>;
}

export type WorkspaceCardsProps = {
  locale: Locale; copy: SectionsCopy; workspaceId: string; workspaceName: string; canManage: boolean;
  policy: { timezone: string; requiresApproval: boolean; maxTimezoneCharacters: number };
  operations: WorkspaceOperations; timezones: string[]; bestTime?: ReactNode;
};

export function WorkspaceCards({ locale, copy, workspaceId, workspaceName, canManage, policy, operations, timezones, bestTime }: WorkspaceCardsProps) {
  const ops = useSettingsCopy('operations', locale);
  const policyCopy = useSettingsCopy('workspace', locale);
  const [savedPolicy, setSavedPolicy] = useState(policy);
  const [zone, setZone] = useState(policy.timezone);
  const [approval, setApproval] = useState(policy.requiresApproval);
  const [savedOps, setSavedOps] = useState(operations);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const value = <K extends keyof WorkspaceOperations>(key: K): WorkspaceOperations[K] => (key in draft ? draft[key] : savedOps[key]) as WorkspaceOperations[K];
  const text = (key: 'utmSource' | 'utmMedium' | 'utmCampaignTemplate' | 'aiTone' | 'aiBrandVoice' | 'aiAvoidWords') => String(value(key) ?? '');
  const set = (key: keyof WorkspaceOperations, next: unknown) => setDraft(current => ({ ...current, [key]: next }));
  const dirtyOf = (keys: Array<keyof WorkspaceOperations>) => keys.some(key => key in draft && JSON.stringify(draft[key]) !== JSON.stringify(savedOps[key] ?? ''));

  async function savePolicy(next: { timezone: string; requiresApproval: boolean }): Promise<string | null> {
    const response = await fetch('/api/settings/workspace/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...next, confirmation: `UPDATE WORKSPACE POLICY ${workspaceId}` }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) return typeof result.error === 'string' ? result.error : policyCopy.unconfirmed;
    setSavedPolicy({ ...savedPolicy, ...next });
    return null;
  }
  /** The service replaces the whole settings object, so a card sends its own fields on top of the last saved state. */
  async function saveOps(keys: Array<keyof WorkspaceOperations>): Promise<string | null> {
    const merged: Record<string, unknown> = { ...savedOps };
    for (const key of keys) if (key in draft) merged[key] = typeof savedOps[key] === 'string' || savedOps[key] === null ? (String(draft[key]).trim() === '' ? null : draft[key]) : draft[key];
    const response = await fetch('/api/settings/workspace/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: merged, confirmation: workspaceOperationsConfirmation(workspaceId) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true || !result.settings) return typeof result.error === 'string' ? result.error : ops.unconfirmed;
    setSavedOps(result.settings);
    setDraft(current => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key as keyof WorkspaceOperations))));
    return null;
  }

  const field = (label: string, control: ReactNode, hint?: string) => <label className={styles.field}><span>{label}</span>{control}{hint && <small>{hint}</small>}</label>;
  const textInput = (key: Parameters<typeof text>[0], max: number, label: string, hint?: string) => field(label, <input value={text(key)} maxLength={max} autoComplete="off" onChange={event => set(key, event.target.value)} />, hint);
  const numberInput = (key: 'spamGapMinutes' | 'undoSendSeconds' | 'businessStart' | 'businessEnd', min: number, max: number, label: string, hint?: string) =>
    field(label, <input type="number" inputMode="numeric" min={min} max={max} step={1} required value={Number(value(key))} onChange={event => set(key, Number(event.target.value))} />, hint);

  const hoursKeys: Array<keyof WorkspaceOperations> = ['weekStartsOn', 'businessDays', 'businessStart', 'businessEnd'];
  const hoursInvalid = Number(value('businessEnd')) <= Number(value('businessStart')) ? copy.hours.invalid : undefined;
  const toggleDay = (day: number) => { const days = value('businessDays'); set('businessDays', days.includes(day) ? days.filter(item => item !== day) : [...days, day].sort((a, b) => a - b)); };
  const zoneOptions = [...new Set([savedPolicy.timezone, ...timezones])].map(name => ({ value: name, label: name.replace(/_/g, ' ') }));
  const linkKeys: Array<keyof WorkspaceOperations> = ['utmSource', 'utmMedium', 'utmCampaignTemplate', 'shortenerEnabled'];
  const queueKeys: Array<keyof WorkspaceOperations> = ['spamGapMinutes', 'undoSendSeconds', 'bestTimeMode'];
  const voiceKeys: Array<keyof WorkspaceOperations> = ['aiEnabled', 'aiTone', 'aiBrandVoice', 'aiAvoidWords'];

  return <div className={styles.cards}>
    <Card id="ws-name" copy={copy} title={copy.name.title} detail={copy.name.detail} canSave={canManage} dirty={zone !== savedPolicy.timezone} onSave={() => savePolicy({ timezone: zone, requiresApproval: savedPolicy.requiresApproval })}>
      {field(copy.name.nameLabel, <input value={workspaceName} readOnly aria-readonly="true" />, copy.name.nameHint)}
      {field(copy.name.zoneLabel, <Select aria-label={copy.name.zoneLabel} value={zone} onChange={setZone} options={zoneOptions} searchable searchLabel={copy.name.zoneSearch} noMatchLabel={copy.name.zoneNone} />, policyCopy.timezoneHint)}
    </Card>
    <Card id="ws-approvals" copy={copy} title={copy.approvals.title} detail={copy.approvals.detail} canSave={canManage} dirty={approval !== savedPolicy.requiresApproval} onSave={() => savePolicy({ timezone: savedPolicy.timezone, requiresApproval: approval })}>
      <Switch checked={approval} onChange={setApproval} label={copy.approvals.switchLabel} />
    </Card>
    <Card id="ws-hours" copy={copy} title={copy.hours.title} detail={copy.hours.detail} canSave={canManage} dirty={dirtyOf(hoursKeys)} invalid={hoursInvalid} onSave={() => saveOps(hoursKeys)}>
      <div className={styles.field}><span>{ops.weekStartsOn}</span><Select aria-label={ops.weekStartsOn} value={String(value('weekStartsOn'))} onChange={next => set('weekStartsOn', Number(next))} options={ops.dayNames.map((name, index) => ({ value: String(index), label: name }))} /></div>
      <div className={styles.field}><span>{copy.hours.days}</span><div className={styles.days}>{ops.days.map((name, index) => <label key={name} className={styles.day} data-on={value('businessDays').includes(index)}><input type="checkbox" checked={value('businessDays').includes(index)} onChange={() => toggleDay(index)} /><span>{name}</span></label>)}</div></div>
      <div className={styles.pair}>{numberInput('businessStart', 0, 23, copy.hours.from)}{numberInput('businessEnd', 1, 24, copy.hours.to)}</div>
    </Card>
    <Card id="ws-queue" copy={copy} title={copy.queue.title} detail={copy.queue.detail} canSave={canManage} dirty={dirtyOf(queueKeys)} onSave={() => saveOps(queueKeys)}>
      <div className={styles.pair}>{numberInput('spamGapMinutes', 0, B.spamGapMinutes, copy.queue.gap, ops.spamGapHint)}{numberInput('undoSendSeconds', 0, B.undoSendSeconds, copy.queue.undo, ops.undoSendHint)}</div>
      <div className={styles.field}><span>{ops.bestTimeMode}</span><Select aria-label={ops.bestTimeMode} value={value('bestTimeMode')} onChange={next => set('bestTimeMode', next)} options={[{ value: 'suggest', label: ops.bestTimeSuggest }, { value: 'apply', label: ops.bestTimeApply }]} /></div>
      {bestTime}
    </Card>
    <Card id="ws-links" copy={copy} title={copy.links.title} detail={copy.links.detail} canSave={canManage} dirty={dirtyOf(linkKeys)} onSave={() => saveOps(linkKeys)}>
      <Switch checked={value('shortenerEnabled')} onChange={next => set('shortenerEnabled', next)} label={copy.links.shortenLabel} />
      <small className={styles.note}>{ops.shortenHint}</small>
      <details className={styles.more}><summary>{copy.links.more}</summary>
        <div className={styles.fields}>{textInput('utmSource', B.utmPart, ops.utmSource)}{textInput('utmMedium', B.utmPart, ops.utmMedium)}{textInput('utmCampaignTemplate', B.utmCampaign, ops.utmCampaign, ops.utmHint)}</div>
      </details>
    </Card>
    <Card id="ws-voice" copy={copy} title={copy.voice.title} detail={copy.voice.detail} canSave={canManage} dirty={dirtyOf(voiceKeys)} onSave={() => saveOps(voiceKeys)}>
      <Switch checked={value('aiEnabled')} onChange={next => set('aiEnabled', next)} label={copy.voice.enabledLabel} />
      {textInput('aiTone', B.aiTone, ops.aiTone)}{textInput('aiBrandVoice', B.aiBrandVoice, ops.aiBrandVoice, ops.aiBrandVoiceHint)}{textInput('aiAvoidWords', B.aiAvoidWords, ops.aiAvoidWords, ops.aiAvoidWordsHint)}
    </Card>
    <Card id="ws-moderation" copy={copy} title={copy.moderation.title} detail={copy.moderation.detail} canSave={canManage} dirty={dirtyOf(['watchNegativeComments'])} onSave={() => saveOps(['watchNegativeComments'])}>
      <Switch checked={value('watchNegativeComments')} onChange={next => set('watchNegativeComments', next)} label={copy.moderation.switchLabel} />
    </Card>
  </div>;
}
