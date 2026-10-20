"use client";
import { useState } from 'react';
import { SidebarDock } from '@/components/SidebarDock';
import { Button, Select, FilterPanel, FilterChips, TextInput } from '@/components';
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@/modules/tasks/tasks';
import styles from './tasks.module.css';

export function TaskFilters({ values, assignees, assigneesHasMore }: { values: { status: string; assignee: string; overdue: boolean; q: string; view: string }; assignees: Array<{ id: string; name: string }>; assigneesHasMore: boolean }) {
  const [draft, setDraft] = useState(values);
  const known = new Set(['', 'me', 'none', ...assignees.map(person => person.id)]);
  const filters = [
    ...(values.q ? [{ key: 'q', label: 'Search', value: values.q }] : []),
    ...(values.status ? [{ key: 'status', label: 'Status', value: TASK_STATUS_LABELS[values.status as keyof typeof TASK_STATUS_LABELS] ?? values.status }] : []),
    ...(values.assignee ? [{ key: 'assignee', label: 'Assigned to', value: assignees.find(person => person.id === values.assignee)?.name ?? (values.assignee === 'me' ? 'Me' : values.assignee === 'none' ? 'Unassigned' : 'Selected member') }] : []),
    ...(values.overdue ? [{ key: 'overdue', label: 'Due', value: 'Overdue only' }] : []),
  ];
  function remove(key: string) { const query = new URLSearchParams(window.location.search); query.delete(key); query.delete('offset'); window.location.assign(`/tasks${query.size ? `?${query}` : ''}`); }
  return <>
    <FilterChips filters={filters} onRemove={remove} />
    <SidebarDock><FilterPanel title="Task filters" activeCount={filters.length} onReset={() => window.location.assign('/tasks')}>
      <FilterChips filters={filters} onRemove={remove} />
      <form noValidate onSubmit={event => { const input = event.currentTarget.elements.namedItem("view") as HTMLInputElement; input.value = new URLSearchParams(window.location.search).get("view") ?? draft.view; }} action="/tasks" method="get" className={styles.filters} aria-label="Task filters">
        <label>Search<TextInput type="search" name="q" maxLength={200} value={draft.q} placeholder="Title or notes" onChange={event => setDraft({ ...draft, q: event.target.value })} trailing={draft.q ? <button type="button" className="ui-icon-button" aria-label="Clear search" onClick={() => setDraft({ ...draft, q: '' })}>×</button> : undefined} /></label>
        <label>Status<Select aria-label="Status" name="status" value={draft.status} onChange={status => setDraft({ ...draft, status })} options={[{ value: '', label: 'All statuses' }, ...TASK_STATUSES.map(status => ({ value: status, label: TASK_STATUS_LABELS[status] }))]} /></label>
        <label>Assigned to<Select aria-label="Assigned to" name="assignee" value={draft.assignee} onChange={assignee => setDraft({ ...draft, assignee })} options={[{ value: '', label: 'Anyone' }, { value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...(!known.has(values.assignee) ? [{ value: values.assignee, label: 'Selected member' }] : []), ...assignees.map(person => ({ value: person.id, label: person.name }))]} /></label>
        {assigneesHasMore && <p className={styles.help}>Only part of the team is listed here. Use Me or Unassigned, or search by title.</p>}
        <label className={styles.check}><input type="checkbox" name="overdue" value="true" checked={draft.overdue} onChange={event => setDraft({ ...draft, overdue: event.target.checked })} />Overdue only</label>
        <input type="hidden" name="view" value={draft.view} />
        <Button type="submit" variant="primary">Apply filters</Button>
        <a href="/tasks">Reset filters</a>
      </form>
    </FilterPanel></SidebarDock>
  </>;
}
