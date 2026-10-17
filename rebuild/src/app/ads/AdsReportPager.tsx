import type { AdsFilters } from '@/server/ads/queries';
import type { AdsPageSlice } from '@/modules/ads/report-page';
import { adsQuery } from './ads-filters';

export function AdsReportPager<T>({ filters, path, kind, page }: { filters: AdsFilters; path: string; kind: 'accounts' | 'objects'; page: AdsPageSlice<T> }) {
  const href = (pageNumber: number) => {
    const [pathname, query = ''] = adsQuery(filters, path).split('?', 2);
    const params = new URLSearchParams(query);
    params.set('page', String(pageNumber));
    return `${pathname}?${params.toString()}`;
  };
  return <div className="ads-report-pager">
    <p className="small-note" aria-live="polite">Showing {page.from}–{page.to} of {page.resultCount} {kind}</p>
    <p className="ads-report-pager__current"><span aria-current="page" aria-label={`Page ${page.page} of ${page.pageCount}`}>Page {page.page} of {page.pageCount}</span></p>
    {page.pageCount > 1 ? <nav className="ads-report-pager__nav" aria-label={`${kind === 'accounts' ? 'Account' : 'Object'} report pages`}>
      {page.page > 1 ? <a className="ui-button ui-button--secondary ui-button--md" rel="prev" href={href(page.page - 1)}>Previous page</a> : <span className="ui-button ui-button--secondary ui-button--md" aria-disabled="true">Previous page</span>}
      {page.page < page.pageCount ? <a className="ui-button ui-button--secondary ui-button--md" rel="next" href={href(page.page + 1)}>Next page</a> : <span className="ui-button ui-button--secondary ui-button--md" aria-disabled="true">Next page</span>}
    </nav> : null}
  </div>;
}
