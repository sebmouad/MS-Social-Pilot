import { localizeAdsMessage } from '@/modules/ads/copy';
import { adsTranslator, defaultAdsCatalogs, type AdsCatalogs } from '../copy';
import { adsQuery } from './query';
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

export function AdsFiltersSidebar({ accounts, filters, input, errors, action = "/ads", policy, catalogs = defaultAdsCatalogs, locale = 'en' }: { catalogs?: AdsCatalogs; locale?: 'en' | 'fr'; accounts: AdsAccountOption[]; filters?: AdsFilters; input?: AdsSearchParams; errors?: AdsFilterError['fields']; action?: string; policy: AdsReportPolicy }) {
  const t = adsTranslator(catalogs, locale);
  const value = (date: Date) => date.toISOString().slice(0, 10);
  const first = (raw: string | string[] | undefined, fallback: string) => (Array.isArray(raw) ? raw[0] : raw) ?? fallback;
  const values = filters ? { period: filters.period, since: value(filters.since), until: value(new Date(filters.until.getTime() - 24 * 60 * 60 * 1000)), account: filters.accountId ?? 'all' }
    : { period: first(input?.period, policy.defaultPreset), since: first(input?.since, ''), until: first(input?.until, ''), account: first(input?.account, 'all') };
  return <AdsFilterForm key={JSON.stringify(values)} accounts={accounts} values={values} errors={errors} action={action} policy={policy} />;
}

export function AdsFilterErrorView({ accounts, input, error, action, title, policy, catalogs = defaultAdsCatalogs, locale = 'en' }: { catalogs?: AdsCatalogs; locale?: 'en' | 'fr'; accounts: AdsAccountOption[]; input: AdsSearchParams; error: AdsFilterError; action: string; title: string; policy: AdsReportPolicy }) {
  const t = adsTranslator(catalogs, locale);
  return <PageFrame module="ads" sidebar={<AdsFiltersSidebar catalogs={catalogs} locale={locale} accounts={accounts} input={input} errors={error.fields} action={action} policy={policy} />}><div className="page-stack">
    <PageHeader module="ads" title={title} />
    <section className="panel"><h2>{t('text265')}</h2><RouteNotice error className="ui-error" focusKey={JSON.stringify(input)}>{Object.values(error.fields).filter(Boolean).map(message => localizeAdsMessage(catalogs, locale, message!)).join(' ')}</RouteNotice><p>{t('text266')}</p></section>
  </div></PageFrame>;
}

export function AdsReportFailureView({ accounts, input, filters, error, action, title, policy, catalogs = defaultAdsCatalogs, locale = 'en' }: { catalogs?: AdsCatalogs; locale?: 'en' | 'fr'; accounts: AdsAccountOption[]; input: AdsSearchParams & { page?: string | string[] }; filters: AdsFilters; error: unknown; action: string; title: string; policy: AdsReportPolicy }) {
  const t = adsTranslator(catalogs, locale);
  const isPageError = error instanceof AdsPageError;
  if (!isPageError && !(error instanceof AdsReportLimitError) && !(error instanceof OperationError && error.code === 'unavailable')) throw error;
  const message = error.message;
  const href = adsQuery(filters, action);
  return <PageFrame module="ads" sidebar={<><AdsFiltersSidebar catalogs={catalogs} locale={locale} accounts={accounts} filters={filters} action={action} policy={policy} /><a className="ads-page-reset" href={href}>{isPageError ? t('text267') : t('text268')}</a></>}><div className="page-stack">
    <PageHeader module="ads" title={title} />
    <section className="panel"><h2>{isPageError ? t('text269') : t('text270')}</h2><RouteNotice error className="ui-error" focusKey={`${action}:${String(input.page)}:${message}`}>{localizeAdsMessage(catalogs, locale, message)}</RouteNotice><p>{isPageError ? t('text271') : t('text272')}</p></section>
  </div></PageFrame>;
}

export function AdsReportSidebar<T>({ accounts, filters, policy, action, kind, page, canExport = false, maxRows, exportPolicy, catalogs = defaultAdsCatalogs, locale = 'en' }: { catalogs?: AdsCatalogs; locale?: 'en' | 'fr'; accounts: AdsAccountOption[]; filters: AdsFilters; policy: AdsReportPolicy; action: string; kind: 'accounts' | 'objects'; page: AdsPageSlice<T>; canExport?: boolean; maxRows?: number; exportPolicy?: Pick<AdsOutputPolicy, 'exportMaxBytes' | 'exportFileName'> }) {
  const t = adsTranslator(catalogs, locale);
  return <><AdsFiltersSidebar catalogs={catalogs} locale={locale} accounts={accounts} filters={filters} action={action} policy={policy} /><AdsReportPager filters={filters} path={action} kind={kind} page={page} />
    {canExport && maxRows && exportPolicy ? <div className="ads-report-export"><AdsReportExport filters={filters} maxRows={maxRows} maxBytes={exportPolicy.exportMaxBytes} fileName={exportPolicy.exportFileName} /></div> : null}
  </>;
}

export { adsQuery } from './query';

export function dateRangeLabel(filters: AdsFilters) {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
  return `${formatter.format(filters.since)} – ${formatter.format(new Date(filters.until.getTime() - 1))}`;
}
