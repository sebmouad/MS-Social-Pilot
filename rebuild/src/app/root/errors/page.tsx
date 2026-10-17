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
  const controls = <section className="root-ops-sidebar" aria-label="Error filters">    <form action="/root/errors" className="root-ops__filters" method="get" role="search" aria-label="Filter errors">
      <label className="ui-field"><span>Status</span><select className="ui-input" name="status" defaultValue={typeof params.status === 'string' ? params.status : 'open'}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
      <label className="ui-field"><span>Source</span><select className="ui-input" name="source" defaultValue={typeof params.source === 'string' ? params.source : ''}><option value="">All sources</option><option value="server">Server</option><option value="worker">Worker</option><option value="browser">Browser</option></select></label>
      <label className="ui-field"><span>Search</span><input className="ui-input" name="q" maxLength={data?.limits.searchMaxCharacters} defaultValue={typeof params.q === 'string' ? params.q : ''} /></label>
      <button className="ui-button" type="submit">Filter</button>
    </form></section>;
  return <RootFrame active="/root/errors" controls={controls}><div className="root-ops">
    <header className="root-control__heading">
      <p className="root-config__eyebrow">Root · Shared controls</p>
      <h1>Errors</h1>
      <p>Application errors grouped by occurrence. Messages are shortened and credential-like text is hidden. A new occurrence reopens a resolved group.</p>
    </header>

    {!data ? <section className="root-control__notice" role="alert"><h2>Errors unavailable</h2><p>{message}</p><a href="/root/errors">Reset filters</a></section>
      : data.items.length === 0 ? <section className="root-control__panel"><h2>No errors</h2><p>No error groups match these filters.</p></section>
      : <>
        <p className="root-activity__summary">{data.total} {data.total === 1 ? 'error group' : 'error groups'}</p>
        <div className="root-ops__table" role="region" aria-label="Error log" tabIndex={0}><table>
          <caption className="ui-visually-hidden">Application errors</caption>
          <thead><tr><th scope="col">Error</th><th scope="col">Source</th><th scope="col">Count</th><th scope="col">Last seen</th><th scope="col">Action</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}>
            <td><a href={`/root/errors/${encodeURIComponent(item.id)}`}><strong>{item.name}</strong></a><br />{item.message}{item.location ? <><br /><span className="root-ops__muted">{item.location}</span></> : null}</td>
            <td>{item.source}</td><td>{item.count}</td><td><time dateTime={item.lastSeenAt}>{new Date(item.lastSeenAt).toLocaleString()}</time>{item.resolvedAt ? <><br />Resolved</> : null}</td>
            <td><ResolveError id={item.id} resolved={Boolean(item.resolvedAt)} /></td>
          </tr>)}</tbody>
        </table></div>
        <p className="root-directory__pager">Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
          {data.page > 1 && <> · <a href={pageUrl(data.page - 1)}>Previous</a></>}{data.page * data.pageSize < data.total && <> · <a href={pageUrl(data.page + 1)}>Next</a></>}</p>
      </>}
  </div></RootFrame>;
}
