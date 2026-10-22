'use client';
import { workspaceText, workspaceCopyDefaults, type WorkspaceCopy } from '../../workspace-copy';


import { useState } from 'react';
import { Button } from '@/components/Button';
import styles from './compare.module.css';

type Channel = { id: string; name: string };
type Initial = {
  aStart: string; aEnd: string; bStart: string; bEnd: string;
  start: string; end: string; channel: string[]; groupA: string[]; groupB: string[];
};

export function ComparisonFilters({ mode: initialMode, channels, initial, copy = workspaceCopyDefaults, locale = 'en' }: { copy?: WorkspaceCopy; locale?: 'en' | 'fr'; mode: 'period' | 'channels'; channels: Channel[]; initial: Initial }) {
  const t = workspaceText(copy, locale);
  const [mode, setMode] = useState(initialMode);
  const [dates, setDates] = useState({ aStart: initial.aStart, aEnd: initial.aEnd, bStart: initial.bStart, bEnd: initial.bEnd, start: initial.start, end: initial.end });
  const [periodChannels, setPeriodChannels] = useState(initial.channel);
  const [groupA, setGroupA] = useState(initial.groupA);
  const [groupB, setGroupB] = useState(initial.groupB);
  const updateDate = (key: keyof typeof dates, value: string) => setDates(current => ({ ...current, [key]: value }));
  const toggle = (current: string[], set: (next: string[]) => void, id: string, checked: boolean) => {
    set(checked ? [...current, id] : current.filter(value => value !== id));
  };
  const channelChoices = (name: string, selected: string[], set: (next: string[]) => void) => channels.length
    ? <div className={styles.chips}>{channels.map(channel => { const on = selected.includes(channel.id); return <label className={styles.chip} data-on={on} key={`${name}:${channel.id}`}><input type="checkbox" name={name} value={channel.id} checked={on} onChange={event => toggle(selected, set, channel.id, event.currentTarget.checked)} /><span>{channel.name}</span></label>; })}</div>
    : <p className={styles.hint}>{t("No channels available.")}</p>;
  const range = (from: keyof typeof dates, fromName: string, to: keyof typeof dates, toName: string) => <div className={styles.dates}>
    <label>{t("From")}<input type="date" name={fromName} value={dates[from]} onChange={event => updateDate(from, event.currentTarget.value)} /></label>
    <label>{t("To")}<input type="date" name={toName} value={dates[to]} onChange={event => updateDate(to, event.currentTarget.value)} /></label>
  </div>;
  return <form noValidate action="/insights/compare" method="get" className={styles.card}>
    <div className={styles.top}>
      <label>{t("Compare")}<select name="mode" value={mode} onChange={event => setMode(event.currentTarget.value as typeof mode)}><option value="period">{t("The same channels across two periods")}</option><option value="channels">{t("Two groups of channels in one period")}</option></select></label>
      {mode === 'channels' && <fieldset className={styles.inline}><legend className="ui-visually-hidden">{t("One period (UTC)")}</legend>{range('start', 'start', 'end', 'end')}</fieldset>}
      <Button type="submit" variant="primary" size="sm" className={styles.submit}>{t("Compare")}</Button>
    </div>
    {mode === 'period' ? <>
      <div className={styles.sides}>
        <fieldset className={styles.side}><legend>{t("Period A (UTC)")}</legend>{range('aStart', 'aStart', 'aEnd', 'aEnd')}</fieldset>
        <fieldset className={styles.side}><legend>{t("Period B (UTC)")}</legend>{range('bStart', 'bStart', 'bEnd', 'bEnd')}</fieldset>
      </div>
      <fieldset className={styles.side}><legend>{t("Channels (none selected means all)")}</legend>{channelChoices('channel', periodChannels, setPeriodChannels)}</fieldset>
    </> : <div className={styles.sides}>
      <fieldset className={styles.side}><legend>{t("Group A")}</legend>{channelChoices('groupA', groupA, setGroupA)}</fieldset>
      <fieldset className={styles.side}><legend>{t("Group B")}</legend>{channelChoices('groupB', groupB, setGroupB)}</fieldset>
    </div>}
  </form>;
}
