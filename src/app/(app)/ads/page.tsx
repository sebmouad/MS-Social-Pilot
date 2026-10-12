import { ScreenHeader } from '@/components/ScreenHeader';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { AdsTrend } from '@/components/ads/AdsTrend';
import { BreakdownBars } from '@/components/BreakdownBars';
import { StatTile } from '@/components/charts/StatTile';
import { Icon, type IconName } from '@/components/Icon';
import { QuerySelect } from '@/components/QuerySelect';
import { AutoSyncNote } from '@/components/AutoSyncNote';
import { requirePage } from '@/lib/auth';
import { listAdAccounts, readAdSummary, readCampaigns, syncedSince, type CampaignRow } from '@/lib/ads';
import { adFindings, adKpis, type AdFinding, type AdKpiKey } from '@/lib/ads-analysis';
import { env } from '@/lib/env';
import { screenMetadata } from '@/lib/metadata';
import { formatInZone } from '@/lib/time';
import { DateRangePicker } from '@/components/DateRangePicker';
import { parseRange, rangeParams } from '@/lib/date-range';
import { VIZ, seriesColor } from '@/lib/viz';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('ads.title');
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A sync older than this leaves recent days unread; see `comparable`. */
const STALE_AFTER_MS = 2 * DAY_MS;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Breakdown columns a reader can sort by, and which way each starts. */
const SORTS = {
  name: 'asc',
  campaign: 'asc',
  spend: 'desc',
  impressions: 'desc',
  clicks: 'desc',
  ctr: 'desc',
  cpc: 'asc',
  cpm: 'asc',
} as const satisfies Record<string, 'asc' | 'desc'>;
type SortKey = keyof typeof SORTS;

/** Missing figures (no clicks, so no cost per click) sort last either way. */
function sortRows(rows: CampaignRow[], key: SortKey, dir: 'asc' | 'desc', locale: string): CampaignRow[] {
  const valueOf = (row: CampaignRow): string | number | null =>
    key === 'name' ? row.name : key === 'campaign' ? row.campaignName : row[key];
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return [...rows].sort((a, b) => {
    const x = valueOf(a);
    const y = valueOf(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order = typeof x === 'string' ? collator.compare(x, String(y)) : x - (y as number);
    return dir === 'asc' ? order : -order;
  });
}

const TONE: Record<AdFinding['tone'], { icon: IconName; className: string }> = {
  good: { icon: 'check', className: 'text-emerald-700' },
  warning: { icon: 'warning', className: 'text-amber-600' },
  info: { icon: 'sparkles', className: 'text-brand-600' },
};

/**
 * The Ads module: what the paid side cost and what it bought.
 *
 * One ad account at a time. Two accounts can bill in two currencies, and a
 * total of euros and dollars with either symbol on it is wrong whichever
 * symbol is chosen — so the screen reads one account, picked at the top, and
 * says so.
 */
export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('ads');
  const locale = await getLocale();
  const params = await searchParams;
  const timezone = auth.workspace.timezone;

  const accounts = await listAdAccounts(auth.workspace.id);

  const header = (
    <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
  );

  if (accounts.length === 0) {
    // Accounts that exist but are all turned off are not "none connected":
    // discovery would find them again and change nothing, and the permission
    // it asks about was never the problem.
    const disabled = (await listAdAccounts(auth.workspace.id, { includeDisabled: true })).length > 0;
    return (
      <div className="space-y-6">
        {header}
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <Icon name="megaphone" size={28} className="text-slate-400" />
          <p className="max-w-md text-sm text-slate-600">{t(disabled ? 'allDisabled' : 'none')}</p>
          {disabled ? (
            <Link href="/connections" className="btn-secondary">
              {t('openConnections')}
            </Link>
          ) : (
            <AutoSyncNote job="ads" timezone={timezone} />
          )}
        </div>
      </div>
    );
  }

  const account = accounts.find((entry) => entry.id === first(params.account)) ?? accounts[0]!;

  // A sync pulls `adWindowDays` of history and no more, so a longer range
  // is offered nowhere: its early part would read as days of no spend rather
  // than days never asked about.
  const syncWindow = env.adWindowDays;

  // The same range control as every other screen, held to what the sync read:
  // a longer preset is not offered, and a custom range is cut to fit.
  const range = parseRange(
    { range: first(params.range), from: first(params.from), to: first(params.to), days: first(params.days) },
    timezone,
  );
  const to = range.to;
  const from = new Date(Math.max(range.from.getTime(), to.getTime() - syncWindow * DAY_MS));
  const window = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  const previousFrom = new Date(from.getTime() - window * DAY_MS);

  // The previous period is compared against only when it was synced in full.
  // With a 90-day window, "last 90 days vs the 90 before" set every figure
  // against zero, and the tiles and findings reported a collapse that was
  // only the edge of the data.
  // And only while the sync is recent: days since the last one were never
  // pulled either, so a stale sync would set an empty current period against
  // a full previous one — the same false collapse, at the other end.
  const coverage = syncedSince(account.lastSyncedAt, syncWindow);
  const stale = account.lastSyncedAt !== null && to.getTime() - account.lastSyncedAt.getTime() > STALE_AFTER_MS;
  const comparable = coverage !== null && !stale && previousFrom.getTime() >= coverage.getTime();

  const requestedLevel = first(params.level);
  const level: 'campaign' | 'adset' | 'ad' =
    requestedLevel === 'adset' || requestedLevel === 'ad' ? requestedLevel : 'campaign';

  const scope = { workspaceId: auth.workspace.id, adAccountId: account.id };
  const [summary, previous, rows, campaigns] = await Promise.all([
    readAdSummary({ ...scope, from, to }),
    comparable
      ? readAdSummary({ ...scope, from: previousFrom, to: new Date(from.getTime() - 1) })
      : Promise.resolve(null),
    readCampaigns({ ...scope, from, to, level }),
    level === 'campaign' ? Promise.resolve(null) : readCampaigns({ ...scope, from, to, level: 'campaign' }),
  ]);

  const kpis = adKpis(summary, previous);
  const findings = adFindings({ current: summary, previous, campaigns: campaigns ?? rows });

  const currency = account.currency ?? summary.currency ?? '';
  const money = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, {
          style: currency ? 'currency' : 'decimal',
          ...(currency ? { currency } : {}),
          maximumFractionDigits: value >= 100 ? 0 : 2,
        }).format(value);

  // CTR arrives as a percentage figure (1.25 for 1.25%); the formatter wants
  // the fraction, and writes the sign and spacing each language expects.
  const percentFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  const percent = (value: number | null) => (value === null ? '—' : percentFormat.format(value / 100));
  const count = (value: number) => value.toLocaleString(locale);

  const display = (key: AdKpiKey, value: number | null): string | number | null => {
    if (value === null) return null;
    if (key === 'spend' || key === 'cpc' || key === 'cpm') return money(value);
    if (key === 'ctr') return percent(value);
    return value;
  };

  const requestedSort = first(params.sort);
  const sort: SortKey =
    requestedSort && Object.hasOwn(SORTS, requestedSort) && (requestedSort !== 'campaign' || level !== 'campaign')
      ? (requestedSort as SortKey)
      : 'spend';
  const requestedDir = first(params.dir);
  const dir: 'asc' | 'desc' = requestedDir === 'asc' || requestedDir === 'desc' ? requestedDir : SORTS[sort];
  const sorted = sortRows(rows, sort, dir, locale);

  const hrefWith = (changes: Record<string, string>) => {
    const next = new URLSearchParams({ account: account.id, ...rangeParams(range), level, sort, dir });
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    return `/ads?${next.toString()}`;
  };

  /** A sortable column header: the active one flips, any other starts its own way. */
  const sortHeader = (key: SortKey, label: string, className: string) => {
    const active = key === sort;
    const nextDir = active ? (dir === 'asc' ? 'desc' : 'asc') : SORTS[key];
    return (
      <th
        scope="col"
        className={className}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <Link
          href={hrefWith({ sort: key, dir: nextDir })}
          className="inline-flex items-center gap-1 hover:text-slate-900"
          scroll={false}
        >
          {label}
          {active && <span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>}
        </Link>
      </th>
    );
  };

  const exportHref = `/api/analytics/export?${new URLSearchParams({
    kind: 'ads',
    adAccountId: account.id,
    from: from.toISOString(),
    to: to.toISOString(),
  }).toString()}`;

  return (
    <div className="space-y-6">
      {header}

      <div className="filter-row">
        <DateRangePicker
          range={range}
          path="/ads"
          keep={{ account: account.id, level, sort, dir }}
          maxDays={syncWindow}
        />

        {accounts.length > 1 && (
          <QuerySelect
            param="account"
            value={account.id}
            label={t('account')}
            options={accounts.map((entry) => ({
              value: entry.id,
              label: entry.currency ? `${entry.name} (${entry.currency})` : entry.name,
            }))}
          />
        )}

        <div className="ms-auto flex flex-wrap gap-2">
          {/* One account's rows in its own currency, over the range on screen. */}
          <a className="btn-secondary" href={exportHref}>
            {t('exportCsv')}
          </a>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {account.name}
        {account.currency ? ` · ${account.currency}` : ''}
        {' · '}
        {account.lastSyncedAt
          ? t('lastSynced', { when: formatInZone(account.lastSyncedAt, timezone, 'd MMM yyyy, HH:mm') })
          : t('neverSynced')}
        {coverage && ` · ${t('coverage', { date: formatInZone(coverage, timezone, 'd MMM yyyy') })}`}
      </p>

      <section className="card-viz">
        <h2 className="text-sm font-semibold text-slate-900">{t('findings.title')}</h2>
        {findings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">{t('findings.none')}</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {findings.map((finding) => (
              <li key={finding.key} className="flex gap-2.5 text-sm text-slate-700">
                <span className={`mt-0.5 shrink-0 ${TONE[finding.tone].className}`}>
                  <Icon name={TONE[finding.tone].icon} size={16} />
                </span>
                <span>{t(`findings.${finding.key}`, finding.params)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <StatTile
            key={kpi.key}
            label={t(kpi.key)}
            value={display(kpi.key, kpi.current)}
            delta={kpi.change}
            deltaLabel={t('vsPrevious')}
            upIsGood={kpi.upIsGood}
          />
        ))}
      </section>

      {coverage && !comparable && (
        <p className="-mt-3 text-xs text-slate-500">
          {stale
            ? t('staleComparison', { when: formatInZone(account.lastSyncedAt!, timezone, 'd MMM yyyy') })
            : t('noComparison', { date: formatInZone(coverage, timezone, 'd MMM yyyy') })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdsTrend
          title={t('dailySpend')}
          description={currency || undefined}
          valueLabel={t('spend')}
          dateLabel={t('date')}
          colorIndex={0}
          currency={currency || undefined}
          points={summary.daily.map((day) => ({ date: day.date, value: day.spend }))}
        />
        <AdsTrend
          title={t('dailyClicks')}
          valueLabel={t('clicks')}
          dateLabel={t('date')}
          colorIndex={1}
          points={summary.daily.map((day) => ({ date: day.date, value: day.clicks }))}
        />
      </div>

      {Object.keys(summary.actions).length > 0 && (
        <BreakdownBars
          title={t('actions')}
          description={t('actionsHint')}
          data={summary.actions}
          formatKey={(key) => key.replace(/^offsite_conversion\.fb_pixel_|^onsite_conversion\./, '').replace(/_/g, ' ')}
        />
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('breakdownTitle')}</h2>
          <div className="segmented">
            {(['campaign', 'adset', 'ad'] as const).map((option) => (
              <Link
                key={option}
                href={hrefWith({ level: option })}
                className={`segmented-item ${option === level ? 'segmented-item-active' : ''}`}
              >
                {t(`level_${option}`)}
              </Link>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-600">{t('noCampaigns')}</p>
        ) : (
          <div className="scroll-x">
            <table className="mt-3 w-full min-w-[760px] text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-start text-[13px] font-semibold text-slate-600">
                <tr>
                  {sortHeader('name', t(`level_${level}`), 'px-4 py-2')}
                  {level !== 'campaign' && sortHeader('campaign', t('level_campaign'), 'px-3 py-2')}
                  {sortHeader('spend', t('spend'), 'px-3 py-2 text-end')}
                  <th scope="col" className="w-32 px-3 py-2">{t('share')}</th>
                  {sortHeader('impressions', t('impressions'), 'px-3 py-2 text-end')}
                  {sortHeader('clicks', t('clicks'), 'px-3 py-2 text-end')}
                  {sortHeader('ctr', t('ctr'), 'px-3 py-2 text-end')}
                  {sortHeader('cpc', t('cpc'), 'px-3 py-2 text-end')}
                  {sortHeader('cpm', t('cpm'), 'px-4 py-2 text-end')}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((row) => {
                  const share = summary.spend > 0 ? Math.round((row.spend / summary.spend) * 100) : 0;
                  return (
                    <tr key={row.objectId}>
                      <td className="max-w-xs truncate px-4 py-2.5 font-medium text-slate-900" title={row.name}>
                        {row.name}
                      </td>
                      {level !== 'campaign' && (
                        <td
                          className="max-w-[12rem] truncate px-3 py-2.5 text-slate-600"
                          title={row.campaignName ?? undefined}
                        >
                          {row.campaignName ?? '—'}
                        </td>
                      )}
                      <td className="nums px-3 py-2.5 text-end text-slate-900">{money(row.spend)}</td>
                      <td className="px-3 py-2.5">
                        {/* Share of spend as a bar with its number: which line
                            the budget actually went on, readable at a glance. */}
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-sm" style={{ background: VIZ.grid }}>
                            <span
                              className="block h-full"
                              style={{
                                width: `${Math.max(1.5, share)}%`,
                                background: seriesColor(0),
                                borderTopRightRadius: 4,
                                borderBottomRightRadius: 4,
                              }}
                            />
                          </span>
                          <span className="nums w-10 text-end text-xs text-slate-600">{percentFormat.format(share / 100)}</span>
                        </span>
                      </td>
                      <td className="nums px-3 py-2.5 text-end text-slate-700">{count(row.impressions)}</td>
                      <td className="nums px-3 py-2.5 text-end text-slate-700">{count(row.clicks)}</td>
                      <td className="nums px-3 py-2.5 text-end text-slate-700">{percent(row.ctr)}</td>
                      <td className="nums px-3 py-2.5 text-end text-slate-700">{money(row.cpc)}</td>
                      <td className="nums px-4 py-2.5 text-end text-slate-700">{money(row.cpm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-500">{t('reachNote')}</p>
    </div>
  );
}
