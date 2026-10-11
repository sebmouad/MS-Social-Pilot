'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { BarList } from './charts/BarList';
import { ChartFrame } from './charts/ChartFrame';
import { StatTile } from './charts/StatTile';
import { TimeSeries } from './charts/TimeSeries';
import { Sparkline } from './Sparkline';
import { VIZ, compact } from '@/lib/viz';

export interface SeriesView {
  metric: string;
  period: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  breakdown: boolean;
  points: Array<{ endTime: string; value: number | Record<string, number> }>;
  total: number | null;
  latest: number | Record<string, number> | null;
  trend: number | null;
}

export interface AvailabilityView {
  metric: string;
  label: string;
  period: string;
  available: boolean;
  reason: string | null;
  description: string;
  deprecatedFrom: string | null;
}

export interface CoverageView {
  level: string;
  levelLabel: string;
  catalogue: number;
  checked: number;
  available: number;
  unavailable: number;
}

interface Props {
  targetId: string;
  targetName: string;
  /**
   * The workspace's zone. Dates are formatted in it on both sides of the
   * render, so the server's zone and the reader's cannot disagree about which
   * day a data point ends on.
   */
  timeZone: string;
  /** Whether this member may make the server call Graph (editor and up). */
  canSync: boolean;
  series: SeriesView[];
  availability: AvailabilityView[];
  coverage: CoverageView[];
  profile: {
    fanCount: number | null;
    followersCount: number | null;
    talkingAboutCount: number | null;
    syncedLabel: string | null;
  };
  /** `metric::period` keys this person has pinned, and those that may be. */
  pinned?: string[];
  pinnable?: string[];
}

/** Turn a breakdown map into a plain record, dropping anything non-numeric. */
function asMap(value: number | Record<string, number> | null): Record<string, number> {
  if (!value || typeof value === 'number') return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, count]) => typeof count === 'number'),
  );
}

/**
 * Metrics where a rising number is bad news.
 *
 * Colouring every upward arrow green would congratulate a page on more unlikes
 * and more people hiding its posts.
 */
const DOWN_IS_GOOD = /unlike|negative_feedback|fan_removes|unfollows|blocked|reported|spam/;

/** The metric a page's overview should lead with, in order of preference. */
const HEADLINE = [
  // Viewers and views, Meta's replacements for reach and impressions; the
  // retired names after them, for a Page whose stored history predates them.
  'page_total_media_view_unique',
  'page_media_view',
  'page_impressions_unique',
  'page_impressions',
  'page_post_engagements',
];

export function AnalyticsClient({
  targetId,
  targetName,
  timeZone,
  canSync,
  series,
  availability,
  coverage,
  profile,
  pinned: initialPinned = [],
  pinnable = [],
}: Props) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [probing, setProbing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [filter, setFilter] = useState('');
  const [featured, setFeatured] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>(initialPinned);
  const [pinError, setPinError] = useState<string | null>(null);

  /** Pin or unpin a metric as a tile on the analysis; saved for this person. */
  async function togglePin(key: string) {
    const next = pinned.includes(key) ? pinned.filter((entry) => entry !== key) : [...pinned, key];
    setPinError(null);
    const response = await fetch('/api/analytics/pinned', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics: next }),
    });
    if (!response.ok) {
      setPinError(t('pinFailed'));
      return;
    }
    const body = (await response.json()) as { pinned: string[] };
    setPinned(body.pinned);
    if (!pinned.includes(key) && !body.pinned.includes(key)) setPinError(t('pinLimit'));
  }

  /** Metrics that are a time series — the ones worth plotting. */
  const plottable = useMemo(
    () => series.filter((entry) => !entry.breakdown && entry.points.length > 1),
    [series],
  );

  const featuredSeries = useMemo(() => {
    if (featured) {
      const chosen = plottable.find((entry) => `${entry.metric}::${entry.period}` === featured);
      if (chosen) return chosen;
    }
    for (const name of HEADLINE) {
      const match = plottable.find((entry) => entry.metric === name);
      if (match) return match;
    }
    return plottable[0];
  }, [plottable, featured]);

  const categories = useMemo(() => {
    const grouped = new Map<string, SeriesView[]>();
    const needle = filter.trim().toLowerCase();

    for (const entry of series) {
      if (needle && !entry.label.toLowerCase().includes(needle) && !entry.metric.includes(needle)) {
        continue;
      }
      const bucket = grouped.get(entry.categoryLabel) ?? [];
      bucket.push(entry);
      grouped.set(entry.categoryLabel, bucket);
    }
    return [...grouped.entries()];
  }, [series, filter]);

  const shown = categories.reduce((sum, [, rows]) => sum + rows.length, 0);
  const unavailable = availability.filter((entry) => !entry.available);

  /**
   * Post one action and settle the busy flag whatever happens.
   *
   * The `finally` matters: a dropped connection throws out of `fetch`, and
   * without it the buttons stayed on "Working…" and the whole screen greyed
   * out until a reload.
   */
  async function run<T>(
    action: 'sync' | 'probeAll',
    setBusy: (value: boolean) => void,
    onSuccess: (body: T) => void,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/analytics/${targetId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json().catch(() => ({}))) as T & { error?: string };

      if (!response.ok || body.error) {
        setError(body.error ?? t('syncFailed'));
      } else {
        onSuccess(body);
        router.refresh();
      }
    } catch {
      setError(t('syncFailed'));
    } finally {
      setBusy(false);
    }
  }

  function sync() {
    return run<{ stored?: number; metrics?: number }>('sync', setSyncing, (body) =>
      setMessage(t('synced', { stored: body.stored ?? 0, metrics: body.metrics ?? 0 })),
    );
  }

  /**
   * Ask Graph what it will actually serve, level by level.
   *
   * Separate from `sync` because it is a different question: sync fetches the
   * numbers, this establishes which of the catalogue names exist for this
   * destination at all — against a real Page, a real post, a real video and,
   * when linked, a real Instagram account.
   */
  function probeAll() {
    return run<{ levels?: Array<{ checked: number; available: number }> }>(
      'probeAll',
      setProbing,
      (body) => {
        const checked = (body.levels ?? []).reduce((sum, level) => sum + level.checked, 0);
        const available = (body.levels ?? []).reduce((sum, level) => sum + level.available, 0);
        setMessage(t('probed', { checked, available }));
      },
    );
  }

  const busy = syncing || probing;

  return (
    <div className={`space-y-6 ${busy ? 'is-stale' : ''}`}>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {/* Profile counters lead: they need no insights permission, so they still
          land when everything below is restricted. */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label={t('fans')} value={profile.fanCount} hero />
        <StatTile label={t('followers')} value={profile.followersCount} />
        <StatTile label={t('talkingAbout')} value={profile.talkingAboutCount} />
        {featuredSeries && (
          <StatTile
            label={featuredSeries.label}
            value={featuredSeries.total}
            delta={featuredSeries.trend}
            deltaLabel={t('vsEarlier')}
            upIsGood={!DOWN_IS_GOOD.test(featuredSeries.metric)}
            trend={featuredSeries.points
              .map((point) => point.value)
              .filter((value): value is number => typeof value === 'number')}
          />
        )}
      </section>

      {/* One featured chart, chosen by the reader. A wall of forty small
          charts is unreadable; one large one plus a browsable list is not. */}
      {featuredSeries && (
        <ChartFrame
          title={featuredSeries.label}
          description={featuredSeries.description}
          table={{
            head: [t('date'), t('value')],
            rows: featuredSeries.points
              .filter((point) => typeof point.value === 'number')
              .map((point) => [
                new Date(point.endTime).toLocaleDateString(locale, { timeZone }),
                point.value as number,
              ]),
          }}
        >
          <TimeSeries
            lines={[
              {
                label: featuredSeries.label,
                colorIndex: 0,
                points: featuredSeries.points
                  .filter((point) => typeof point.value === 'number')
                  .map((point) => ({ x: point.endTime, y: point.value as number })),
              },
            ]}
            formatX={(iso) =>
              new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone })
            }
          />
        </ChartFrame>
      )}

      {/* Catalogue coverage: what we know to ask for, against what this
          destination has actually been shown to serve. A level with nothing
          checked has never been probed, which is not the same as refused. */}
      <details className="card-viz group">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
          {t('technicalDetails')}
          <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{t('coverageTitle')}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{t('coverageHint')}</p>
          </div>
          {canSync && (
            <button type="button" className="btn-secondary" onClick={probeAll} disabled={busy}>
              {probing ? tCommon('working') : t('probeAll')}
            </button>
          )}
        </div>

        <ul className="mt-4 space-y-3">
          {coverage.map((row) => {
            const served = row.catalogue > 0 ? (row.available / row.catalogue) * 100 : 0;
            const refused = row.catalogue > 0 ? (row.unavailable / row.catalogue) * 100 : 0;

            return (
              <li key={row.level}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-800">{row.levelLabel}</span>
                  <span className="nums text-slate-500">
                    {t('servedOf', { available: row.available, catalogue: row.catalogue })}
                  </span>
                </div>

                {/* A meter, not a chart: one ratio against a limit. The
                    unfilled track is the same ramp a step lighter, so the
                    state reads across the whole bar. */}
                <div
                  className="mt-1 flex h-2 w-full overflow-hidden rounded-sm"
                  style={{ background: VIZ.grid }}
                  role="img"
                  aria-label={t('servedOf', { available: row.available, catalogue: row.catalogue })}
                >
                  <span style={{ width: `${served}%`, background: 'var(--viz-seq-400)' }} />
                  {/* A 2px surface gap does the separating; no border. */}
                  {refused > 0 && (
                    <>
                      <span style={{ width: 2, background: VIZ.surface }} />
                      <span style={{ width: `${refused}%`, background: 'var(--viz-seq-250)' }} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[11px] text-slate-500">{t('coverageKey')}</p>
      </div>
      </details>

      {pinError && (
        <p role="alert" className="text-sm text-rose-700">
          {pinError}
        </p>
      )}

      {/* The browsable catalogue. Filter row above the content it scopes. */}
      <div className="filter-row justify-between">
        <input
          type="search"
          className="input w-full sm:w-64"
          aria-label={t('filterLabel')}
          placeholder={t('filterPlaceholder')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{t('metricsShown', { count: shown })}</span>
          {canSync && (
            <button type="button" className="btn-primary" onClick={sync} disabled={busy}>
              {syncing ? tCommon('working') : t('syncNow')}
            </button>
          )}
        </div>
      </div>

      {series.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-600">{t('noData')}</p>
          {canSync && (
            <button type="button" className="btn-primary mt-4" onClick={sync} disabled={busy}>
              {syncing ? tCommon('working') : t('syncNow')}
            </button>
          )}
        </div>
      ) : (
        categories.map(([category, metrics]) => (
          <section key={category} className="card-viz">
            <h2 className="text-sm font-semibold text-slate-900">{category}</h2>

            <ul className="mt-3 divide-y divide-slate-100">
              {metrics.map((entry) => {
                const key = `${entry.metric}::${entry.period}`;
                const numeric = entry.points
                  .map((point) => point.value)
                  .filter((value): value is number => typeof value === 'number');
                const map = asMap(entry.latest);
                const isFeatured = featuredSeries && key === `${featuredSeries.metric}::${featuredSeries.period}`;

                const body = (
                  <div className="flex w-full flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{entry.label}</p>
                      <p className="text-xs text-slate-500">{entry.description}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {entry.metric} · {entry.period}
                      </p>
                    </div>

                    {!entry.breakdown && (
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="hidden sm:block">
                          <Sparkline values={numeric} />
                        </span>
                        <span className="text-right">
                          <span className="block text-lg font-semibold text-slate-900">
                            {entry.total !== null ? compact(entry.total, locale) : '—'}
                          </span>
                          {entry.trend !== null && (
                            <span
                              className="block text-xs font-medium"
                              style={{
                                color:
                                  entry.trend >= 0 !== DOWN_IS_GOOD.test(entry.metric)
                                    ? VIZ.goodText
                                    : VIZ.critical,
                              }}
                            >
                              {/* The arrow states the direction; colour only
                                  says whether that direction is welcome. */}
                              {entry.trend >= 0 ? '↑' : '↓'} {Math.abs(entry.trend)}%
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                );

                const canPin = pinnable.includes(key);
                const isPinned = pinned.includes(key);

                return (
                  <li key={key} className="py-3">
                    <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                    {/* A plottable metric is a button that features itself in
                        the chart above; a breakdown is not, because it has
                        nothing to plot over time. */}
                    {entry.breakdown || numeric.length < 2 ? (
                      body
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFeatured(key)}
                        aria-pressed={Boolean(isFeatured)}
                        className={`-mx-2 flex w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-slate-50 ${
                          isFeatured ? 'bg-brand-50/60' : ''
                        }`}
                      >
                        {body}
                      </button>
                    )}
                    </div>
                    {canPin && (
                      <button
                        type="button"
                        onClick={() => togglePin(key)}
                        aria-pressed={isPinned}
                        aria-label={isPinned ? t('unpin', { metric: entry.label }) : t('pin', { metric: entry.label })}
                        title={isPinned ? t('unpinHint') : t('pinHint')}
                        className={`mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                          isPinned ? 'text-amber-500' : 'text-slate-300'
                        }`}
                      >
                        <span aria-hidden>{isPinned ? '★' : '☆'}</span>
                      </button>
                    )}
                    </div>

                    {entry.breakdown && Object.keys(map).length > 0 && (
                      <div className="mt-3">
                        <BarList data={map} limit={6} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {/* Meta removes metrics between versions. Saying so is more useful than
          silently omitting them. */}
      {unavailable.length > 0 && (
        <section className="card-viz">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={showUnavailable}
            onClick={() => setShowUnavailable((value) => !value)}
          >
            <span className="text-sm font-semibold text-slate-900">
              {t('unavailableTitle', { count: unavailable.length })}
            </span>
            <span className="text-xs text-slate-500">{showUnavailable ? '−' : '+'}</span>
          </button>

          {showUnavailable && (
            <>
              <p className="mt-2 text-xs text-slate-500">{t('unavailableHint')}</p>
              <ul className="mt-3 space-y-1.5">
                {unavailable.map((entry) => (
                  <li key={`${entry.metric}-${entry.period}`} className="text-xs">
                    <span className="font-mono text-slate-700">{entry.metric}</span>
                    <span className="text-slate-400"> · {entry.period} · </span>
                    <span className="text-amber-700">{entry.reason}</span>
                    {entry.deprecatedFrom && (
                      <span className="text-slate-400">
                        {' '}
                        · {t('deprecatedFrom', { version: entry.deprecatedFrom })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <p className="text-xs text-slate-500">
        {t('footnote', { name: targetName })}
        {profile.syncedLabel && ` · ${t('syncedAt', { when: profile.syncedLabel })}`}
      </p>
    </div>
  );
}
