'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { channelConfig, type ChannelSettings as Own, type PlanConfig } from '../wordpress/recipe';
import { autopilotOf } from '../wordpress/autopilot';
import type { RecipeCopyKey } from '../copy-recipes';
import type { RecipeConfig } from './RecipeSource';
import styles from './feeds.module.css';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Settings per channel (2026-11-15): every channel in the source's scope is listed with what it posts with. A channel's
 * own settings are a full copy taken when they are first opened, so later changes to the shared settings leave it as is.
 */
export function ChannelSettings({ pages, config, onChange, busy, maxTemplate, t, dayName }: {
  pages: Array<{ id: string; name: string }>; config: RecipeConfig; onChange: (channels: Record<string, Own>, channelSlots: Record<string, string[]>) => void; busy: boolean; maxTemplate: number;
  t: (key: RecipeCopyKey, values?: Record<string, string | number>) => string; dayName: (day: number) => string;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string; value: Required<Omit<Own, 'pausedReason' | 'autoTimes' | 'captionTitle'>> } | null>(null);
  const channels = config.channels ?? {};
  const resolved = (id: string) => channelConfig(config as unknown as PlanConfig, id);
  const own = (id: string) => Boolean(channels[id] && Object.keys(channels[id]!).length) || Boolean(config.channelSlots?.[id]?.length);
  const daysText = (days: readonly number[] | undefined) => !days || days.length === 7 ? '' : WEEK_ORDER.filter(d => days.includes(d)).map(dayName).join(', ');
  const ownCount = pages.filter(page => own(page.id)).length;
  const pausedCount = pages.filter(page => channels[page.id]?.paused).length;

  const open = (page: { id: string; name: string }) => {
    const r = resolved(page.id);
    setEditing({ id: page.id, name: page.name, value: { slots: [...r.slots], weekdays: [...(r.weekdays ?? ALL_DAYS)], order: r.order, firstCommentTemplate: r.firstCommentTemplate, firstCommentDelayMinutes: r.firstCommentDelayMinutes, paused: r.paused } });
  };
  const withoutLegacy = (id: string) => { const next = { ...(config.channelSlots ?? {}) }; delete next[id]; return next; };
  const save = () => {
    if (!editing) return;
    const slots = [...new Set(editing.value.slots.filter(slot => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot)))].sort();
    const value: Own = { ...editing.value, slots: slots.length ? slots : [...config.slots], firstCommentTemplate: editing.value.firstCommentTemplate.trim() ? editing.value.firstCommentTemplate : config.firstCommentTemplate };
    // Times the autopilot learned stay its to move until a member changes them; a pause reason goes with the pause.
    const before = channels[editing.id];
    if (before?.autoTimes && JSON.stringify(before.slots) === JSON.stringify(value.slots)) value.autoTimes = true;
    // Saving another setting (a first comment with the article link, 2026-11-20) must not pin the times shown: when the
    // channel had no times of its own and they were left as shown, the autopilot keeps choosing them.
    const hadOwnTimes = Boolean(before?.slots?.length) || Boolean(config.channelSlots?.[editing.id]?.length);
    if (!hadOwnTimes && JSON.stringify(value.slots) === JSON.stringify([...resolved(editing.id).slots].sort())) delete (value as Partial<Own>).slots;
    // A template identical to the shared one is not stored, so later changes to the shared template still reach this channel.
    if (value.firstCommentTemplate === config.firstCommentTemplate) delete (value as Partial<Own>).firstCommentTemplate;
    if (before?.pausedReason && value.paused && before.paused) value.pausedReason = before.pausedReason;
    // The title-only caption test (2026-11-21) has no control here yet: saving other settings keeps it.
    if (before?.captionTitle) value.captionTitle = true;
    onChange({ ...channels, [editing.id]: value }, withoutLegacy(editing.id));
    setEditing(null);
  };
  const useShared = () => {
    if (!editing) return;
    const next = { ...channels }; delete next[editing.id];
    onChange(next, withoutLegacy(editing.id));
    setEditing(null);
  };
  const set = (patch: Partial<Own>) => setEditing(e => e ? { ...e, value: { ...e.value, ...patch } } : e);

  return <details className={styles.group}>
    <summary><strong>{t('perChannelHeading')}</strong><span>{t('perChannelSummary', { own: ownCount, paused: pausedCount })}</span></summary>
    <div className={styles.groupBody}>
      <span className={styles.help}>{t('perChannelHint')}</span>
      {pages.length ? <ul className={styles.channelList}>{pages.map(page => {
        const r = resolved(page.id); const mine = own(page.id); const paused = channels[page.id]?.paused === true;
        const summary = paused ? t('perChannelPaused') : [r.slots.join(' · '), daysText(r.weekdays), r.order === 'oldest' ? t('orderOldest') : t('orderNewest')].filter(Boolean).join(' · ');
        return <li key={page.id} className={styles.channelRow}>
          <div><strong>{page.name}</strong><span className={styles.meta}>{summary}</span></div>
          <span className={styles.channelBadge} data-own={mine ? 'true' : undefined} data-paused={paused ? 'true' : undefined}>{paused ? t('perChannelPaused') : (channels[page.id]?.autoTimes || (!channels[page.id]?.slots?.length && autopilotOf(config.autopilot).learnedTimes?.[page.id])) ? t('autoTimesBadge') : mine ? t('perChannelOwn') : t('perChannelShared')}</span>
          <Button size="sm" type="button" variant="secondary" disabled={busy} onClick={() => open(page)}>{t('perChannelEdit')}</Button>
        </li>;
      })}</ul> : <span className={styles.help}>{t('noChannels')}</span>}
    </div>
    <Dialog open={editing !== null} title={editing ? t('perChannelTitle', { name: editing.name }) : ''} description={t('perChannelDescription')} onClose={() => setEditing(null)} closeLabel={t('cancel')}
      actions={<>
        <Button type="button" variant="quiet" onClick={useShared}>{t('perChannelUseShared')}</Button>
        <Button type="button" variant="primary" onClick={save}>{t('perChannelDone')}</Button>
      </>}>
      {editing && <div className={styles.form}>
        <label className={styles.inline}><input type="checkbox" checked={editing.value.paused} onChange={e => set({ paused: e.target.checked })} /> {t('perChannelPause')}</label>
        <fieldset className={styles.checks} disabled={editing.value.paused}><legend>{t('slots')}</legend>
          <div className={styles.slotChips}>{editing.value.slots.map((slot, index) => <span key={index} className={styles.slotChip}>
            <input type="time" aria-label={t('slots')} value={slot} onChange={e => set({ slots: editing.value.slots.map((s, i) => i === index ? e.target.value : s) })} />
            <button type="button" aria-label={t('removeSlot', { time: slot })} disabled={editing.value.slots.length < 2} onClick={() => set({ slots: editing.value.slots.filter((_, i) => i !== index) })}>×</button>
          </span>)}
          <Button size="sm" type="button" variant="quiet" onClick={() => set({ slots: [...editing.value.slots, '12:00'] })}>+ {t('addSlot')}</Button></div>
        </fieldset>
        <fieldset className={styles.dayPicker} disabled={editing.value.paused}><legend>{t('weekdays')}</legend>
          <div className={styles.dayChips}>{WEEK_ORDER.map(day => { const on = editing.value.weekdays.includes(day); return <button key={day} type="button" aria-pressed={on} className={styles.dayChip}
            disabled={on && editing.value.weekdays.length === 1} onClick={() => set({ weekdays: on ? editing.value.weekdays.filter(d => d !== day) : [...editing.value.weekdays, day].sort() })}>{dayName(day)}</button>; })}</div>
        </fieldset>
        <label>{t('order')}<select disabled={editing.value.paused} value={editing.value.order} onChange={e => set({ order: e.target.value === 'oldest' ? 'oldest' : 'newest' })}>
          <option value="newest">{t('orderNewest')}</option><option value="oldest">{t('orderOldest')}</option></select></label>
        <label>{t('template')}<textarea disabled={editing.value.paused} rows={7} maxLength={maxTemplate} value={editing.value.firstCommentTemplate} onChange={e => set({ firstCommentTemplate: e.target.value })} /><span>{t('templateHint')}</span></label>
        <label>{t('delay')}<input disabled={editing.value.paused} type="number" min={0} step={1} value={editing.value.firstCommentDelayMinutes} onChange={e => set({ firstCommentDelayMinutes: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} /></label>
      </div>}
    </Dialog>
  </details>;
}
