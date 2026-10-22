import { RootFilters } from './RootFilters';
import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { rootActivityUrl, type RootActivitySearch } from '@/lib/root-activity';
import type { listRootActivity } from '@/server/root/activity';
import { loadRootInterfaceCopy } from './interface-copy';

type ActivityPage = Awaited<ReturnType<typeof listRootActivity>>;
export async function RootActivityFilters({ values, page, policy }: { values: RootActivitySearch; page: ActivityPage | null; policy: { pageSize: number; searchCharacters: number } | null }) {
  const text = (key: string) => typeof values[key] === 'string' ? values[key] as string : '';
  const query = page ? { ...page.filters, limit: page.limit } : {};
  const copy = await loadRootInterfaceCopy();
  return <SidebarDock><section className="root-audit-filters" aria-label={copy.activityFiltersTitle}>
    <RootFilters title={copy.activityFiltersTitle} route="/root/activity" filters={['q', 'workspaceId', 'from', 'to'].map(key => ({ key, label: key, value: text(key) })).filter(item => item.value)}>
    {policy && <form key={JSON.stringify(values)} noValidate action="/root/activity">
      <label className="ui-field">{copy.activityActionPerson}<input className="ui-input" name="q" defaultValue={text('q')} maxLength={policy.searchCharacters} placeholder={copy.activityActionPlaceholder} /></label>
      <label className="ui-field">{copy.activityWorkspaceId}<input className="ui-input" name="workspaceId" defaultValue={text('workspaceId')} maxLength={policy.searchCharacters} placeholder={copy.activityAllWorkspaces} /></label>
      <label className="ui-field">{copy.activityFrom}<input className="ui-input" type="date" name="from" defaultValue={text('from')} /></label>
      <label className="ui-field">{copy.activityThrough}<input className="ui-input" type="date" name="to" defaultValue={text('to')} /></label>
      <label className="ui-field">{copy.activityPerPage}<input className="ui-input" type="number" min={1} max={policy.pageSize} step={1} name="limit" defaultValue={page?.limit ?? (text('limit') || policy.pageSize)} /></label>
      <Button type="submit">{copy.applyFilters}</Button>
    </form>}
    <a href="/root/activity">{copy.reset}</a>
    <nav aria-label={copy.activityPages} className="root-audit-pages">
      {page && <a href={rootActivityUrl(query)}>{copy.activityLatest}</a>}
      {page?.newerCursor && <a href={rootActivityUrl(query, page.newerCursor)}>{copy.activityNewer}</a>}
      {page?.olderCursor && <a href={rootActivityUrl(query, page.olderCursor)}>{copy.activityOlder}</a>}
    </nav>
  </RootFilters></section></SidebarDock>;
}
