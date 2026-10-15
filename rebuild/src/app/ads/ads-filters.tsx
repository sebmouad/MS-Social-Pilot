import type { AdsFilters } from "@/server/ads/queries";

type AdsAccountOption = { id: string; name: string };

export function AdsFiltersSidebar({ accounts, filters, action = "/ads" }: { accounts: AdsAccountOption[]; filters: AdsFilters; action?: string }) {
  const value = (date: Date) => date.toISOString().slice(0, 10);
  const untilInclusive = new Date(filters.until.getTime() - 24 * 60 * 60 * 1000);
  return <form action={action} method="get" className="ads-sidebar-filter">
    <p className="shell-subnav__label">Ads filters</p>
    <label><span>Date range</span><select name="period" defaultValue={filters.period}>
      <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom dates</option>
    </select></label>
    <label><span>From</span><input type="date" name="since" defaultValue={value(filters.since)} /></label>
    <label><span>To</span><input type="date" name="until" defaultValue={value(untilInclusive)} /></label>
    <label><span>Ad account</span><select name="account" defaultValue={filters.accountId ?? "all"}>
      <option value="all">All accounts</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
    </select></label>
    <button type="submit">Apply filters</button>
    <a className="ads-filter-reset" href="/ads">Reset</a>
  </form>;
}

export function adsQuery(filters: AdsFilters, page: string) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === "custom") {
    params.set("since", filters.since.toISOString().slice(0, 10));
    params.set("until", new Date(filters.until.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  if (filters.accountId) params.set("account", filters.accountId);
  return `${page}?${params.toString()}`;
}

export function dateRangeLabel(filters: AdsFilters) {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  return `${formatter.format(filters.since)} – ${formatter.format(new Date(filters.until.getTime() - 1))}`;
}
