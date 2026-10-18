import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@/modules/tasks/tasks';
import styles from './tasks.module.css';

/** Filters live in the shell sidebar (or its phone drawer) and submit as plain GET navigation. */
export function TaskFilters({ values, assignees, assigneesHasMore }: { values: { status: string; assignee: string; overdue: boolean; q: string; view: string }; assignees: Array<{ id: string; name: string }>; assigneesHasMore: boolean }) {
  // A filter that names a member beyond the bounded list must stay selectable, otherwise Apply would silently drop it.
  const known = new Set(['', 'me', 'none', ...assignees.map(person => person.id)]);
  return <SidebarDock>
    <form action="/tasks" method="get" className={styles.filters} aria-label="Task filters">
      <label>Search<input type="search" name="q" maxLength={200} defaultValue={values.q} placeholder="Title or notes" /></label>
      <label>Status<select name="status" defaultValue={values.status}><option value="">All statuses</option>{TASK_STATUSES.map(status => <option key={status} value={status}>{TASK_STATUS_LABELS[status]}</option>)}</select></label>
      <label>Assigned to<select name="assignee" defaultValue={values.assignee}><option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option>{!known.has(values.assignee) && <option value={values.assignee}>Selected member</option>}{assignees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      {assigneesHasMore && <p className={styles.help}>Only part of the team is listed here. Use Me or Unassigned, or search by title.</p>}
      <label className={styles.check}><input type="checkbox" name="overdue" value="true" defaultChecked={values.overdue} />Overdue only</label>
      <label>Layout<select name="view" defaultValue={values.view}><option value="table">Table</option><option value="board">Board</option></select></label>
      <Button type="submit" variant="primary">Apply filters</Button>
      <a href="/tasks">Reset filters</a>
    </form>
  </SidebarDock>;
}
