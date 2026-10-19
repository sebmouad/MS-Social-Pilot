import { Button } from '@/components/Button';
import type { AnalyticsExplorerResult } from '@/modules/analytics/explorer';
import styles from './explorer.module.css';

export function ExplorerSidebar({ data, exportHref, summaryHref }: { data: AnalyticsExplorerResult; exportHref?: string; summaryHref?: string }) {
  const params = new URLSearchParams(data.query);
  const channels = new Set(data.selected.channelIds); const accounts = new Set(data.selected.adAccountIds);
  return <div className={styles.sidebar}>
    {summaryHref && <a href={summaryHref}>Analytics summary</a>}
    <form action="/analytics/explorer" method="get" className={styles.filters}>
      <h2>Explore stored metrics</h2>
      <fieldset><legend>Date range (UTC)</legend><label>From<input type="date" name="start" defaultValue={data.period.start} /></label><label>To<input type="date" name="end" defaultValue={data.period.end} /></label></fieldset>
      <label>Compare with<select name="compare" defaultValue={params.get('compare') ?? 'none'}><option value="none">No comparison</option><option value="previous">Previous equal-length period</option><option value="year">Same dates last year</option></select></label>
      <fieldset><legend>Channels</legend><input type="hidden" name="filter" value="1" />{data.options.channels.length ? data.options.channels.map(channel => <label className={styles.check} key={channel.id}><input type="checkbox" name="channel" value={channel.id} defaultChecked={channels.has(channel.id)} /><span>{channel.name}</span></label>) : <p>No available channels.</p>}</fieldset>
      <fieldset><legend>Ad accounts</legend><input type="hidden" name="adFilter" value="1" />{data.options.adAccounts.length ? data.options.adAccounts.map(account => <label className={styles.check} key={account.id}><input type="checkbox" name="adAccount" value={account.id} defaultChecked={accounts.has(account.id)} /><span>{account.name}{account.currency ? ` · ${account.currency}` : ''}</span></label>) : <p>No available ad accounts.</p>}</fieldset>
      <label>Search metrics<input type="search" name="search" maxLength={data.searchMaxCharacters} defaultValue={data.filters.search} placeholder="Metric name or source" /></label>
      <label>Source<select name="source" defaultValue={data.filters.source}><option value="">All sources</option>{data.options.sources.map(source => <option key={source} value={source}>{source}</option>)}</select></label>
      <label>Measurement type<select name="kind" defaultValue={data.filters.kind}><option value="all">All types</option><option value="flow">Period totals</option><option value="stock">Latest resource values</option><option value="ratio">Ratios</option><option value="breakdown">Category breakdowns</option></select></label>
      <label>Open metric<select name="metric" defaultValue={params.get('metric') ?? ''}><option value="">Metric list</option>{data.options.metrics.map(metric => <option key={metric.key} value={metric.key}>{metric.label} · {metric.sourceLabel}</option>)}</select></label>
      {params.get('metric') && <><input type="hidden" name="pointPage" value="1" /><input type="hidden" name="rowPage" value="1" /></>}
      <Button type="submit" variant="primary">Apply filters</Button><a href="/analytics/explorer">Reset filters</a>
    </form>
    {exportHref && <div className={styles.export}><a href={exportHref}>Export selected date range as CSV</a><p>This uses your Analytics export access and the current export limits.</p></div>}
    <p className={styles.sidebarNote}>Explorer reads stored results only. It does not start provider syncs. Missing values are unknown, not zero.</p>
  </div>;
}
