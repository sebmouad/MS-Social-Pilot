import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { AGENCY_SORTS } from '@/modules/agency/agency';
import styles from './agency.module.css';

export const AGENCY_SORT_LABELS: Record<(typeof AGENCY_SORTS)[number], string> = {
  name: 'Workspace name', channels: 'Channels', attention: 'Needs attention', scheduled: 'Scheduled posts', failed: 'Failed posts',
  openTasks: 'Open tasks', overdueTasks: 'Overdue tasks', members: 'Team members',
};

/**
 * Overview filters live in the shell sidebar (or phone drawer) and submit as plain GET navigation. `searchLimit`
 * is the Root-managed search length the service enforces. Name search runs on the server before the workspace cap.
 */
export function AgencyFilters({ values, searchLimit }: { values: { q: string; sort: string; order: string; attention: boolean }; searchLimit: number }) {
  return <SidebarDock>
    <form action="/agency" method="get" className={styles.filters} aria-label="Workspace filters">
      <label>Search<input type="search" name="q" maxLength={searchLimit} defaultValue={values.q} placeholder="Workspace name" /></label>
      <label>Sort by<select name="sort" defaultValue={values.sort}>{AGENCY_SORTS.map(sort => <option key={sort} value={sort}>{AGENCY_SORT_LABELS[sort]}</option>)}</select></label>
      <label>Order<select name="order" defaultValue={values.order}><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
      <label className={styles.check}><input type="checkbox" name="attention" value="true" defaultChecked={values.attention} />Needs attention only</label>
      <Button type="submit" variant="primary">Apply filters</Button>
      <a href="/agency">Reset filters</a>
    </form>
  </SidebarDock>;
}

export function ClientFilters({ q, searchLimit }: { q: string; searchLimit: number }) {
  return <SidebarDock>
    <form action="/agency/clients" method="get" className={styles.filters} aria-label="Client filters">
      <label>Search<input type="search" name="q" maxLength={searchLimit} defaultValue={q} placeholder="Workspace name" /></label>
      <Button type="submit" variant="primary">Apply filters</Button>
      <a href="/agency/clients">Reset filters</a>
    </form>
  </SidebarDock>;
}
