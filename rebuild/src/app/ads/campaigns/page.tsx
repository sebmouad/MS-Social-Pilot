import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getAdPerformance } from '@/server/data';

export default async function CampaignsPage() {
  const { workspaceId } = await requireViewer();
  const { campaignRows } = await getAdPerformance(workspaceId, 30);
  const campaigns = new Map<string, { id: string; name: string; account: string; currency: string | null; spend: number; impressions: number; clicks: number; reach: number; reachDate: Date | null }>();
  for (const row of campaignRows) {
    const key = `${row.adAccount.id}:${row.objectId}`;
    const current = campaigns.get(key) ?? { id: row.objectId, name: row.objectName || row.objectId, account: row.adAccount.name, currency: row.adAccount.currency, spend: 0, impressions: 0, clicks: 0, reach: 0, reachDate: null };
    current.spend += row.spend; current.impressions += row.impressions; current.clicks += row.clicks;
    if (!current.reachDate || row.date > current.reachDate) { current.reach = row.reach; current.reachDate = row.date; }
    campaigns.set(key, current);
  }
  const rows = [...campaigns.values()].sort((a, b) => b.spend - a.spend);
  const number = new Intl.NumberFormat();
  return <PageFrame module="ads"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads / Campaigns</p><h1>Campaigns</h1><p>Stored campaign delivery rows for the last 30 days.</p></div></header>
    <section className="panel"><h2>Campaign performance</h2><p className="small-note">Spend, impressions, and clicks are summed by campaign across daily rows. Reach shows the latest daily value because unique reach cannot be added across days.</p>
      {rows.length ? <div className="report-list">{rows.map((row) => <div className="report-row" key={`${row.account}:${row.id}`}><span>{row.name}<small className="small-note">{row.account} · {number.format(row.impressions)} impressions · {number.format(row.clicks)} clicks · latest daily reach {row.reachDate ? number.format(row.reach) : '—'}</small></span><strong>{row.currency ?? ''} {row.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>)}</div> : <div className="empty-state"><h3>No campaign insight rows in this period</h3><p>When the legacy sync has stored campaign-level delivery, it will appear here.</p><a className="text-link" href="/ads">View ad accounts →</a></div>}
    </section>
  </div></PageFrame>;
}
