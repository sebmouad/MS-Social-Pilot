import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { Icon } from './Icon';
import {
  ALL_TIME_DAYS,
  COMPARE_MODES,
  RANGE_PRESETS,
  type CompareMode,
  type DateRange,
  type RangePreset,
} from '@/lib/date-range';

/** The longest each preset can run, in days, for screens with a limit. */
const PRESET_SPAN: Record<RangePreset, number> = {
  today: 1,
  yesterday: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  thisMonth: 31,
  lastMonth: 31,
  thisYear: 366,
  all: ALL_TIME_DAYS,
};

/**
 * The date range control, as Meta Business Suite draws it: one button naming
 * the period and its dates, opening a list of named periods and a pair of
 * dates for anything else.
 *
 * A `<details>` element rather than a script: it opens, closes and works from
 * the keyboard with no JavaScript, and every choice is a plain link or a GET
 * form, so a range is a URL that bookmarks, shares and survives a reload.
 */
export async function DateRangePicker({
  range,
  path,
  keep,
  maxDays,
  compare,
}: {
  range: DateRange;
  /** The screen the choices lead back to. */
  path: string;
  /** The other parameters a choice must keep: the view, the Page. */
  keep: Record<string, string>;
  /**
   * The longest span this screen can show, when it has one: ads are only read
   * back as far as the last sync went, so a longer preset is not offered.
   */
  maxDays?: number;
  /** What the period is measured against, on screens that compare. Omitted, no choice is offered. */
  compare?: CompareMode;
}) {
  const t = await getTranslations('dateRange');
  const locale = await getLocale();

  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayYear = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const asDate = (value: string) => new Date(`${value}T12:00:00Z`);
  const span =
    range.fromDay === range.toDay
      ? dayYear.format(asDate(range.toDay))
      : `${day.format(asDate(range.fromDay))} – ${dayYear.format(asDate(range.toDay))}`;

  const withCompare: Record<string, string> = compare === 'year' ? { compare: 'year' } : {};
  const href = (preset: string) =>
    `${path}?${new URLSearchParams({ ...keep, ...withCompare, range: preset }).toString()}`;
  const current: Record<string, string> =
    range.key === 'custom' ? { from: range.fromDay, to: range.toDay } : { range: range.key };
  const compareHref = (mode: CompareMode) =>
    `${path}?${new URLSearchParams({ ...keep, ...current, ...(mode === 'year' ? { compare: 'year' } : ({} as Record<string, string>)) }).toString()}`;

  return (
    <details className="group relative">
      <summary className="btn-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <Icon name="calendar" size={18} />
        <span>{t(`preset.${range.key}`)}</span>
        <span className="hidden font-normal text-slate-600 sm:inline">{span}</span>
        {compare === 'year' && (
          <span className="hidden rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-600 md:inline">
            {t('vsYear')}
          </span>
        )}
        <Icon name="chevronRight" size={16} className="rotate-90 transition-transform group-open:-rotate-90" />
      </summary>

      <div className="absolute start-0 z-30 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-lg bg-white p-2 shadow-lg ring-1 ring-black/5">
        <ul className="grid gap-0.5" aria-label={t('presets')}>
          {RANGE_PRESETS.filter((preset) => !maxDays || PRESET_SPAN[preset] <= maxDays).map((preset) => {
            const active = range.key === preset;
            return (
              <li key={preset}>
                <Link
                  href={href(preset)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-[15px] font-semibold ${
                    active ? 'bg-brand-50 text-brand-600' : 'text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {t(`preset.${preset}`)}
                  {active && <Icon name="check" size={16} />}
                </Link>
              </li>
            );
          })}
        </ul>

        {compare && (
          <div className="mt-2 border-t border-slate-200 px-1 pt-3">
            <p className="mb-2 text-[13px] font-semibold text-slate-600">{t('compareWith')}</p>
            <div className="segmented">
              {COMPARE_MODES.map((mode) => (
                <Link
                  key={mode}
                  href={compareHref(mode)}
                  aria-current={compare === mode ? 'true' : undefined}
                  className={`segmented-item flex-1 text-center ${compare === mode ? 'segmented-item-active' : ''}`}
                >
                  {t(`compare_${mode}`)}
                </Link>
              ))}
            </div>
          </div>
        )}

        <form method="get" action={path} className="mt-2 border-t border-slate-200 px-1 pb-1 pt-3">
          {Object.entries({ ...keep, ...withCompare }).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <p className="mb-2 text-[13px] font-semibold text-slate-600">{t('custom')}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">
              {t('from')}
              <input type="date" name="from" required defaultValue={range.fromDay} className="input mt-1 px-2" />
            </label>
            <label className="text-xs text-slate-600">
              {t('to')}
              <input type="date" name="to" required defaultValue={range.toDay} className="input mt-1 px-2" />
            </label>
          </div>
          <button type="submit" className="btn-primary mt-3 w-full">
            {t('apply')}
          </button>
        </form>
      </div>
    </details>
  );
}
