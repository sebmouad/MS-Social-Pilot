'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';

import { Icon } from './Icon';
import { FeedPost, type FeedLinkPreview, type FeedMedia } from './FeedPost';

interface Slot {
  dayOfWeek: number;
  hour: number;
  minute: number;
  /** One Page's own time, rather than one every Page shares. */
  own?: boolean;
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
  /** The day heading and the time on the rail, in the workspace's zone. */
  day: string;
  time: string;
  post: {
    id: string;
    message: string;
    link: string | null;
    status: string;
    /** The Page, or Pages, it goes to. */
    author: { name: string; pictureUrl: string | null };
    media: FeedMedia[];
    linkPreview: FeedLinkPreview | null;
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
  canMovePosts = false,
  scope,
  slots: initial,
  suggestions,
  upcoming,
  weekdays,
  sample,
  pageCount,
}: {
  canManage: boolean;
  /** Editors and up may shuffle or clear the coming posts. */
  canMovePosts?: boolean;
  /** The Page whose timetable is open, or null for the shared one. */
  scope: { id: string; name: string } | null;
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
  const confirm = useConfirm();
  const router = useRouter();

  const [slots, setSlots] = useState<Slot[]>(initial);
  const [draft, setDraft] = useState<Slot>({ dayOfWeek: 1, hour: 9, minute: 0 });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // On a Page's timetable only its own times are changed here; the shared
  // ones are shown beside them, and edited on the shared timetable.
  const editable = (slot: Slot) => (scope ? slot.own === true : true);

  async function save(next: Slot[], message: string) {
    setPending(true);
    setStatus(null);
    const response = await fetch('/api/queue-slots', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slots: next.filter(editable).map(({ dayOfWeek, hour, minute }) => ({ dayOfWeek, hour, minute })),
        targetId: scope?.id ?? null,
      }),
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
      : save([...slots, { ...slot, own: Boolean(scope) }], t('added', { day: weekdays[slot.dayOfWeek] ?? '', time: time(slot) }));

  const remove = (slot: Slot) =>
    save(
      slots.filter((existing) => !same(existing, slot)),
      t('removed', { day: weekdays[slot.dayOfWeek] ?? '', time: time(slot) }),
    );

  const free = upcoming.filter((entry) => !entry.post).length;

  /** Every suggestion not already a slot, added in one save. */
  async function addAll() {
    const fresh = suggestions.filter((suggestion) => !slots.some((slot) => same(slot, suggestion)));
    if (fresh.length === 0) return;
    await save(
      [...slots, ...fresh.map(({ dayOfWeek, hour, minute }) => ({ dayOfWeek, hour, minute, own: Boolean(scope) }))],
      t('addedAll', { count: fresh.length }),
    );
  }

  async function act(action: 'shuffle' | 'clear') {
    if (!(await confirm({ title: action === 'shuffle' ? t('shuffleConfirm') : t('clearConfirm'), confirmLabel: action === 'shuffle' ? t('shuffle') : t('clear'), danger: action === 'clear' }))) return;
    setPending(true);
    setStatus(null);
    const response = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, targetId: scope?.id ?? null }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { moved?: number; error?: string } | undefined;
    if (!response?.ok) {
      setStatus({ kind: 'error', text: body?.error ?? t('saveFailed') });
      return;
    }
    setStatus({
      kind: 'ok',
      text: action === 'shuffle' ? t('shuffled', { count: body?.moved ?? 0 }) : t('cleared', { count: body?.moved ?? 0 }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Whose timetable follows the channel selector: one channel, its own times. */}
      <p className="text-sm text-slate-600">{scope ? t('ownTimesHint', { page: scope.name }) : t('sharedTimesHint')}</p>

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
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{t('suggestionsHint', { posts: sample, pages: pageCount })}</p>
          {canManage && suggestions.length > 1 && (
            <button type="button" className="btn-primary" disabled={pending} onClick={() => void addAll()}>
              <Icon name="sparkles" size={15} />
              {t('addAllSuggested', { count: suggestions.length })}
            </button>
          )}
        </div>

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
          <h2 className="text-sm font-semibold text-slate-900">
            {scope ? t('weeklyTitleFor', { page: scope.name }) : t('weeklyTitle')}
          </h2>
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
                        key={`${time(slot)}-${slot.own ? 'own' : 'shared'}`}
                        title={scope && !slot.own ? t('sharedTime') : undefined}
                        className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm ${
                          editable(slot) ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <span className="nums flex items-center gap-1">
                          {scope && !slot.own && <Icon name="folders" size={12} className="text-slate-400" />}
                          {time(slot)}
                        </span>
                        {canManage && editable(slot) && (
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
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-500">{t('upcomingFree', { free, total: upcoming.length })}</p>
            {canMovePosts && upcoming.some((entry) => entry.post) && (
              <>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={pending} onClick={() => void act('shuffle')}>
                  <Icon name="refresh" size={14} />
                  {t('shuffle')}
                </button>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs hover:text-red-600" disabled={pending} onClick={() => void act('clear')}>
                  <Icon name="close" size={14} />
                  {t('clearQueue')}
                </button>
              </>
            )}
          </div>
        </div>
        {upcoming.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-600 sm:px-5">{t('upcomingNone')}</p>
        ) : (
          // A timeline, day by day: each slot's time on the rail, and beside
          // it the post that takes it, drawn as the feed will draw it — or,
          // where nothing does yet, the way in to writing one.
          <div className="mt-3 border-t border-slate-100 bg-slate-50/60">
          <div className="mx-auto max-w-[720px] space-y-5 px-3 py-4 sm:px-5">
            {days(upcoming).map((group) => (
              <section key={group.day} aria-label={group.day}>
                <h3 className="mb-2 px-1 text-[15px] font-semibold text-slate-600 first-letter:uppercase">
                  {group.day}
                </h3>
                <ol className="space-y-3">
                  {group.entries.map((entry) => (
                    <li key={entry.iso} className="flex gap-3">
                      <time
                        dateTime={entry.iso}
                        className="nums w-12 shrink-0 pt-3 text-end text-sm font-semibold text-slate-900"
                        title={entry.label}
                      >
                        {entry.time}
                      </time>
                      <div className="min-w-0 flex-1">
                        {entry.post ? (
                          <FeedPost
                            compact
                            clamp
                            className="ring-1 ring-black/5"
                            href={entry.post.editable ? `/compose?post=${entry.post.id}` : '/posts'}
                            author={entry.post.author}
                            meta={t('inQueue')}
                            badge={
                              entry.post.pending ? (
                                <span className="badge bg-violet-50 text-violet-700">{t('awaitingApproval')}</span>
                              ) : undefined
                            }
                            message={entry.post.message}
                            emptyText={t('noText')}
                            media={entry.post.media}
                            link={entry.post.link}
                            linkPreview={entry.post.linkPreview}
                            seeMore={tCommon('seeMore')}
                          />
                        ) : (
                          <Link
                            href={scope ? `/compose?intent=queue&to=${scope.id}` : '/compose?intent=queue'}
                            className="flex items-center gap-3 rounded-lg border-2 border-dashed border-slate-200 px-3 py-3 text-sm text-slate-600 hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-700"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                              <Icon name="plus" size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-slate-700">{t('free')}</span>
                              <span className="block text-xs">{t('freeHint')}</span>
                            </span>
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          </div>
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

/** Consecutive slots sharing a day, in the order they come. */
function days(entries: Upcoming[]): Array<{ day: string; entries: Upcoming[] }> {
  const groups: Array<{ day: string; entries: Upcoming[] }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.day === entry.day) last.entries.push(entry);
    else groups.push({ day: entry.day, entries: [entry] });
  }
  return groups;
}
