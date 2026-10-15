import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { AdsFiltersSidebar, dateRangeLabel } from '../ads-filters';
import { getAdsAccounts, getAdsDataset, parseAdsFilters, type AdsSearchParams } from '@/server/ads/queries';
import { formatMetricJson, groupSummariesByAccount, summarizeInsights } from '@/server/ads/summary';
import { canManageWorkspaceAds } from '@/server/ads/actions';
import { AdsObjectActions } from '../AdsObjectActions';
import { CampaignCreateForm } from '../CampaignCreateForm';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const money = (value: number | null, currency: string | null) => value === null ? '—' : `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const date = (value: Date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(value);

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<AdsSearchParams> }) {
  const viewer = await requireViewer({ feature: 'ads/campaigns' });
  const { workspaceId } = viewer;
  const [params, accounts] = await Promise.all([searchParams, getAdsAccounts(workspaceId)]);
  const filters = parseAdsFilters(params, accounts.map(account => account.id));
  const { insights } = await getAdsDataset(workspaceId, filters);
  const summaries = summarizeInsights(insights).filter(row => ['campaign', 'adset', 'ad'].includes(row.level));
  const byAccount = groupSummariesByAccount(summaries);
  const actionAvailability = new Map(await Promise.all([...byAccount.keys()].map(async accountId => [
    accountId,
    await canManageWorkspaceAds({ userId: viewer.user.id, workspaceId }, accountId),
  ] as const)));
  const createAvailability = new Map(await Promise.all(accounts.map(async account => [account.id, await canManageWorkspaceAds({ userId: viewer.user.id, workspaceId }, account.id)] as const)));
  const sidebar = <AdsFiltersSidebar accounts={accounts} filters={filters} action="/ads/campaigns" />;
  return <PageFrame module="ads" sidebar={sidebar}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads / Performance</p><h1>Campaign, ad set, and ad results</h1><p>Stored daily insight records · {dateRangeLabel(filters)}. Select an account and date range in the sidebar.</p></div></header>
    {byAccount.size ? [...byAccount].map(([accountId, rows]) => {
      const account = accounts.find(item => item.id === accountId);
      const levels = [
        { value: 'campaign', label: 'Campaigns' }, { value: 'adset', label: 'Ad sets' }, { value: 'ad', label: 'Ads' },
      ];
      return <section className="panel ads-results-panel" key={accountId}>
        <div className="analytics-panel-title"><div><h2>{rows[0]?.accountName ?? account?.name ?? 'Ad account'}</h2><p className="small-note">{account?.actId}{account?.currency ? ` · ${account.currency}` : ''}</p></div><span className="badge">{rows.length} objects</span></div>
        {levels.map(level => {
          const levelRows = rows.filter(row => row.level === level.value);
          if (!levelRows.length) return null;
          return <div className="ads-result-level" key={level.value}><h3>{level.label}</h3><div className="ui-table-wrap"><table className="ui-table ads-performance-table"><thead><tr><th>{level.label.slice(0, -1)} name</th><th>Daily rows</th><th className="is-end">Spend</th><th className="is-end">Impressions</th><th className="is-end">Latest reach</th><th className="is-end">Clicks</th><th className="is-end">CPC</th><th className="is-end">CPM</th><th className="is-end">CTR</th><th className="is-end">CPP</th><th className="is-end">Freq.</th><th>Stored details</th></tr></thead>
            <tbody>{levelRows.map(row => <tr key={row.key}>
              <td><strong>{row.name}</strong><small className="ads-object-id">{row.id}</small>{actionAvailability.get(accountId) ? <AdsObjectActions adAccountId={accountId} objectId={row.id} objectType={row.level as 'campaign' | 'adset' | 'ad'} /> : null}</td>
              <td>{row.rows}</td><td className="is-end">{money(row.spend, row.currency)}</td><td className="is-end">{number.format(row.impressions)}</td><td className="is-end">{number.format(row.reach)}<small>{date(row.reachDate)}</small></td><td className="is-end">{number.format(row.clicks)}</td><td className="is-end">{money(row.cpc, row.currency)}</td><td className="is-end">{money(row.cpm, row.currency)}</td><td className="is-end">{row.ctr === null ? '—' : `${number.format(row.ctr)}%`}</td><td className="is-end">{money(row.cpp, row.currency)}</td><td className="is-end">{row.frequency === null ? '—' : number.format(row.frequency)}</td>
              <td><details className="ads-stored-details"><summary>{row.rows} daily row{row.rows === 1 ? '' : 's'}</summary><div className="ads-detail-content"><h4>Action metrics · summed across daily rows</h4>{row.actions.length ? <ul>{row.actions.map(action => <li key={action.name}><span>{action.name}</span><strong>{number.format(action.value)}</strong></li>)}</ul> : <p>No action breakdown stored.</p>}<h4>Daily stored provider metrics and fields</h4>{row.dailyMetrics.map(day => <details className="ads-day-details" key={day.date.toISOString()}><summary>{date(day.date)}</summary><p>CPC {money(day.cpc, row.currency)} · CPM {money(day.cpm, row.currency)} · CPP {money(day.cpp, row.currency)} · CTR {day.ctr === null ? '—' : `${number.format(day.ctr)}%`} · Frequency {day.frequency === null ? '—' : number.format(day.frequency)}</p><pre>Actions: {formatMetricJson(day.actions)}{`\n`}Other fields: {formatMetricJson(day.fields)}</pre></details>)}</div></details></td>
            </tr>)}</tbody></table></div></div>;
        })}
      </section>;
    }) : <section className="panel"><div className="empty-state"><h2>No campaign, ad set, or ad insights stored</h2><p>When insight rows are captured for the selected ad accounts and dates, each level will appear here with its saved metrics.</p><a className="text-link" href="/ads">Return to ad accounts →</a></div></section>}
    {accounts.filter(account => !filters.accountId || account.id === filters.accountId).some(account => createAvailability.get(account.id)) ? <section className="panel"><h2>Create a campaign</h2><p className="small-note">Each campaign is created paused under one enabled Facebook ad account.</p>
      {accounts.filter(account => !filters.accountId || account.id === filters.accountId).filter(account => createAvailability.get(account.id)).map(account => <CampaignCreateForm key={account.id} adAccountId={account.id} accountName={account.name} />)}
    </section> : null}
    <p className="ads-read-only-note">Review delivery and adjust eligible campaigns, ad sets, and ads. Changes require confirmation before they are sent.</p>
  </div></PageFrame>;
}
