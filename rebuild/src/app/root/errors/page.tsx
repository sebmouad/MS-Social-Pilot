import { RootEmptyState } from '@/server/root/RootEmptyState';
import { RootFilters, RootFilterSelect } from '@/server/root/RootFilters';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { pageSearchParamsObject } from '@/server/root/legacy/http';
import { RootFrame } from '@/server/root/RootFrame';
import { OperationError } from '@/lib/operation-error';
import { listRootErrors } from '@/server/root/legacy/errors';
import { ResolveError } from './ResolveError';
import '../plans/legacy-ops.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Errors · Root' };
type Search = { status?: string; source?: string; q?: string; page?: string };

export default async function RootErrorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRootPage();
  const params = await searchParams;
  let input: Record<string, string> = {};
  let data: Awaited<ReturnType<typeof listRootErrors>> | null = null;
  let message: string | null = null;
  try { input = pageSearchParamsObject(params, ['q', 'status', 'source', 'page']); data = await listRootErrors(actor.id, input); } catch (error) { message = error instanceof OperationError ? error.message : 'The error log could not be loaded. Try again.'; }
  const pageUrl = (page: number) => `/root/errors?${new URLSearchParams({ ...input, page: String(page) })}`;
  const controls = <RootFilters title="Error filters" route="/root/errors" filters={Object.entries(params).filter(([key, value]) => key !== 'page' && typeof value === 'string' && value !== '').map(([key, value]) => ({ key, label: key, value: String(value) }))}>    <form key={JSON.stringify(params)} action="/root/errors" className="root-ops__filters" method="get" role="search" aria-label="Filter errors">
      <label className="ui-field"><span>Status</span><RootFilterSelect name="status" label="Status" initialValue={typeof params.status === 'string' ? params.status : 'open'} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }]} /></label>
      <label className="ui-field"><span>Source</span><RootFilterSelect name="source" label="Source" initialValue={typeof params.source === 'string' ? params.source : ''} options={[{ value: '', label: 'All sources' }, ...['server', 'worker', 'browser'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} /></label>
      <label className="ui-field"><span>Search</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={typeof params.q === 'string' ? params.q : ''} /></label>
      <button className="ui-button" type="submit">Filter</button>
    </form></RootFilters>;
  return <RootFrame active="/root/errors" controls={controls}><div className="root-ops">
    <PageHeader module="root" title="Errors" description={<>Application errors grouped by occurrence. Messages are shortened and credential-like text is hidden. A new occurrence reopens a resolved group.</>} />

    {!data ? <section className="root-control__notice" role="alert"><h2>Errors unavailable</h2><p>{message}</p><a href="/root/errors">Reset filters</a></section>
      : data.items.length === 0 ? <RootEmptyState route="/root/errors" title="No errors">No error groups match these filters.</RootEmptyState>
      : <>
        <p className="root-activity__summary">{data.total} {data.total === 1 ? 'error group' : 'error groups'}</p>
        <DataTable caption={'Application errors'} rows={data.items} rowKey={item => item.id} columns={[
          { key: 'column0', label: 'Error', render: (item) => <><a href={`/root/errors/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong></a><br />{item.message}{item.location ? <><br /><span className="root-ops__muted">{item.location}</span></> : null}</> },
          { key: 'column1', label: 'Source', render: (item) => <>{item.source}</> },
          { key: 'column2', label: 'Count', render: (item) => <>{item.count}</> },
          { key: 'column3', label: 'Last seen', render: (item) => <><time dateTime={item.lastSeenAt}>{new Date(item.lastSeenAt).toLocaleString()}</time>{item.resolvedAt ? <><br />Resolved</> : null}</> },
          { key: 'column4', label: 'Action', render: (item) => <><ResolveError id={item.id} resolved={Boolean(item.resolvedAt)} /></> }
        ]} />
        <p className="root-directory__pager">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>Previous</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>Next</a></>}</p>
      </>}
  </div></RootFrame>;
}
