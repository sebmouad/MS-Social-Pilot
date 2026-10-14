import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdAccounts, getAdPerformance } from '@/server/data';

export default async function AdsPage() {
  const { workspaceId } = await requireViewer({ feature: 'ads/overview' });
  const accounts = await getAdAccounts(workspaceId);
  const { accountRows } = await getAdPerformance(workspaceId, 30);
  const enabled = accounts.filter((account) => account.enabled).length;
  const synced = accounts.filter((account) => account.lastSyncedAt).length;
  const performance = new Map<string, { name: string; currency: string | null; spend: number; impressions: number; clicks: number; latestReach: number | null; latestDate: Date | null }>();
  for (const row of accountRows) {
    const current = performance.get(row.adAccount.id) ?? { name: row.adAccount.name, currency: row.adAccount.currency, spend: 0, impressions: 0, clicks: 0, latestReach: null, latestDate: null };
    current.spend += row.spend; current.impressions += row.impressions; current.clicks += row.clicks;
    if (!current.latestDate || row.date > current.latestDate) { current.latestDate = row.date; current.latestReach = row.reach; }
    performance.set(row.adAccount.id, current);
  }
  const number = new Intl.NumberFormat();
  return <PageFrame module="ads"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads</p><h1>Ad accounts</h1><p>Connected accounts and stored delivery totals for the last 30 days.</p></div></header>
    <section className="metric-grid"><article className="metric-card"><dl><dt>Linked accounts</dt><dd>{accounts.length}</dd></dl></article><article className="metric-card"><dl><dt>Enabled</dt><dd>{enabled}</dd></dl></article><article className="metric-card"><dl><dt>Have sync timestamp</dt><dd>{synced}</dd></dl></article></section>
    <section className="panel"><div className="analytics-panel-title"><h2>Connected accounts</h2><a className="text-link" href="/settings/connections">Connection settings <span aria-hidden="true">↗</span></a></div>
      {accounts.length ? <div className="account-grid">{accounts.map((account) => <article className="account-card" key={account.id}><div className="account-card__top"><span className="badge">Ad account</span><span className={`badge${account.enabled ? ' is-enabled' : ''}`}>{account.enabled ? 'Enabled' : 'Disabled'}</span></div><h3>{account.name}</h3><p className="small-note">{account.actId}{account.currency ? ` · ${account.currency}` : ''}</p><dl className="account-card__details"><div><dt>Platform status</dt><dd>{account.accountStatus === null ? 'Not provided' : account.accountStatus}</dd></div><div><dt>Last sync</dt><dd>{account.lastSyncedAt ? account.lastSyncedAt.toLocaleString() : 'No sync recorded'}</dd></div></dl></article>)}</div> : <div className="empty-state"><h3>No ad accounts connected</h3><p>Connect an advertising account in connection settings to see its account details here.</p><a className="text-link" href="/settings/connections">Open connection settings →</a></div>}
    </section>
    <section className="panel"><h2>Account delivery · last 30 days</h2><p className="small-note">Spend stays grouped by account so currencies are never combined. Reach is the latest daily account value, not a 30-day sum.</p>
      {performance.size ? <div className="report-list">{[...performance.values()].map((row) => <div className="report-row" key={row.name}><span>{row.name}<small className="small-note">{number.format(row.impressions)} impressions · {number.format(row.clicks)} clicks · latest daily reach {row.latestReach === null ? '—' : number.format(row.latestReach)}</small></span><strong>{row.currency ?? ''} {row.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>)}</div> : <p className="empty-note">No account-level delivery rows are stored for this period. Campaign delivery is shown on the Campaigns page when available.</p>}
    </section>
  </div></PageFrame>;
}
