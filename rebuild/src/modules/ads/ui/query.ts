import type { AdsFilters } from '../report-filters';
export function adsQuery(filters: AdsFilters, page: string) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === "custom") {
    params.set("since", filters.since.toISOString().slice(0, 10));
    params.set("until", new Date(filters.until.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  if (filters.accountId) params.set("account", filters.accountId);
  return `${page}?${params.toString()}`;
}

