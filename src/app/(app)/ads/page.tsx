import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { AdsTrend } from '@/components/ads/AdsTrend';
import { BreakdownBars } from '@/components/BreakdownBars';
import { StatTile } from '@/components/charts/StatTile';
import { Icon, type IconName } from '@/components/Icon';
import { QuerySelect } from '@/components/QuerySelect';
import { SyncButton } from '@/components/SyncButton';
import { requirePage } from '@/lib/auth';
import { listAdAccounts, readAdSummary, readCampaigns } from '@/lib/ads';
import { adFindings, adKpis, type AdFinding, type AdKpiKey } from '@/lib/ads-analysis';
import { screenMetadata } from '@/lib/metadata';
import { formatInZone } from '@/lib/time';
import { VIZ, seriesColor } from '@/lib/viz';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('ads.title');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

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
    <header>
      <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
      <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
    </header>
  );

  if (accounts.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <Icon name="megaphone" size={28} className="text-slate-400" />
          <p className="max-w-md text-sm text-slate-600">{t('none')}</p>
          <SyncButton endpoint="/api/ads" body={{ action: 'discover' }} label={t('discover')} variant="primary" />
        </div>
      </div>
    );
  }

  const account = accounts.find((entry) => entry.id === first(params.account)) ?? accounts[0]!;

  const days = Number.parseInt(first(params.days) ?? '30', 10);
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
  const to = new Date();
  const from = new Date(to.getTime() - window * DAY_MS);
  const previousFrom = new Date(from.getTime() - window * DAY_MS);

  const requestedLevel = first(params.level);
  const level: 'campaign' | 'adset' | 'ad' =
    requestedLevel === 'adset' || requestedLevel === 'ad' ? requestedLevel : 'campaign';

  const scope = { workspaceId: auth.workspace.id, adAccountId: account.id };
  const [summary, previous, rows, campaigns] = await Promise.all([
    readAdSummary({ ...scope, from, to }),
    readAdSummary({ ...scope, from: previousFrom, to: new Date(from.getTime() - 1) }),
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

  const display = (key: AdKpiKey, value: number | null): string | number | null => {
    if (value === null) return null;
    if (key === 'spend' || key === 'cpc' || key === 'cpm') return money(value);
    if (key === 'ctr') return `${value}%`;
    return value;
  };

  const hrefWith = (changes: Record<string, string>) => {
    const next = new URLSearchParams({ account: account.id, days: String(window), level });
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    return `/ads?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      {header}

      <div className="filter-row">
        <div className="segmented">
          {[7, 30, 90].map((option) => (
            <Link
              key={option}
              href={hrefWith({ days: String(option) })}
              className={`segmented-item ${option === window ? 'segmented-item-active' : ''}`}
            >
              {t('lastDays', { count: option })}
            </Link>
          ))}
        </div>

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

        <div className="ml-auto flex flex-wrap gap-2">
          <SyncButton endpoint="/api/ads" body={{ action: 'discover' }} label={t('discover')} />
          <SyncButton endpoint="/api/ads" body={{ action: 'sync', adAccountId: account.id }} label={t('sync')} variant="primary" />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {account.name}
        {account.currency ? ` · ${account.currency}` : ''}
        {' · '}
        {account.lastSyncedAt
          ? t('lastSynced', { when: formatInZone(account.lastSyncedAt, timezone, 'd MMM yyyy, HH:mm') })
          : t('neverSynced')}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdsTrend
          title={t('dailySpend')}
          description={currency || undefined}
          valueLabel={t('spend')}
          dateLabel={t('date')}
          colorIndex={0}
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
              <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2">{t(`level_${level}`)}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('spend')}</th>
                  <th scope="col" className="w-32 px-3 py-2">{t('share')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('impressions')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('clicks')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('ctr')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('cpc')}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t('cpm')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const share = summary.spend > 0 ? Math.round((row.spend / summary.spend) * 100) : 0;
                  return (
                    <tr key={row.objectId}>
                      <td className="max-w-xs truncate px-4 py-2.5 font-medium text-slate-900" title={row.name}>
                        {row.name}
                      </td>
                      <td className="nums px-3 py-2.5 text-right text-slate-900">{money(row.spend)}</td>
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
                          <span className="nums w-9 text-right text-xs text-slate-600">{share}%</span>
                        </span>
                      </td>
                      <td className="nums px-3 py-2.5 text-right text-slate-700">{row.impressions.toLocaleString()}</td>
                      <td className="nums px-3 py-2.5 text-right text-slate-700">{row.clicks.toLocaleString()}</td>
                      <td className="nums px-3 py-2.5 text-right text-slate-700">{row.ctr === null ? '—' : `${row.ctr}%`}</td>
                      <td className="nums px-3 py-2.5 text-right text-slate-700">{money(row.cpc)}</td>
                      <td className="nums px-4 py-2.5 text-right text-slate-700">{money(row.cpm)}</td>
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
