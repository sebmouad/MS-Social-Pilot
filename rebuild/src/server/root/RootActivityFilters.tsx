import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { rootActivityUrl, type RootActivitySearch } from '@/lib/root-activity';
import type { listRootActivity } from './activity';

type ActivityPage = Awaited<ReturnType<typeof listRootActivity>>;
export function RootActivityFilters({ values, page, policy }: { values: RootActivitySearch; page: ActivityPage | null; policy: { pageSize: number; searchCharacters: number } | null }) {
  const text = (key: string) => typeof values[key] === 'string' ? values[key] as string : '';
  const query = page ? { ...page.filters, limit: page.limit } : {};
  return <SidebarDock><section className="root-audit-filters" aria-label="Activity filters">
    <p className="shell-subnav__label">Activity filters</p>
    {policy && <form noValidate action="/root/activity">
      <label className="ui-field">Action or person<input className="ui-input" name="q" defaultValue={text('q')} maxLength={policy.searchCharacters} placeholder="Action, name or email" /></label>
      <label className="ui-field">Workspace ID<input className="ui-input" name="workspaceId" defaultValue={text('workspaceId')} maxLength={policy.searchCharacters} placeholder="All workspaces" /></label>
      <label className="ui-field">From date (UTC)<input className="ui-input" type="date" name="from" defaultValue={text('from')} /></label>
      <label className="ui-field">Through date (UTC)<input className="ui-input" type="date" name="to" defaultValue={text('to')} /></label>
      <label className="ui-field">Events per page<input className="ui-input" type="number" min={1} max={policy.pageSize} step={1} name="limit" defaultValue={page?.limit ?? (text('limit') || policy.pageSize)} /></label>
      <Button type="submit">Apply filters</Button>
    </form>}
    <a href="/root/activity">Reset filters</a>
    <nav aria-label="Activity pages" className="root-audit-pages">
      {page && <a href={rootActivityUrl(query)}>Latest matching activity</a>}
      {page?.newerCursor && <a href={rootActivityUrl(query, page.newerCursor)}>Newer activity</a>}
      {page?.olderCursor && <a href={rootActivityUrl(query, page.olderCursor)}>Older activity</a>}
    </nav>
  </section></SidebarDock>;
}
