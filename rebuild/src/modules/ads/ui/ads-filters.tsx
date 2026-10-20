import { PageHeader } from '@/components/PageHeader';
import type { AdsFilters } from "@/modules/ads/server/queries";
import { AdsFilterForm } from './AdsFilterForm';
import { AdsFilterError, type AdsSearchParams } from '@/modules/ads/report-filters';
import { PageFrame } from '@/server/PageFrame';
import { RouteNotice } from '@/components/RouteNotice';
import type { AdsReportPolicy } from '@/modules/ads/report-policy';
import { AdsPageError } from '@/modules/ads/report-page';
import { OperationError } from '@/lib/operation-error';
import { AdsReportLimitError } from '@/modules/ads/read-policy';
import type { AdsPageSlice } from '@/modules/ads/report-page';
import { AdsReportPager } from './AdsReportPager';
import { AdsReportExport } from './AdsReportExport';
import type { AdsOutputPolicy } from '@/modules/ads/output-policy';

type AdsAccountOption = { id: string; name: string };

export function AdsFiltersSidebar({ accounts, filters, input, errors, action = "/ads", policy }: { accounts: AdsAccountOption[]; filters?: AdsFilters; input?: AdsSearchParams; errors?: AdsFilterError['fields']; action?: string; policy: AdsReportPolicy }) {
  const value = (date: Date) => date.toISOString().slice(0, 10);
  const first = (raw: string | string[] | undefined, fallback: string) => (Array.isArray(raw) ? raw[0] : raw) ?? fallback;
  const values = filters ? { period: filters.period, since: value(filters.since), until: value(new Date(filters.until.getTime() - 24 * 60 * 60 * 1000)), account: filters.accountId ?? 'all' }
    : { period: first(input?.period, policy.defaultPreset), since: first(input?.since, ''), until: first(input?.until, ''), account: first(input?.account, 'all') };
  return <AdsFilterForm key={JSON.stringify(values)} accounts={accounts} values={values} errors={errors} action={action} policy={policy} />;
}

export function AdsFilterErrorView({ accounts, input, error, action, title, policy }: { accounts: AdsAccountOption[]; input: AdsSearchParams; error: AdsFilterError; action: string; title: string; policy: AdsReportPolicy }) {
  return <PageFrame module="ads" sidebar={<AdsFiltersSidebar accounts={accounts} input={input} errors={error.fields} action={action} policy={policy} />}><div className="page-stack">
    <PageHeader module="ads" title={title} />
    <section className="panel"><h2>Check your filters</h2><RouteNotice error className="ui-error" focusKey={JSON.stringify(input)}>{error.message}</RouteNotice><p>Correct your selection in Filters, or use Reset filters. No report was loaded.</p></section>
  </div></PageFrame>;
}

export function AdsReportFailureView({ accounts, input, filters, error, action, title, policy }: { accounts: AdsAccountOption[]; input: AdsSearchParams & { page?: string | string[] }; filters: AdsFilters; error: unknown; action: string; title: string; policy: AdsReportPolicy }) {
  const isPageError = error instanceof AdsPageError;
  if (!isPageError && !(error instanceof AdsReportLimitError) && !(error instanceof OperationError && error.code === 'unavailable')) throw error;
  const message = error.message;
  const href = adsQuery(filters, action);
  return <PageFrame module="ads" sidebar={<><AdsFiltersSidebar accounts={accounts} filters={filters} action={action} policy={policy} /><a className="ads-page-reset" href={href}>{isPageError ? 'Return to page 1' : 'Retry from page 1'}</a></>}><div className="page-stack">
    <PageHeader module="ads" title={title} />
    <section className="panel"><h2>{isPageError ? 'Check the report page' : 'Report could not be loaded completely'}</h2><RouteNotice error className="ui-error" focusKey={`${action}:${String(input.page)}:${message}`}>{message}</RouteNotice><p>{isPageError ? 'Use the page controls in Filters or return to the first page. No report was loaded.' : 'No partial report is shown. Narrow the account or date range, then try again.'}</p></section>
  </div></PageFrame>;
}

export function AdsReportSidebar<T>({ accounts, filters, policy, action, kind, page, canExport = false, maxRows, exportPolicy }: { accounts: AdsAccountOption[]; filters: AdsFilters; policy: AdsReportPolicy; action: string; kind: 'accounts' | 'objects'; page: AdsPageSlice<T>; canExport?: boolean; maxRows?: number; exportPolicy?: Pick<AdsOutputPolicy, 'exportMaxBytes' | 'exportFileName'> }) {
  return <><AdsFiltersSidebar accounts={accounts} filters={filters} action={action} policy={policy} /><AdsReportPager filters={filters} path={action} kind={kind} page={page} />
    {canExport && maxRows && exportPolicy ? <div className="ads-report-export"><AdsReportExport filters={filters} maxRows={maxRows} maxBytes={exportPolicy.exportMaxBytes} fileName={exportPolicy.exportFileName} /></div> : null}
  </>;
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
