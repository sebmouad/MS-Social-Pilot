'use client';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { DateRangePicker } from '@/components/DateRangePicker';
import { insightsPolicyDefaults } from '../insights/insights-config';
import { presetRange } from '../insights/period';
import styles from './compare.module.css';

type Channel = { id: string; name: string };
type Initial = {
  aStart: string; aEnd: string; bStart: string; bEnd: string;
  start: string; end: string; channel: string[]; groupA: string[]; groupB: string[];
};

const DAY_MS = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function previousSpan(start: string, end: string): { bStart: string; bEnd: string } | null {
  const fromMs = Date.parse(`${start}T00:00:00Z`);
  const toMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return null;
  const spanDays = Math.round((toMs - fromMs) / DAY_MS) + 1;
  const bEndMs = fromMs - DAY_MS;
  const bStartMs = bEndMs - (spanDays - 1) * DAY_MS;
  return { bStart: isoDay(new Date(bStartMs)), bEnd: isoDay(new Date(bEndMs)) };
}

export function ComparisonFilters({ mode: initialMode, channels, initial, copy = workspaceCopyDefaults, locale = 'en' }: { copy?: WorkspaceCopy; locale?: 'en' | 'fr'; mode: 'period' | 'channels'; channels: Channel[]; initial: Initial }) {
  const t = workspaceText(copy, locale);
  const [mode, setMode] = useState(initialMode);
  const [dates, setDates] = useState({ aStart: initial.aStart, aEnd: initial.aEnd, bStart: initial.bStart, bEnd: initial.bEnd, start: initial.start, end: initial.end });
  const [periodChannels, setPeriodChannels] = useState(initial.channel);
  const [groupA, setGroupA] = useState(initial.groupA);
  const [groupB, setGroupB] = useState(initial.groupB);
  const now = new Date();
  const presets = insightsPolicyDefaults.rangePresets.map(item => ({ id: item.id, label: item.label[locale], ...presetRange(item, now) }));
  const toggle = (current: string[], set: (next: string[]) => void, id: string, checked: boolean) => {
    set(checked ? [...current, id] : current.filter(value => value !== id));
  };
  const channelChoices = (name: string, selected: string[], set: (next: string[]) => void) => channels.length
    ? <div className={styles.chips}>{channels.map(channel => { const on = selected.includes(channel.id); return <label className={styles.chip} data-on={on} key={`${name}:${channel.id}`}><input type="checkbox" name={name} value={channel.id} checked={on} onChange={event => toggle(selected, set, channel.id, event.currentTarget.checked)} /><span>{channel.name}</span></label>; })}</div>
    : <p className={styles.hint}>{t("No channels available.")}</p>;
  const rangePicker = (from: keyof typeof dates, fromName: string, to: keyof typeof dates, toName: string, label: string, syncPrevious = false) => {
    const startVal = dates[from];
    const endVal = dates[to];
    const matched = presets.find(item => item.start === startVal && item.end === endVal);
    const presetId = matched?.id ?? 'custom';
    const summary = startVal && endVal ? `${startVal} – ${endVal}` : label;
    return <div className={styles.dates}>
      <input type="hidden" name={fromName} value={startVal} />
      <input type="hidden" name={toName} value={endVal} />
      <DateRangePicker label={label} presets={presets.map(item => ({ id: item.id, label: item.label }))}
        value={{ preset: presetId, from: startVal, to: endVal }} customSummary={summary}
        onChange={next => {
          const resolved = next.preset === 'custom'
            ? { start: next.from ?? startVal, end: next.to ?? endVal }
            : presets.find(item => item.id === next.preset) ?? { start: startVal, end: endVal };
          const prev = syncPrevious ? previousSpan(resolved.start, resolved.end) : null;
          setDates(current => ({
            ...current,
            [from]: resolved.start,
            [to]: resolved.end,
            ...(prev ? { bStart: prev.bStart, bEnd: prev.bEnd } : {}),
          }));
        }} />
    </div>;
  };
  return <form noValidate action="/insights/compare" method="get" className={styles.card}>
    <div className={styles.top}>
      <label>{t("Compare")}<select className="ui-input" name="mode" value={mode} onChange={event => setMode(event.currentTarget.value as typeof mode)}><option value="period">{t("The same channels across two periods")}</option><option value="channels">{t("Two groups of channels in one period")}</option></select></label>
      {mode === 'channels' && <fieldset className={styles.inline}><legend className="ui-visually-hidden">{t("One period (UTC)")}</legend>{rangePicker('start', 'start', 'end', 'end', t("One period (UTC)"))}</fieldset>}
      <Button type="submit" variant="primary" size="sm" className={styles.submit}>{t("Compare")}</Button>
    </div>
    {mode === 'period' ? <>
      <div className={styles.sides}>
        <fieldset className={styles.side}><legend>{t("Period A (UTC)")}</legend>{rangePicker('aStart', 'aStart', 'aEnd', 'aEnd', t("Period A (UTC)"), true)}</fieldset>
        <fieldset className={styles.side}><legend>{t("Period B (UTC)")}</legend>{rangePicker('bStart', 'bStart', 'bEnd', 'bEnd', t("Period B (UTC)"))}</fieldset>
      </div>
      <fieldset className={styles.side}><legend>{t("Channels (none selected means all)")}</legend>{channelChoices('channel', periodChannels, setPeriodChannels)}</fieldset>
    </> : <div className={styles.sides}>
      <fieldset className={styles.side}><legend>{t("Group A")}</legend>{channelChoices('groupA', groupA, setGroupA)}</fieldset>
      <fieldset className={styles.side}><legend>{t("Group B")}</legend>{channelChoices('groupB', groupB, setGroupB)}</fieldset>
    </div>}
  </form>;
}
