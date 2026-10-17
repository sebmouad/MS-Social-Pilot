import type { AdsFilters } from "@/server/ads/queries";
import { AdsFilterForm } from './AdsFilterForm';
import { AdsFilterError, type AdsSearchParams } from '@/modules/ads/report-filters';
import { PageFrame } from '@/server/PageFrame';
import { RouteNotice } from '@/components/RouteNotice';

type AdsAccountOption = { id: string; name: string };

export function AdsFiltersSidebar({ accounts, filters, input, errors, action = "/ads" }: { accounts: AdsAccountOption[]; filters?: AdsFilters; input?: AdsSearchParams; errors?: AdsFilterError['fields']; action?: string }) {
  const value = (date: Date) => date.toISOString().slice(0, 10);
  const first = (raw: string | string[] | undefined, fallback: string) => (Array.isArray(raw) ? raw[0] : raw) ?? fallback;
  const values = filters ? { period: filters.period, since: value(filters.since), until: value(new Date(filters.until.getTime() - 24 * 60 * 60 * 1000)), account: filters.accountId ?? 'all' }
    : { period: first(input?.period, '30d'), since: first(input?.since, ''), until: first(input?.until, ''), account: first(input?.account, 'all') || 'all' };
  return <AdsFilterForm key={JSON.stringify(values)} accounts={accounts} values={values} errors={errors} action={action} />;
}

export function AdsFilterErrorView({ accounts, input, error, action, title }: { accounts: AdsAccountOption[]; input: AdsSearchParams; error: AdsFilterError; action: string; title: string }) {
  return <PageFrame module="ads" sidebar={<AdsFiltersSidebar accounts={accounts} input={input} errors={error.fields} action={action} />}><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Ads</p><h1>{title}</h1></div></header>
    <section className="panel"><h2>Check your filters</h2><RouteNotice error className="ui-error" focusKey={JSON.stringify(input)}>{error.message}</RouteNotice><p>Correct your selection in Filters, or use Reset filters. No report was loaded.</p></section>
  </div></PageFrame>;
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
