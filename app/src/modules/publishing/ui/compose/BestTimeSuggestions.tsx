'use client';
import { useEffect, useState } from 'react';
import { IconClockHour4 } from '@tabler/icons-react';
import styles from './best-times.module.css';
import { Button } from '@/components/Button';
import type { BestTimeChannelReason, BestTimeSuggestions as Suggestions } from '@/modules/publishing/server/best-time';

import { catalogGroup, composerCatalogDefaults, fillComposerCopy, type ComposerCatalog } from '../../composer-catalog';
type LabeledSlot = Suggestions['suggestions'][number] & { label: string };
type LabeledChannel = Omit<Suggestions['perTarget'][number], 'slots'> & { slots: LabeledSlot[] };
type Labeled = Omit<Suggestions, 'suggestions' | 'perTarget'> & { suggestions: LabeledSlot[]; perTarget: LabeledChannel[] };
type State = { key: string; status: 'ready'; data: Labeled } | { key: string; status: 'error' };

const reasonKey = (reason: BestTimeChannelReason) => reason === 'insufficient_history' ? 'reasonInsufficient' : reason === 'no_lift' ? 'reasonNoLift' : reason === 'unsupported' ? 'reasonUnsupported' : 'reasonNoAccess';

/** Cancel and fence selection changes so an old destination's timing can never fill the current schedule. */
export function BestTimeSuggestions({ targetIds, locale, disabled, onChoose, copyCatalog = composerCatalogDefaults }: { copyCatalog?: ComposerCatalog; targetIds: readonly string[]; locale: 'en' | 'fr'; disabled: boolean; onChoose: (wall: { date: string; time: string }) => void }) {
  const t = catalogGroup(copyCatalog, 'bestTime', locale);
  const key = JSON.stringify([...targetIds].sort());
  const [state, setState] = useState<State | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (key === '[]') return;
    let current = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams();
        for (const id of JSON.parse(key) as string[]) query.append('targetId', id);
        const response = await fetch(`/api/publishing/best-times?${query}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('unavailable');
        const data: Labeled = await response.json();
        if (!Array.isArray(data.suggestions) || !data.timeZone) throw new Error('unavailable');
        if (current) setState({ key, status: 'ready', data: { ...data, windowDays: data.windowDays ?? 0, perTarget: data.perTarget ?? [] } });
      } catch { if (current) setState({ key, status: 'error' }); }
    }, 250);
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [key, refresh]);
  const active = state?.key === key ? state : null;
  // Without a qualifying slot, still show the best observed hours (2+ posts) so the choice is not blind.
  const strongest = (channel: LabeledChannel) => {
    const top = (channel.hours ?? []).filter(h => h.posts >= 2 && h.medianEngagement !== null).sort((a, b) => b.medianEngagement! - a.medianEngagement!).slice(0, 2);
    return top.length ? ` ${fillComposerCopy(t.hourEvidence, { hours: top.map(h => fillComposerCopy(t.hourItem, { hour: String(h.hour).padStart(2, '0'), median: h.medianEngagement!, posts: h.posts })).join(', ') })}` : '';
  };
  const why = (slot: { posts: number; lift: number }, basis: number, days: number) => fillComposerCopy(t.why, { posts: slot.posts, lift: Math.round(slot.lift * 10) / 10, basis, days });
  return <section className={styles.times} aria-label={t.title} aria-live="polite">
    <h3 className={styles.timesTitle}><span className={styles.timesChip} aria-hidden="true"><IconClockHour4 size={16} stroke={2} /></span>{t.title}</h3>
    {!targetIds.length ? <p>{t.choose}</p> : !active ? <p>{t.loading}</p> : active.status === 'error' ? <>
      <p>{t.error}</p><Button type="button" size="sm" disabled={disabled} onClick={() => { setState(null); setRefresh(value => value + 1); }}>{t.retry}</Button>
    </> : <>
      {active.data.suggestions.length ? <ul>{active.data.suggestions.map(slot => <li key={slot.nextAt}>
        <Button type="button" size="sm" disabled={disabled} onClick={() => onChoose({ date: slot.date, time: slot.time })}>
          {slot.label}
        </Button>
        <small>{why(slot, active.data.perTarget.reduce((sum, channel) => sum + channel.basis, 0), active.data.windowDays)}</small>
      </li>)}</ul> : <p>{active.data.perTarget.length && active.data.perTarget.every(channel => channel.reason === 'no_lift') ? t.noLift : t.unknown}</p>}
      {active.data.perTarget.length ? <details>
        <summary>{t.channels}</summary>
        <ul>{active.data.perTarget.map(channel => <li key={channel.targetId}>
          <strong>{channel.name}</strong>{' '}
          {channel.reason === 'ok' ? <ul>{channel.slots.map(slot => <li key={slot.nextAt}>
            <Button type="button" size="sm" disabled={disabled} onClick={() => onChoose({ date: slot.date, time: slot.time })}>{slot.label}</Button>
            <small>{why(slot, channel.basis, active.data.windowDays)}</small>
          </li>)}</ul> : <span>{fillComposerCopy(t[reasonKey(channel.reason)], { basis: channel.basis })}{strongest(channel)}</span>}
        </li>)}</ul>
      </details> : null}
      <small>{t.hint} {active.data.timeZone}. {active.data.mode === 'apply' ? t.apply : t.suggest}</small>
    </>}
  </section>;
}
