'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** The usual waits, in minutes. Anything else is "custom". */
const PRESETS = [0, 5, 15, 30, 60, 180, 360, 720, 1440] as const;
const MAX_MINUTES = 7 * 24 * 60;

/**
 * When the first comment goes, after its post: straight away, after one of
 * the usual waits, or after a custom number of days, hours and minutes.
 */
export function CommentDelay({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('compose');
  const [custom, setCustom] = useState(!PRESETS.includes(value as (typeof PRESETS)[number]));

  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const minutes = value % 60;
  const set = (d: number, h: number, m: number) =>
    onChange(Math.min(MAX_MINUTES, Math.max(0, d * 1440 + h * 60 + m)));

  const presetLabel = (minutes: number) =>
    minutes === 0
      ? t('delayNone')
      : minutes < 60
        ? t('delayMinutes', { count: minutes })
        : minutes < 1440
          ? t('delayHours', { count: minutes / 60 })
          : t('delayDays', { count: minutes / 1440 });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label htmlFor="comment-delay" className="text-xs font-semibold text-slate-600">
        {t('delayLabel')}
      </label>
      <select
        id="comment-delay"
        className="input w-auto py-1 text-sm"
        disabled={disabled}
        value={custom ? 'custom' : String(value)}
        onChange={(event) => {
          if (event.target.value === 'custom') {
            setCustom(true);
            if (value === 0) onChange(10);
          } else {
            setCustom(false);
            onChange(Number(event.target.value));
          }
        }}
      >
        {PRESETS.map((minutes) => (
          <option key={minutes} value={minutes}>
            {presetLabel(minutes)}
          </option>
        ))}
        <option value="custom">{t('delayCustom')}</option>
      </select>

      {custom && (
        <span className="flex items-center gap-1.5 text-xs text-slate-600" role="group" aria-label={t('delayCustom')}>
          {[
            [days, t('delayUnitDays'), 7, (n: number) => set(n, hours, minutes)],
            [hours, t('delayUnitHours'), 23, (n: number) => set(days, n, minutes)],
            [minutes, t('delayUnitMinutes'), 59, (n: number) => set(days, hours, n)],
          ].map(([amount, unit, max, apply]) => (
            <label key={unit as string} className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={max as number}
                disabled={disabled}
                className="input nums w-14 px-2 py-1 text-sm"
                value={amount as number}
                onChange={(event) => (apply as (n: number) => void)(Math.max(0, Number(event.target.value) || 0))}
              />
              {unit as string}
            </label>
          ))}
        </span>
      )}
    </div>
  );
}
