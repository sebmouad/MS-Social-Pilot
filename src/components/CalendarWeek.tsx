import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatInZone } from '@/lib/time';

interface WeekPost {
  id: string;
  scheduledAt: Date | null;
}

/**
 * One week, hour by hour: the days across, the hours down, each post in the
 * hour it goes out. The rows start at six in the morning, or earlier when a
 * post does; nobody needs four empty rows before dawn to scroll past.
 *
 * Each free hour still to come carries a "+" that opens the composer at that
 * hour, as the month grid's day does.
 */
export function WeekGrid<P extends WeekPost>({
  days,
  timeZone,
  todayKey,
  nowMs,
  postsByDay,
  renderChip,
  newPostLabel,
  weekdayName,
  weekStartsOn,
  dayName,
  ideaHref,
}: {
  days: Date[];
  timeZone: string;
  todayKey: string;
  nowMs: number;
  postsByDay: Map<string, P[]>;
  renderChip: (post: P) => ReactNode;
  newPostLabel: (date: Date) => string;
  weekdayName: (day: number) => string;
  /** 0 Sunday … 6 Saturday: the day in the first column. */
  weekStartsOn: number;
  /** The awareness days falling on a day. */
  dayName: (key: string) => string[];
  /** Where an awareness day's chip leads: the composer, with a first line. Null for past days. */
  ideaHref?: (key: string, name: string) => string | null;
}) {
  const keys = days.map((day) => formatInZone(day, timeZone, 'yyyy-MM-dd'));
  const hourOf = (post: P) => (post.scheduledAt ? Number(formatInZone(post.scheduledAt, timeZone, 'H')) : 0);
  const earliest = Math.min(6, ...keys.flatMap((key) => (postsByDay.get(key) ?? []).map(hourOf)));
  const hours = Array.from({ length: 24 - earliest }, (_, index) => earliest + index);

  return (
    <div className="card overflow-hidden">
      <div className="scroll-x">
        <div className="min-w-[56rem]">
          <div className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-white">
            <div />
            {days.map((day, index) => {
              const key = keys[index]!;
              const names = dayName(key);
              return (
                <div key={key} className="border-l border-slate-200 px-2 py-2 text-center">
                  <p className="text-[13px] font-semibold text-slate-600">{weekdayName((weekStartsOn + index) % 7)}</p>
                  <p
                    className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold ${
                      key === todayKey ? 'bg-brand-600 text-white' : 'text-slate-900'
                    }`}
                  >
                    {formatInZone(day, timeZone, 'd')}
                  </p>
                  {names.map((name) => {
                    const href = ideaHref?.(key, name);
                    const look = 'mt-1 block truncate rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-700';
                    return href ? (
                      <Link key={name} href={href} className={`${look} hover:bg-emerald-100`} title={name}>
                        {name}
                      </Link>
                    ) : (
                      <p key={name} className={look} title={name}>
                        {name}
                      </p>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {hours.map((hour) => (
            <div key={hour} className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))] border-b border-slate-100 last:border-b-0">
              <div className="nums px-2 pt-1.5 text-right text-[11px] font-semibold text-slate-500">
                {String(hour).padStart(2, '0')}:00
              </div>
              {days.map((day, index) => {
                const key = keys[index]!;
                const inHour = (postsByDay.get(key) ?? []).filter((post) => hourOf(post) === hour);
                const start = day.getTime() + hour * 3_600_000;
                const future = start + 3_600_000 > nowMs;
                return (
                  <div
                    key={key}
                    data-drop-day={key}
                    data-drop-hour={hour}
                    className={`group relative min-h-[3.25rem] border-l border-slate-100 p-1 ${
                      key === todayKey ? 'bg-brand-50/40' : key < todayKey ? 'bg-slate-50/70' : 'bg-white'
                    }`}
                  >
                    <ul className="space-y-1">
                      {inHour.map((post) => (
                        <li key={post.id}>{renderChip(post)}</li>
                      ))}
                    </ul>
                    {future && (
                      <Link
                        href={`/compose?at=${key}T${String(hour).padStart(2, '0')}:00`}
                        aria-label={`${newPostLabel(day)} · ${String(hour).padStart(2, '0')}:00`}
                        className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-white text-base leading-none text-slate-500 shadow-surface hover:text-brand-600 focus-visible:flex group-hover:flex"
                      >
                        +
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
