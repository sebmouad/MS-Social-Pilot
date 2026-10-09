'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

interface Slot {
  dayOfWeek: number;
  hour: number;
  minute: number;
}

interface Suggestion extends Slot {
  lift: number;
  posts: number;
  pages: string[];
}

interface Upcoming {
  iso: string;
  label: string;
  weekday: number;
  post: {
    id: string;
    message: string;
    pending: boolean;
    /** Whether this person may change it now; otherwise it opens the post list. */
    editable: boolean;
  } | null;
}

const time = (slot: Slot) => `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`;
const same = (a: Slot, b: Slot) => a.dayOfWeek === b.dayOfWeek && a.hour === b.hour && a.minute === b.minute;

/** Monday first: the working week reads left to right. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function QueueClient({
  canManage,
  slots: initial,
  suggestions,
  upcoming,
  weekdays,
  sample,
  pageCount,
}: {
  canManage: boolean;
  slots: Slot[];
  suggestions: Suggestion[];
  upcoming: Upcoming[];
  /** Localised, 0 = Sunday. */
  weekdays: string[];
  /** Posts the suggestions were drawn from. */
  sample: number;
  pageCount: number;
}) {
  const t = useTranslations('queue');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [slots, setSlots] = useState<Slot[]>(initial);
  const [draft, setDraft] = useState<Slot>({ dayOfWeek: 1, hour: 9, minute: 0 });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save(next: Slot[], message: string) {
    setPending(true);
    setStatus(null);
    const response = await fetch('/api/queue-slots', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slots: next }),
    }).catch(() => null);
    setPending(false);

    if (!response?.ok) {
      const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setStatus({ kind: 'error', text: body?.error ?? t('saveFailed') });
      return;
    }
    setSlots(next);
    setStatus({ kind: 'ok', text: message });
    // The suggestions and the coming-up list are drawn on the server from
    // the saved queue, so they are redrawn rather than patched here.
    router.refresh();
  }

  const add = (slot: Slot) =>
    slots.some((existing) => same(existing, slot))
      ? setStatus({ kind: 'error', text: t('alreadyThere') })
      : save([...slots, slot], t('added', { day: weekdays[slot.dayOfWeek] ?? '', time: time(slot) }));

  const remove = (slot: Slot) =>
    save(
      slots.filter((existing) => !same(existing, slot)),
      t('removed', { day: weekdays[slot.dayOfWeek] ?? '', time: time(slot) }),
    );

  const free = upcoming.filter((entry) => !entry.post).length;

  return (
    <div className="space-y-6">
      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 text-sm ${
            status.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {status.text}
        </p>
      )}

      {/* What the results say, first: it is the one part that changes the plan. */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon name="sparkles" size={16} className="text-brand-600" />
          {t('suggestionsTitle')}
        </h2>
        <p className="mt-1 text-xs text-slate-500">{t('suggestionsHint', { posts: sample, pages: pageCount })}</p>

        {suggestions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            {sample === 0 ? t('suggestionsNoHistory') : t('suggestionsNone')}{' '}
            {pageCount > 0 && (
              <Link href="/analytics?view=analysis" className="text-brand-600 hover:underline">
                {t('seeAnalysis')}
              </Link>
            )}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {suggestions.map((suggestion) => (
              <li
                key={`${suggestion.dayOfWeek}-${suggestion.hour}-${suggestion.minute}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {weekdays[suggestion.dayOfWeek]} · <span className="nums">{time(suggestion)}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('suggestionDetail', {
                      lift: suggestion.lift,
                      posts: suggestion.posts,
                      pages: suggestion.pages.join(', '),
                    })}
                  </p>
                </div>
                {canManage && (
                  <button type="button" className="btn-secondary" disabled={pending} onClick={() => add(suggestion)}>
                    <Icon name="plus" size={15} />
                    {t('addToQueue')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{t('weeklyTitle')}</h2>
          <p className="text-xs text-slate-500">{t('slotCount', { count: slots.length })}</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('weeklyHint')}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {ORDER.map((weekday) => {
            const today = slots
              .filter((slot) => slot.dayOfWeek === weekday)
              .sort((a, b) => a.hour - b.hour || a.minute - b.minute);
            return (
              <div key={weekday} className="rounded-lg border border-slate-200 p-3">
                <h3 className="text-[13px] font-semibold text-slate-600">{weekdays[weekday]}</h3>
                {today.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">{t('noSlots')}</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5 lg:flex-col">
                    {today.map((slot) => (
                      <li
                        key={time(slot)}
                        className="flex items-center justify-between gap-2 rounded-md bg-brand-50 px-2 py-1 text-sm text-brand-700"
                      >
                        <span className="nums">{time(slot)}</span>
                        {canManage && (
                          <button
                            type="button"
                            className="text-brand-400 hover:text-red-600"
                            aria-label={t('removeSlot', { day: weekdays[slot.dayOfWeek] ?? '', time: time(slot) })}
                            disabled={pending}
                            onClick={() => remove(slot)}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {canManage ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add(draft);
            }}
          >
            <div>
              <label className="label" htmlFor="queueDay">
                {t('day')}
              </label>
              <select
                id="queueDay"
                className="input"
                value={draft.dayOfWeek}
                onChange={(event) => setDraft({ ...draft, dayOfWeek: Number(event.target.value) })}
              >
                {ORDER.map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {weekdays[weekday]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="queueTime">
                {t('time')}
              </label>
              <input
                id="queueTime"
                type="time"
                className="input"
                value={time(draft)}
                onChange={(event) => {
                  const [hour, minute] = event.target.value.split(':');
                  setDraft({ ...draft, hour: Number(hour ?? 9), minute: Number(minute ?? 0) });
                }}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? tCommon('working') : t('addSlot')}
            </button>
          </form>
        ) : (
          <p className="mt-4 text-xs text-slate-500">{t('readOnly')}</p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('upcomingTitle')}</h2>
          <p className="text-xs text-slate-500">{t('upcomingFree', { free, total: upcoming.length })}</p>
        </div>
        {upcoming.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-600 sm:px-5">{t('upcomingNone')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {upcoming.map((entry) => (
              <li key={entry.iso} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="nums w-40 shrink-0 text-sm text-slate-700 sm:w-48">{entry.label}</span>
                {entry.post ? (
                  <Link
                    href={entry.post.editable ? `/compose?post=${entry.post.id}` : '/posts'}
                    className="min-w-0 flex-1 truncate text-sm text-slate-900 hover:underline"
                  >
                    {entry.post.message || t('noText')}
                  </Link>
                ) : (
                  <span className="flex-1 text-sm text-slate-400">{t('free')}</span>
                )}
                {entry.post?.pending && (
                  <span className="badge shrink-0 bg-violet-50 text-violet-700">{t('awaitingApproval')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="px-4 py-3 sm:px-5">
          <Link href="/compose" className="btn-secondary">
            <Icon name="compose" size={15} />
            {t('writePost')}
          </Link>
        </div>
      </section>
    </div>
  );
}
