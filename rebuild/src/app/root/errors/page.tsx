import { loadRootErrorCopy } from './copy';
import { RootEmptyState } from '@/server/root/RootEmptyState';
import { RootFilters, RootFilterSelect } from '@/server/root/RootFilters';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { pageSearchParamsObject } from '@/modules/root/server/admin/http';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { listRootErrors } from '@/modules/root/server/admin/errors';
import { ResolveError } from './ResolveError';
import '../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata() { return { title: `${(await loadRootErrorCopy()).copy.title} · Root` }; }
type Search = { status?: string; source?: string; q?: string; page?: string };

export default async function RootErrorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
  const { copy, locale } = await loadRootErrorCopy();
  const params = await searchParams;
  let input: Record<string, string> = {};
  let data: Awaited<ReturnType<typeof listRootErrors>> | null = null;
  let message: string | null = null;
  try { input = pageSearchParamsObject(params, ['q', 'status', 'source', 'page']); data = await listRootErrors(actor.id, input); } catch (error) { message = error instanceof OperationError ? error.message : copy.loadFailure; }
  const pageUrl = (page: number) => `/root/errors?${new URLSearchParams({ ...input, page: String(page) })}`;
  const controls = <RootFilters title={copy.filterTitle} route="/root/errors" filters={Object.entries(params).filter(([key, value]) => key !== 'page' && typeof value === 'string' && value !== '').map(([key, value]) => ({ key, label: key === 'q' ? copy.search : key === 'status' ? copy.status : key === 'source' ? copy.source : key, value: String(value) }))}>    <form key={JSON.stringify(params)} action="/root/errors" className="root-ops__filters" method="get" role="search" aria-label={copy.filterLabel}>
      <label className="ui-field"><span>{copy.status}</span><RootFilterSelect name="status" label={copy.status} initialValue={typeof params.status === 'string' ? params.status : 'open'} options={[{ value: 'open', label: copy.open }, { value: 'resolved', label: copy.resolved }, { value: 'all', label: copy.all }]} /></label>
      <label className="ui-field"><span>{copy.source}</span><RootFilterSelect name="source" label={copy.source} initialValue={typeof params.source === 'string' ? params.source : ''} options={[{ value: '', label: copy.allSources }, ...['server', 'worker', 'browser'].map(value => ({ value, label: copy[value as 'server' | 'worker' | 'browser'] }))]} /></label>
      <label className="ui-field"><span>{copy.search}</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={typeof params.q === 'string' ? params.q : ''} /></label>
      <button className="ui-button" type="submit">{copy.filter}</button>
    </form></RootFilters>;
  return <RootFrame active="/root/errors" controls={controls}><div className="root-ops">
    <PageHeader module="root" title={copy.title} description={copy.description} />

    {!data ? <section className="root-control__notice" role="alert"><h2>{copy.unavailable}</h2><p>{message}</p><a href="/root/errors">{copy.reset}</a></section>
      : data.items.length === 0 ? <RootEmptyState route="/root/errors" title={copy.emptyTitle}>{copy.empty}</RootEmptyState>
      : <>
        <p className="root-activity__summary">{data.total} {data.total === 1 ? copy.group : copy.groups}</p>
        <DataTable caption={copy.caption} rows={data.items} rowKey={item => item.id} columns={[
          { key: 'column0', label: copy.error, render: (item) => <><a href={`/root/errors/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong></a><br />{item.message}{item.location ? <><br /><span className="root-ops__muted">{item.location}</span></> : null}</> },
          { key: 'column1', label: copy.source, render: (item) => <>{item.source === 'server' || item.source === 'worker' || item.source === 'browser' ? copy[item.source] : item.source}</> },
          { key: 'column2', label: copy.count, render: (item) => <>{item.count}</> },
          { key: 'column3', label: copy.lastSeen, render: (item) => <><time dateTime={item.lastSeenAt}>{new Date(item.lastSeenAt).toLocaleString(locale)}</time>{item.resolvedAt ? <><br />{copy.resolved}</> : null}</> },
          { key: 'column4', label: copy.action, render: (item) => <><ResolveError id={item.id} resolved={Boolean(item.resolvedAt)} copy={copy} /></> }
        ]} />
        <p className="root-directory__pager">{copy.page.replace('{page}', String(data.page)).replace('{pages}', String(Math.max(1, Math.ceil(data.total / data.pageSize))))}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>{copy.previous}</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>{copy.next}</a></>}</p>
      </>}
  </div></RootFrame>;
}
