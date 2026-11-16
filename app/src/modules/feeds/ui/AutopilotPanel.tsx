'use client';

import { instantToWall } from '@/lib/calendar-dates';
import { autopilotOf, type AutopilotSettings } from '../wordpress/autopilot';
import type { RecipeCopyKey } from '../copy-recipes';
import styles from './feeds.module.css';

/**
 * Autopilot (2026-11-16): what it may do on its own, and everything it did. Changes are saved with the recipe
 * settings; the activity log is written by the planner only.
 */
export function AutopilotPanel({ value, timeZone, pages, busy, onChange, t }: {
  value: unknown; timeZone: string; pages: Array<{ id: string; name: string }>; busy: boolean;
  onChange: (next: AutopilotSettings) => void; t: (key: RecipeCopyKey, values?: Record<string, string | number>) => string;
}) {
  const pilot = autopilotOf(value);
  const set = (patch: Partial<AutopilotSettings>) => onChange({ ...pilot, ...patch });
  const best = pilot.bestTimes; const heal = pilot.healing;
  const when = (iso: string) => { const at = new Date(iso); if (Number.isNaN(at.getTime())) return ''; const wall = instantToWall(at, timeZone); return `${wall.date.slice(8, 10)}/${wall.date.slice(5, 7)} ${wall.time}`; };
  const channel = (id?: string, name?: string) => name || pages.find(page => page.id === id)?.name || t('autopilotAChannel');
  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  const on = [best.enabled, heal.replaceFailed, heal.pauseBroken].filter(Boolean).length;

  return <details className={styles.group} open>
    <summary><strong>{t('autopilotHeading')}</strong><span>{on ? t('autopilotOn', { count: on }) : t('autopilotOff')}</span></summary>
    <div className={styles.groupBody}>
      <span className={styles.help}>{t('autopilotIntro')}</span>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('autopilotBestTimes')}</legend>
        <label className={styles.inline}><input type="checkbox" checked={best.enabled} onChange={e => set({ bestTimes: { ...best, enabled: e.target.checked } })} /> {t('autopilotBestTimesOn')}</label>
        <span className={styles.help}>{t('autopilotBestTimesHint', { days: best.learnDays })}</span>
        <div className={styles.autoRow}>
          <label>{t('autopilotWindowFrom')}<select value={best.window[0]} onChange={e => set({ bestTimes: { ...best, window: [Number(e.target.value), Math.max(best.window[1], Number(e.target.value) + 1)] } })}>
            {hours.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
          <label>{t('autopilotWindowTo')}<select value={best.window[1]} onChange={e => set({ bestTimes: { ...best, window: [Math.min(best.window[0], Number(e.target.value) - 1), Number(e.target.value)] } })}>
            {hours.slice(1).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
          <label>{t('autopilotGap')}<select value={best.gapMinutes} onChange={e => set({ bestTimes: { ...best, gapMinutes: Number(e.target.value) } })}>
            {[60, 90, 120, 180].map(m => <option key={m} value={m}>{m < 120 ? `${m} min` : `${m / 60} h`}</option>)}</select></label>
          <label>{t('autopilotLearn')}<select value={best.learnDays} onChange={e => set({ bestTimes: { ...best, learnDays: Number(e.target.value) } })}>
            {[14, 28, 56].map(d => <option key={d} value={d}>{t('autopilotDays', { days: d })}</option>)}</select></label>
        </div>
      </fieldset>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('autopilotHealing')}</legend>
        <label className={styles.inline}><input type="checkbox" checked={heal.replaceFailed} onChange={e => set({ healing: { ...heal, replaceFailed: e.target.checked } })} /> {t('autopilotReplace')}</label>
        <label className={styles.inline}><input type="checkbox" checked={heal.pauseBroken} onChange={e => set({ healing: { ...heal, pauseBroken: e.target.checked } })} /> {t('autopilotBroken')}</label>
        <label>{t('autopilotWarn')}<select value={heal.warnDays} onChange={e => set({ healing: { ...heal, warnDays: Number(e.target.value) } })}>
          {[3, 7, 14].map(d => <option key={d} value={d}>{t('autopilotDays', { days: d })}</option>)}</select></label>
      </fieldset>
      <div className={styles.dayPicker}><strong>{t('autopilotActivity')}</strong>
        {pilot.log?.length ? <ul className={styles.activity}>{pilot.log.slice(0, 15).map((entry, index) => <li key={`${entry.at}-${index}`}>
          <time dateTime={entry.at}>{when(entry.at)}</time>
          <span>{entry.kind === 'times'
            ? t('autopilotTimesChanged', { channel: channel(entry.channelId, entry.channelName), from: (entry.from ?? []).join(' · '), to: (entry.to ?? []).join(' · ') })
            : `${channel(entry.channelId, entry.channelName)} — ${entry.text ?? ''}`}</span>
        </li>)}</ul> : <span className={styles.help}>{pilot.lastLearnedAt ? t('autopilotNoChange', { when: when(pilot.lastLearnedAt) }) : t('autopilotNothingYet')}</span>}
      </div>
    </div>
  </details>;
}
