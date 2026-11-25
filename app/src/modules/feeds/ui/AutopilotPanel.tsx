'use client';

import { instantToWall } from '@/lib/calendar-dates';
import { autopilotOf, type AutopilotSettings } from '../wordpress/autopilot';
import type { RecipeCopyKey } from '../copy-recipes';
import styles from './feeds.module.css';
import { logSentence } from '../autopilot-log';

/**
 * Autopilot (2026-11-16): what it may do on its own, and everything it did. Changes are saved with the recipe
 * settings; the activity log is written by the planner only.
 */
export function AutopilotPanel({ open = false, value, timeZone, pages, busy, onChange, t, locale = 'en' }: {
  locale?: 'en' | 'fr'; open?: boolean; value: unknown; timeZone: string; pages: Array<{ id: string; name: string }>; busy: boolean;
  onChange: (next: AutopilotSettings) => void; t: (key: RecipeCopyKey, values?: Record<string, string | number>) => string;
}) {
  const pilot = autopilotOf(value);
  const set = (patch: Partial<AutopilotSettings>) => onChange({ ...pilot, ...patch });
  const best = pilot.bestTimes; const heal = pilot.healing;
  const when = (iso: string) => { const at = new Date(iso); if (Number.isNaN(at.getTime())) return ''; const wall = instantToWall(at, timeZone); return `${wall.date.slice(8, 10)}/${wall.date.slice(5, 7)} ${wall.time}`; };
  const channel = (id?: string, name?: string) => name || pages.find(page => page.id === id)?.name || t('autopilotAChannel');
  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  const on = [best.enabled, heal.replaceFailed, heal.pauseBroken, pilot.score.enabled, pilot.variety.enabled, pilot.evergreen.enabled, pilot.radar.enabled, pilot.breathe.enabled, pilot.captions.enabled, pilot.hooks.enabled, pilot.comment.enabled, pilot.review.enabled, pilot.digest.enabled, pilot.replies.enabled].filter(Boolean).length;

  return <details id="autopilot" className={styles.group} open={open || undefined}>
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
      <fieldset className={styles.checks} disabled={busy}><legend>{t('autopilotChoosing')}</legend>
        <label className={styles.inline}><input type="checkbox" checked={pilot.score.enabled} onChange={e => set({ score: { ...pilot.score, enabled: e.target.checked } })} /> {t('autopilotScoreOn')}</label>
        <span className={styles.help}>{t('autopilotScoreHint')}</span>
        <div className={styles.autoRow}>
          <label>{t('autopilotWeight')}<select value={pilot.score.weight} onChange={e => set({ score: { ...pilot.score, weight: e.target.value as AutopilotSettings['score']['weight'] } })}>
            <option value="strong">{t('autopilotWeightStrong')}</option><option value="balanced">{t('autopilotWeightBalanced')}</option><option value="light">{t('autopilotWeightLight')}</option></select></label>
          <label>{t('autopilotVariety')}<select value={pilot.variety.enabled ? pilot.variety.maxRun : 0} onChange={e => { const v = Number(e.target.value); set({ variety: { enabled: v > 0, maxRun: v || pilot.variety.maxRun } }); }}>
            <option value={1}>{t('autopilotVarietyOnce')}</option><option value={2}>{t('autopilotVarietyTwice')}</option><option value={0}>{t('autopilotVarietyOff')}</option></select></label>
          <label>{t('autopilotWinners')}<select value={pilot.evergreen.enabled ? pilot.evergreen.share : 0} onChange={e => { const v = Number(e.target.value); set({ evergreen: { ...pilot.evergreen, enabled: v > 0, share: v || pilot.evergreen.share } }); }}>
            {[0, 10, 20, 35].map(v => <option key={v} value={v}>{v ? t('autopilotUpTo', { share: v }) : t('autopilotVarietyOff')}</option>)}</select></label>
          <label>{t('autopilotCooldown')}<select value={pilot.evergreen.cooldownDays} onChange={e => set({ evergreen: { ...pilot.evergreen, cooldownDays: Number(e.target.value) } })}>
            {[60, 90, 180].map(d => <option key={d} value={d}>{t('autopilotDays', { days: d })}</option>)}</select></label>
        </div>
        <div className={styles.checkRow}>{(['holidays', 'season', 'weekday', 'weather'] as const).map(rule => <label key={rule} className={styles.inline}><input type="checkbox" checked={pilot.moments.rules.includes(rule)}
          onChange={e => set({ moments: { ...pilot.moments, rules: e.target.checked ? [...pilot.moments.rules, rule] : pilot.moments.rules.filter(r => r !== rule) } })} /> {t(`autopilotRule_${rule}`)}</label>)}</div>
        <label className={styles.inline}><input type="checkbox" checked={pilot.score.show} onChange={e => set({ score: { ...pilot.score, show: e.target.checked } })} /> {t('autopilotShowScore')}</label>
      </fieldset>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('autopilotWriting')}</legend>
        <label className={styles.inline}><input type="checkbox" checked={pilot.captions.enabled} onChange={e => set({ captions: { ...pilot.captions, enabled: e.target.checked } })} /> {t('autopilotCaptionsOn')}</label>
        <div className={styles.autoRow}>
          <label>{t('autopilotVoice')}<select value={pilot.captions.voice} onChange={e => set({ captions: { ...pilot.captions, voice: e.target.value as AutopilotSettings['captions']['voice'] } })}>
            {(['per-page', 'warm', 'short', 'chef'] as const).map(v => <option key={v} value={v}>{t(`autopilotVoice_${v}`)}</option>)}</select></label>
          <label>{t('autopilotEmoji')}<select value={pilot.captions.emoji} onChange={e => set({ captions: { ...pilot.captions, emoji: e.target.value as AutopilotSettings['captions']['emoji'] } })}>
            {(['none', 'few', 'more'] as const).map(v => <option key={v} value={v}>{t(`autopilotEmoji_${v}`)}</option>)}</select></label>
          <label>{t('autopilotHookTests')}<select value={pilot.hooks.enabled ? pilot.hooks.share : 0} onChange={e => { const v = Number(e.target.value); set({ hooks: { enabled: v > 0, share: v || pilot.hooks.share } }); }}>
            {[0, 10, 20].map(v => <option key={v} value={v}>{v ? t('autopilotOfPosts', { share: v }) : t('autopilotVarietyOff')}</option>)}</select></label>
          <label>{t('autopilotCta')}<select value={pilot.comment.enabled ? pilot.comment.cta : 'none'} onChange={e => { const v = e.target.value as AutopilotSettings['comment']['cta']; set({ comment: { ...pilot.comment, enabled: v !== 'none', cta: v } }); }}>
            {(['rotate', 'save', 'tag', 'none'] as const).map(v => <option key={v} value={v}>{t(`autopilotCta_${v}`)}</option>)}</select></label>
          <label>{t('autopilotCommentDelay')}<select value={pilot.comment.delayMinutes} onChange={e => set({ comment: { ...pilot.comment, delayMinutes: Number(e.target.value) } })}>
            {[0, 2, 10].map(v => <option key={v} value={v}>{v ? `${v} min` : t('autopilotRightAway')}</option>)}</select></label>
        </div>
        <label className={styles.inline}><input type="checkbox" checked={pilot.captions.question} onChange={e => set({ captions: { ...pilot.captions, question: e.target.checked } })} /> {t('autopilotQuestion')}</label>
        <span className={styles.help}>{t('autopilotWritingHint')}</span>
      </fieldset>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('autopilotRadar')}</legend>
        <label className={styles.inline}><input type="checkbox" checked={pilot.radar.enabled} onChange={e => set({ radar: { ...pilot.radar, enabled: e.target.checked } })} /> {t('autopilotRadarOn')}</label>
        <label className={styles.inline}><input type="checkbox" checked={pilot.breathe.enabled} onChange={e => set({ breathe: { ...pilot.breathe, enabled: e.target.checked } })} /> {t('autopilotBreatheOn')}</label>
        <label className={styles.inline}><input type="checkbox" checked={pilot.photos.generate} onChange={e => set({ photos: { generate: e.target.checked } })} /> {t('autopilotGeneratePhotos')}</label>
        <div className={styles.autoRow}>
          <label>{t('autopilotHotAt')}<select value={pilot.radar.factor} onChange={e => { const v = Number(e.target.value); set({ radar: { ...pilot.radar, factor: v }, breathe: { ...pilot.breathe, factor: v } }); }}>
            {[2, 3, 5].map(v => <option key={v} value={v}>{t('autopilotTimesUsual', { times: v })}</option>)}</select></label>
          <label>{t('autopilotSpreadTo')}<select value={pilot.radar.pages} onChange={e => set({ radar: { ...pilot.radar, pages: Number(e.target.value) } })}>
            {[3, 5, 10].map(v => <option key={v} value={v}>{t('autopilotChannelsCount', { count: v })}</option>)}</select></label>
          <label>{t('autopilotWaitAtMost')}<select value={pilot.breathe.maxDelayMinutes} onChange={e => set({ breathe: { ...pilot.breathe, maxDelayMinutes: Number(e.target.value) } })}>
            {[30, 60, 120].map(v => <option key={v} value={v}>{v < 60 ? `${v} min` : `${v / 60} h`}</option>)}</select></label>
        </div>
        <span className={styles.help}>{t('autopilotRadarHint')}</span>
      </fieldset>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('autopilotReview')}</legend>
        <label className={styles.inline}><input type="checkbox" checked={pilot.review.enabled && pilot.review.notify} onChange={e => set({ review: { ...pilot.review, enabled: e.target.checked, notify: e.target.checked } })} /> {t('autopilotReviewOn')}</label>
        <div className={styles.autoRow}>
          <label>{t('autopilotReviewAt')}<select value={pilot.review.hour} onChange={e => set({ review: { ...pilot.review, hour: Number(e.target.value) } })}>
            {[18, 20, 22].map(h => <option key={h} value={h}>{`${h}:00`}</option>)}</select></label>
          <label>{t('autopilotDigest')}<select value={pilot.digest.enabled ? pilot.digest.day : 'off'} onChange={e => { const v = e.target.value; set({ digest: v === 'off' ? { ...pilot.digest, enabled: false } : { enabled: true, day: v as AutopilotSettings['digest']['day'] } }); }}>
            {(['mon', 'fri', 'sun', 'off'] as const).map(v => <option key={v} value={v}>{t(`autopilotDigest_${v}`)}</option>)}</select></label>
          <label>{t('autopilotReplies')}<select value={pilot.replies.enabled ? pilot.replies.tone : 'off'} onChange={e => { const v = e.target.value; set({ replies: v === 'off' ? { ...pilot.replies, enabled: false } : { enabled: true, tone: v as AutopilotSettings['replies']['tone'] } }); }}>
            {(['friendly', 'short', 'expert', 'off'] as const).map(v => <option key={v} value={v}>{t(`autopilotReplies_${v}`)}</option>)}</select></label>
        </div>
        <span className={styles.help}>{t('autopilotReviewHint')}</span>
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
            : `${channel(entry.channelId, entry.channelName)} — ${logSentence(entry, locale)}`}</span>
        </li>)}</ul> : <span className={styles.help}>{pilot.lastLearnedAt ? t('autopilotNoChange', { when: when(pilot.lastLearnedAt) }) : t('autopilotNothingYet')}</span>}
      </div>
    </div>
  </details>;
}
