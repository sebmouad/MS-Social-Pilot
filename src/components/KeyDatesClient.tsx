'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { EmptyState } from './EmptyState';
import { SEASON_RULES, type SeasonRule } from '@/lib/seasons';

interface PageOption {
  id: string;
  name: string;
}

interface KeyDateRow {
  id: string;
  date: string;
  title: string;
  yearly: boolean;
  targetIds: string[];
}

interface SeasonRow {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  targetIds: string[];
  rule: string;
  shiftMinutes: number;
  extraTimes: string[];
}

/** A `yyyy-MM-dd` day as a date at noon UTC, so no zone moves it to the day before. */
const dayOf = (value: string) => new Date(`${value}T12:00:00Z`);

export function KeyDatesClient({
  canEdit,
  pages,
  upcoming,
  followsAnything,
  hindu,
  uncovered,
  keyDates,
  seasons,
  today,
}: {
  canEdit: boolean;
  pages: PageOption[];
  upcoming: Array<{ date: string; kind: string; name: string }>;
  followsAnything: boolean;
  hindu: boolean;
  uncovered: string[];
  keyDates: KeyDateRow[];
  seasons: SeasonRow[];
  today: string;
}) {
  const t = useTranslations('keyDates');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const confirm = useConfirm();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayLabel = (value: string) => format.dateTime(dayOf(value), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const pagesLabel = (ids: string[]) =>
    ids.length === 0 ? t('allPages') : ids.map((id) => pages.find((page) => page.id === id)?.name ?? t('otherPage')).join(', ');

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error || tCommon('genericError'));
        return false;
      }
      setEditing(null);
      router.refresh();
      return true;
    } catch {
      setError(tCommon('genericError'));
      return false;
    } finally {
      setPending(false);
    }
  }

  const ruleText = (season: SeasonRow) =>
    season.rule === 'shift'
      ? t('ruleShiftBy', { minutes: season.shiftMinutes })
      : season.rule === 'more'
        ? t('ruleMoreAt', { times: season.extraTimes.join(', ') })
        : t(`rules.${season.rule as SeasonRule}`);

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section aria-labelledby="upcoming-heading" className="space-y-3">
        <h2 id="upcoming-heading" className="text-base font-semibold text-slate-900">
          {t('upcomingTitle')}
        </h2>
        {!followsAnything && (
          <p className="hint">
            {t.rich('followNothing', { link: (chunks) => <Link className="text-brand-700 underline" href="/settings/pages">{chunks}</Link> })}
          </p>
        )}
        {uncovered.length > 0 && <p className="hint">{t('uncovered', { countries: uncovered.join(', ') })}</p>}
        {hindu && <p className="hint">{t('hinduNote')}</p>}
        {upcoming.length === 0 ? (
          <EmptyState icon="calendar" title={t('upcomingEmptyTitle')} hint={t('upcomingEmptyHint')} />
        ) : (
          <ul className="card divide-y divide-slate-100">
            {upcoming.map((day) => (
              <li key={`${day.date}-${day.kind}-${day.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="w-36 shrink-0 text-slate-500">{dayLabel(day.date)}</span>
                <span className="min-w-0 flex-1 font-medium text-slate-900">{day.name}</span>
                <span className="text-xs text-slate-500">{t(`kind.${day.kind as 'computed' | 'holiday' | 'custom'}`)}</span>
                <Link
                  className="btn-ghost text-sm"
                  href={`/compose?at=${day.date}T09:00&text=${encodeURIComponent(t('ideaStart', { day: day.name }))}`}
                >
                  {t('planPost')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="own-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="own-heading" className="text-base font-semibold text-slate-900">
            {t('ownTitle')}
          </h2>
          {canEdit && editing === null && (
            <button type="button" className="btn-primary" onClick={() => setEditing('date:new')}>
              {t('addDate')}
            </button>
          )}
        </div>
        <p className="hint">{t('ownHint')}</p>
        {editing === 'date:new' && (
          <KeyDateForm
            initial={{ date: today, title: '', yearly: false, targetIds: [] }}
            pages={pages}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSave={(fields) => call('/api/key-dates', 'POST', fields)}
          />
        )}
        {keyDates.length === 0 && editing !== 'date:new' ? (
          <EmptyState icon="calendar" title={t('ownEmptyTitle')} hint={canEdit ? t('ownEmptyHint') : t('readOnlyHint')} />
        ) : (
          <ul className="space-y-2">
            {keyDates.map((row) =>
              editing === `date:${row.id}` ? (
                <li key={row.id}>
                  <KeyDateForm initial={row} pages={pages} pending={pending} onCancel={() => setEditing(null)} onSave={(fields) => call(`/api/key-dates/${row.id}`, 'PATCH', fields)} />
                </li>
              ) : (
                <li key={row.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                    <p className="text-xs text-slate-500">
                      {row.yearly ? t('everyYearFrom', { date: dayLabel(row.date) }) : dayLabel(row.date)} · {pagesLabel(row.targetIds)}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary" disabled={pending || editing !== null} onClick={() => setEditing(`date:${row.id}`)}>
                        {tCommon('edit')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-red-700"
                        disabled={pending}
                        onClick={async () => {
                          if (await confirm({ title: t('deleteDateConfirm', { name: row.title }), body: t('deleteDateBody'), danger: true, confirmLabel: tCommon('delete') })) {
                            void call(`/api/key-dates/${row.id}`, 'DELETE');
                          }
                        }}
                      >
                        {tCommon('delete')}
                      </button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="seasons-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="seasons-heading" className="text-base font-semibold text-slate-900">
            {t('seasonsTitle')}
          </h2>
          {canEdit && editing === null && (
            <button type="button" className="btn-primary" onClick={() => setEditing('season:new')}>
              {t('addSeason')}
            </button>
          )}
        </div>
        <p className="hint">{t('seasonsHint')}</p>
        {editing === 'season:new' && (
          <SeasonForm
            initial={{ name: '', startsOn: today, endsOn: today, targetIds: [], rule: 'pause', shiftMinutes: 60, extraTimes: [] }}
            pages={pages}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSave={(fields) => call('/api/seasons', 'POST', fields)}
          />
        )}
        {seasons.length === 0 && editing !== 'season:new' ? (
          <EmptyState icon="clock" title={t('seasonsEmptyTitle')} hint={canEdit ? t('seasonsEmptyHint') : t('readOnlyHint')} />
        ) : (
          <ul className="space-y-2">
            {seasons.map((row) =>
              editing === `season:${row.id}` ? (
                <li key={row.id}>
                  <SeasonForm initial={row} pages={pages} pending={pending} onCancel={() => setEditing(null)} onSave={(fields) => call(`/api/seasons/${row.id}`, 'PUT', fields)} />
                </li>
              ) : (
                <li key={row.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {row.name}
                      {row.startsOn <= today && row.endsOn >= today && <span className="ms-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{t('active')}</span>}
                      {row.endsOn < today && <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{t('ended')}</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t('range', { from: dayLabel(row.startsOn), to: dayLabel(row.endsOn) })} · {ruleText(row)} · {pagesLabel(row.targetIds)}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary" disabled={pending || editing !== null} onClick={() => setEditing(`season:${row.id}`)}>
                        {tCommon('edit')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-red-700"
                        disabled={pending}
                        onClick={async () => {
                          if (await confirm({ title: t('deleteSeasonConfirm', { name: row.name }), body: t('deleteSeasonBody'), danger: true, confirmLabel: tCommon('delete') })) {
                            void call(`/api/seasons/${row.id}`, 'DELETE');
                          }
                        }}
                      >
                        {tCommon('delete')}
                      </button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function PagesField({ pages, value, onChange }: { pages: PageOption[]; value: string[]; onChange: (value: string[]) => void }) {
  const t = useTranslations('keyDates');
  return (
    <fieldset>
      <legend className="label">{t('pages')}</legend>
      <p className="hint">{t('pagesHint')}</p>
      <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {pages.map((page) => {
          const on = value.includes(page.id);
          return (
            <label key={page.id} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-700'}`}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((id) => id !== page.id) : [...value, page.id])} />
              {page.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function FormButtons({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  const t = useTranslations('keyDates');
  const tCommon = useTranslations('common');
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="btn-primary" disabled={pending}>
        {t('save')}
      </button>
      <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
        {tCommon('cancel')}
      </button>
    </div>
  );
}

function KeyDateForm({
  initial,
  pages,
  pending,
  onCancel,
  onSave,
}: {
  initial: Omit<KeyDateRow, 'id'>;
  pages: PageOption[];
  pending: boolean;
  onCancel: () => void;
  onSave: (fields: Omit<KeyDateRow, 'id'>) => void;
}) {
  const t = useTranslations('keyDates');
  const id = useId();
  const [fields, setFields] = useState(initial);
  const set = (patch: Partial<typeof fields>) => setFields({ ...fields, ...patch });

  return (
    <form
      className="card space-y-4 p-4"
      aria-label={t('dateFormLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(fields);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label className="label" htmlFor={`${id}-title`}>
            {t('dateTitle')}
          </label>
          <input id={`${id}-title`} className="input" required maxLength={120} value={fields.title} placeholder={t('dateTitlePlaceholder')} onChange={(event) => set({ title: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-date`}>
            {t('date')}
          </label>
          <input id={`${id}-date`} type="date" className="input" required value={fields.date} onChange={(event) => set({ date: event.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fields.yearly} onChange={(event) => set({ yearly: event.target.checked })} />
        {t('yearly')}
      </label>
      <PagesField pages={pages} value={fields.targetIds} onChange={(targetIds) => set({ targetIds })} />
      <FormButtons pending={pending} onCancel={onCancel} />
    </form>
  );
}

function SeasonForm({
  initial,
  pages,
  pending,
  onCancel,
  onSave,
}: {
  initial: Omit<SeasonRow, 'id'>;
  pages: PageOption[];
  pending: boolean;
  onCancel: () => void;
  onSave: (fields: Omit<SeasonRow, 'id'>) => void;
}) {
  const t = useTranslations('keyDates');
  const id = useId();
  const [fields, setFields] = useState(initial);
  const [times, setTimes] = useState(initial.extraTimes.join(', '));
  const set = (patch: Partial<typeof fields>) => setFields({ ...fields, ...patch });

  return (
    <form
      className="card space-y-4 p-4"
      aria-label={t('seasonFormLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        const extraTimes = fields.rule === 'more' ? times.split(/[\s,;]+/).filter(Boolean) : [];
        onSave({ ...fields, shiftMinutes: fields.rule === 'shift' ? fields.shiftMinutes : 0, extraTimes });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={`${id}-name`}>
            {t('seasonName')}
          </label>
          <input id={`${id}-name`} className="input" required maxLength={120} value={fields.name} placeholder={t('seasonNamePlaceholder')} onChange={(event) => set({ name: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-from`}>
            {t('startsOn')}
          </label>
          <input id={`${id}-from`} type="date" className="input" required value={fields.startsOn} onChange={(event) => set({ startsOn: event.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-to`}>
            {t('endsOn')}
          </label>
          <input id={`${id}-to`} type="date" className="input" required min={fields.startsOn} value={fields.endsOn} onChange={(event) => set({ endsOn: event.target.value })} />
        </div>
      </div>
      <fieldset>
        <legend className="label">{t('rule')}</legend>
        <div className="segmented" role="radiogroup" aria-label={t('rule')}>
          {SEASON_RULES.map((rule) => (
            <button
              key={rule}
              type="button"
              role="radio"
              aria-checked={fields.rule === rule}
              className={`segmented-item ${fields.rule === rule ? 'segmented-item-active' : ''}`}
              onClick={() => set({ rule })}
            >
              {t(`rules.${rule}`)}
            </button>
          ))}
        </div>
        <p className="hint mt-1">{t(`ruleHints.${fields.rule as SeasonRule}`)}</p>
      </fieldset>
      {fields.rule === 'shift' && (
        <div className="max-w-xs">
          <label className="label" htmlFor={`${id}-shift`}>
            {t('shiftMinutes')}
          </label>
          <input id={`${id}-shift`} type="number" className="input" min={-720} max={720} step={15} value={fields.shiftMinutes} onChange={(event) => set({ shiftMinutes: Number(event.target.value) })} />
        </div>
      )}
      {fields.rule === 'more' && (
        <div className="max-w-sm">
          <label className="label" htmlFor={`${id}-times`}>
            {t('extraTimes')}
          </label>
          <input id={`${id}-times`} className="input" required value={times} placeholder="12:30, 20:00" onChange={(event) => setTimes(event.target.value)} />
        </div>
      )}
      <PagesField pages={pages} value={fields.targetIds} onChange={(targetIds) => set({ targetIds })} />
      <FormButtons pending={pending} onCancel={onCancel} />
    </form>
  );
}
