'use client';
import { useEffect, useState } from 'react';
import { IconClockHour4 } from '@tabler/icons-react';
import styles from './best-times.module.css';
import { Button } from '@/components/Button';
import type { BestTimeSuggestions as Suggestions } from '@/modules/publishing/server/best-time';

import { catalogGroup, composerCatalogDefaults, type ComposerCatalog } from '../../composer-catalog';
type Labeled = Omit<Suggestions, 'suggestions'> & { suggestions: Array<Suggestions['suggestions'][number] & { label: string }> };
type State = { key: string; status: 'ready'; data: Labeled } | { key: string; status: 'error' };

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
        if (current) setState({ key, status: 'ready', data });
      } catch { if (current) setState({ key, status: 'error' }); }
    }, 250);
    return () => { current = false; controller.abort(); clearTimeout(timer); };
  }, [key, refresh]);
  const active = state?.key === key ? state : null;
  return <section className={styles.times} aria-label={t.title} aria-live="polite">
    <h3 className={styles.timesTitle}><span className={styles.timesChip} aria-hidden="true"><IconClockHour4 size={16} stroke={2} /></span>{t.title}</h3>
    {!targetIds.length ? <p>{t.choose}</p> : !active ? <p>{t.loading}</p> : active.status === 'error' ? <>
      <p>{t.error}</p><Button type="button" size="sm" disabled={disabled} onClick={() => { setState(null); setRefresh(value => value + 1); }}>{t.retry}</Button>
    </> : <>
      {active.data.suggestions.length ? <ul>{active.data.suggestions.map(slot => <li key={slot.nextAt}>
        <Button type="button" size="sm" disabled={disabled} onClick={() => onChoose({ date: slot.date, time: slot.time })}>
          {slot.label}
        </Button>
      </li>)}</ul> : <p>{t.unknown}</p>}
      <small>{t.hint} {active.data.timeZone}. {active.data.mode === 'apply' ? t.apply : t.suggest}</small>
    </>}
  </section>;
}
