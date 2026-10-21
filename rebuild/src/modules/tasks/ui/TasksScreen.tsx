import { loadCustomerCopy } from '../server/copy';
import { headers } from 'next/headers';
import { uiCopy, uiLocale, type CustomerCopy, type UiLocale } from './copy';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { listTasks } from '@/modules/tasks/server/tasks';
import { TASKS_FEATURE_ID, TASKS_MODULE_ID } from '@/modules/tasks/semantics';
import { TaskBoard } from './TaskBoard';
import { TaskFilters } from './TaskFilters';
import { PageHeader } from '@/components/PageHeader';
import styles from './tasks.module.css';

const KEYS = ['q', 'status', 'assignee', 'overdue', 'offset', 'view'];
const Heading = ({ description, locale, copy }: { description: string; locale: UiLocale; copy?: CustomerCopy }) => <PageHeader module="tasks" title={uiCopy(locale, copy)('Tasks')} description={description} />;

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ module: TASKS_MODULE_ID, feature: TASKS_FEATURE_ID, channelScoped: true });
  const locale = uiLocale((await headers()).get('accept-language'));
  const copy = await loadCustomerCopy();
  const t = uiCopy(locale, copy);
  const params = await searchParams;
  const bad = Object.entries(params).some(([key, value]) => !KEYS.includes(key) || typeof value !== 'string') || (params.offset && !/^\d+$/.test(String(params.offset))) || (params.overdue && params.overdue !== 'true') || (params.view && params.view !== 'table' && params.view !== 'board');
  if (bad) return <div className={styles.root} data-module="tasks"><Heading locale={locale} copy={copy} description={t("Review your task filters.")} /><RouteNotice error focusKey="tasks-filter-error">{t("Choose valid task filters and try again.")}</RouteNotice><a href="/tasks">{t("Reset filters")}</a></div>;
  const filters = {
    q: String(params.q ?? ''), status: String(params.status ?? ''), assignee: String(params.assignee ?? ''), overdue: params.overdue === 'true', offset: Number(params.offset ?? 0),
    view: params.view === 'board' ? 'board' : 'table',
  };
  let result;
  try {
    result = await listTasks({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, {
      ...(filters.q ? { q: filters.q } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.assignee ? { assignee: filters.assignee } : {}),
      ...(filters.overdue ? { overdue: true } : {}), offset: filters.offset,
    });
  } catch (error) {
    return <div className={styles.root} data-module="tasks"><Heading locale={locale} copy={copy} description={t("Assign work, set due dates and follow progress.")} /><RouteNotice error focusKey="tasks-load-error">{error instanceof OperationError ? t(error.message) : t("Tasks could not be loaded. Refresh and try again.")}</RouteNotice></div>;
  }
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'offset'));
  const pageHref = (offset: number) => { const next = new URLSearchParams(query); if (offset > 0) next.set('offset', String(offset)); return `/tasks${next.size ? `?${next}` : ''}`; };
  const filtered = Boolean(filters.q || filters.status || filters.assignee || filters.overdue);
  return <div className={styles.root} data-module="tasks">
    <Heading locale={locale} copy={copy} description={t("Assign work, set due dates and follow progress for this workspace.")} />
    <TaskFilters key={JSON.stringify(filters)} locale={locale} copy={copy} values={filters} assignees={result.assignees} assigneesHasMore={result.assigneesHasMore} />
    <TaskBoard locale={locale} copy={copy} key={`${viewer.workspaceId}:${filters.offset}:${filters.view}`} tasks={result.tasks} assignees={result.assignees} canCreate={result.canCreate} limits={result.limits} today={result.today} summary={result.summary} view={filters.view as 'table' | 'board'} filtered={filtered} />
    {(filters.offset > 0 || result.hasMore) && <nav className={styles.pagination} aria-label={t("Task pages")}>
      {filters.offset > 0 ? <a href={pageHref(Math.max(0, filters.offset - result.pageSize))}>{t("Previous tasks")}</a> : <span />}
      {result.hasMore ? <a href={pageHref(filters.offset + result.pageSize)}>{t("Next tasks")}</a> : <span />}
    </nav>}
  </div>;
}
