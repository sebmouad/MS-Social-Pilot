"use client";
import { uiCopy, type UiLocale } from './copy';
import { useState } from 'react';
import { SidebarDock } from '@/components/SidebarDock';
import { Button, Select, FilterPanel, FilterChips, TextInput } from '@/components';
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@/modules/tasks/tasks';
import styles from './tasks.module.css';

export function TaskFilters({ values, assignees, assigneesHasMore, locale = 'en' }: { values: { status: string; assignee: string; overdue: boolean; q: string; view: string }; assignees: Array<{ id: string; name: string }>; assigneesHasMore: boolean; locale?: UiLocale }) {
  const t = uiCopy(locale);
  const [draft, setDraft] = useState(values);
  const known = new Set(['', 'me', 'none', ...assignees.map(person => person.id)]);
  const filters = [
    ...(values.q ? [{ key: 'q', label: t("Search"), value: values.q }] : []),
    ...(values.status ? [{ key: 'status', label: t("Status"), value: t(TASK_STATUS_LABELS[values.status as keyof typeof TASK_STATUS_LABELS] ?? values.status) }] : []),
    ...(values.assignee ? [{ key: 'assignee', label: t("Assigned to"), value: assignees.find(person => person.id === values.assignee)?.name ?? (values.assignee === 'me' ? t("Me") : values.assignee === 'none' ? t("Unassigned") : t("Selected member")) }] : []),
    ...(values.overdue ? [{ key: 'overdue', label: t("Due"), value: t("Overdue only") }] : []),
  ];
  function remove(key: string) { const query = new URLSearchParams(window.location.search); query.delete(key); query.delete('offset'); window.location.assign(`/tasks${query.size ? `?${query}` : ''}`); }
  return <>
    <FilterChips removeLabel={t('Remove filter')} label={t('Active filters')} filters={filters} onRemove={remove} />
    <SidebarDock><FilterPanel resetLabel={t('Reset filters')} title={t("Task filters")} activeCount={filters.length} onReset={() => window.location.assign('/tasks')}>
      <FilterChips removeLabel={t('Remove filter')} label={t('Active filters')} filters={filters} onRemove={remove} />
      <form noValidate onSubmit={event => { const input = event.currentTarget.elements.namedItem("view") as HTMLInputElement; input.value = new URLSearchParams(window.location.search).get("view") ?? draft.view; }} action="/tasks" method="get" className={styles.filters} aria-label={t("Task filters")}>
        <label>{t("Search")}<TextInput type="search" name="q" maxLength={200} value={draft.q} placeholder={t("Title or notes")} onChange={event => setDraft({ ...draft, q: event.target.value })} trailing={draft.q ? <button type="button" className="ui-icon-button" aria-label={t("Clear search")} onClick={() => setDraft({ ...draft, q: '' })}>×</button> : undefined} /></label>
        <label>{t("Status")}<Select aria-label={t("Status")} name="status" value={draft.status} onChange={status => setDraft({ ...draft, status })} options={[{ value: '', label: t("All statuses") }, ...TASK_STATUSES.map(status => ({ value: status, label: t(TASK_STATUS_LABELS[status]) }))]} /></label>
        <label>{t("Assigned to")}<Select aria-label={t("Assigned to")} name="assignee" value={draft.assignee} onChange={assignee => setDraft({ ...draft, assignee })} options={[{ value: '', label: t("Anyone") }, { value: 'me', label: t("Me") }, { value: 'none', label: t("Unassigned") }, ...(!known.has(values.assignee) ? [{ value: values.assignee, label: t("Selected member") }] : []), ...assignees.map(person => ({ value: person.id, label: person.name }))]} /></label>
        {assigneesHasMore && <p className={styles.help}>{t("Only part of the team is listed here. Use Me or Unassigned, or search by title.")}</p>}
        <label className={styles.check}><input type="checkbox" name="overdue" value="true" checked={draft.overdue} onChange={event => setDraft({ ...draft, overdue: event.target.checked })} />{t("Overdue only")}</label>
        <input type="hidden" name="view" value={draft.view} />
        <Button type="submit" variant="primary">{t("Apply filters")}</Button>
        <a href="/tasks">{t("Reset filters")}</a>
      </form>
    </FilterPanel></SidebarDock>
  </>;
}
