'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';

type Channel = { id: string; name: string };
type Initial = {
  aStart: string; aEnd: string; bStart: string; bEnd: string;
  start: string; end: string; channel: string[]; groupA: string[]; groupB: string[];
};

export function ComparisonFilters({ mode: initialMode, channels, initial }: { mode: 'period' | 'channels'; channels: Channel[]; initial: Initial }) {
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
    ? channels.map(channel => <label className={styles.check} key={`${name}:${channel.id}`}><input type="checkbox" name={name} value={channel.id} checked={selected.includes(channel.id)} onChange={event => toggle(selected, set, channel.id, event.currentTarget.checked)} /><span>{channel.name}</span></label>)
    : <p className={styles.note}>No channels available.</p>;
  return <form noValidate action="/analytics/compare" method="get" className={styles.filters}>
    <label>Compare<select name="mode" value={mode} onChange={event => setMode(event.currentTarget.value as typeof mode)}><option value="period">The same channels across two periods</option><option value="channels">Two groups of channels in one period</option></select></label>
    {mode === 'period' ? <>
      <fieldset><legend>Period A (UTC)</legend><label>From<input type="date" name="aStart" value={dates.aStart} onChange={event => updateDate('aStart', event.currentTarget.value)} /></label><label>To<input type="date" name="aEnd" value={dates.aEnd} onChange={event => updateDate('aEnd', event.currentTarget.value)} /></label></fieldset>
      <fieldset><legend>Period B (UTC)</legend><label>From<input type="date" name="bStart" value={dates.bStart} onChange={event => updateDate('bStart', event.currentTarget.value)} /></label><label>To<input type="date" name="bEnd" value={dates.bEnd} onChange={event => updateDate('bEnd', event.currentTarget.value)} /></label></fieldset>
      <fieldset><legend>Channels (none selected means all)</legend>{channelChoices('channel', periodChannels, setPeriodChannels)}</fieldset>
    </> : <>
      <fieldset><legend>One period (UTC)</legend><label>From<input type="date" name="start" value={dates.start} onChange={event => updateDate('start', event.currentTarget.value)} /></label><label>To<input type="date" name="end" value={dates.end} onChange={event => updateDate('end', event.currentTarget.value)} /></label></fieldset>
      <fieldset><legend>Group A</legend>{channelChoices('groupA', groupA, setGroupA)}</fieldset>
      <fieldset><legend>Group B</legend>{channelChoices('groupB', groupB, setGroupB)}</fieldset>
    </>}
    <Button type="submit" variant="primary">Compare</Button>
  </form>;
}
