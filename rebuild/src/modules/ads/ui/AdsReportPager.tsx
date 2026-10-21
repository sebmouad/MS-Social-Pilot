'use client';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';
import type { AdsFilters } from '@/modules/ads/server/queries';
import type { AdsPageSlice } from '@/modules/ads/report-page';
import { adsQuery } from './query';

export function AdsReportPager<T>({ filters, path, kind, page }: { filters: AdsFilters; path: string; kind: 'accounts' | 'objects'; page: AdsPageSlice<T> }) {
  const t = useAdsText();
  const href = (pageNumber: number) => {
    const [pathname, query = ''] = adsQuery(filters, path).split('?', 2);
    const params = new URLSearchParams(query);
    params.set('page', String(pageNumber));
    return `${pathname}?${params.toString()}`;
  };
  return <div className="ads-report-pager">
    <p className="small-note" aria-live="polite">{t('pagerSummary', { from: page.from, to: page.to, total: page.resultCount, kind: t(kind) })}</p>
    <p className="ads-report-pager__current"><span aria-current="page" aria-label={t('text191', { value0: page.page, value1: page.pageCount })}>{t('text191', { value0: page.page, value1: page.pageCount })}</span></p>
    {page.pageCount > 1 ? <nav className="ads-report-pager__nav" aria-label={t('pagesLabel', { kind: kind === 'accounts' ? t('text193') : t('object') })}>
      {page.page > 1 ? <a className="ui-button ui-button--secondary ui-button--md" rel="prev" href={href(page.page - 1)}>{t('text194')}</a> : <span className="ui-button ui-button--secondary ui-button--md" aria-disabled="true">{t('text194')}</span>}
      {page.page < page.pageCount ? <a className="ui-button ui-button--secondary ui-button--md" rel="next" href={href(page.page + 1)}>{t('text195')}</a> : <span className="ui-button ui-button--secondary ui-button--md" aria-disabled="true">{t('text195')}</span>}
    </nav> : null}
  </div>;
}
