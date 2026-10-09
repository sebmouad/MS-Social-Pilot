import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { Icon } from './Icon';
import { RANGE_PRESETS, type DateRange } from '@/lib/date-range';

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
}: {
  range: DateRange;
  /** The screen the choices lead back to. */
  path: string;
  /** The other parameters a choice must keep: the view, the Page. */
  keep: Record<string, string>;
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

  const href = (preset: string) => `${path}?${new URLSearchParams({ ...keep, range: preset }).toString()}`;

  return (
    <details className="group relative">
      <summary className="btn-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <Icon name="calendar" size={18} />
        <span>{t(`preset.${range.key}`)}</span>
        <span className="hidden font-normal text-slate-600 sm:inline">{span}</span>
        <Icon name="chevronRight" size={16} className="rotate-90 transition-transform group-open:-rotate-90" />
      </summary>

      <div className="absolute left-0 z-30 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-lg bg-white p-2 shadow-lg ring-1 ring-black/5">
        <ul className="grid gap-0.5" aria-label={t('presets')}>
          {RANGE_PRESETS.map((preset) => {
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

        <form method="get" action={path} className="mt-2 border-t border-slate-200 px-1 pb-1 pt-3">
          {Object.entries(keep).map(([name, value]) => (
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
