'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { EmptyState } from './EmptyState';
import { Icon } from './Icon';

type Status = 'todo' | 'doing' | 'done';
interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  status: Status;
  assigneeId: string | null;
  dueOn: string | null;
}

const COLUMNS: Status[] = ['todo', 'doing', 'done'];

/** The to-do board: three columns, a task moves along with one click. */
export function TasksClient({ tasks, members, myId, canEdit }: { tasks: TaskRow[]; members: Array<{ id: string; name: string }>; myId: string; canEdit: boolean }) {
  const t = useTranslations('tasks');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [mine, setMine] = useState(false);
  const [error, setError] = useState(false);
  const [steps, setSteps] = useState('');
  const [start, setStart] = useState('');
  const [gap, setGap] = useState(1);
  const [running, setRunning] = useState(false);
  const names = new Map(members.map((member) => [member.id, member.name]));

  async function call(path: string, method: string, body?: unknown) {
    setError(false);
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!response?.ok) {
      setError(true);
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    const done = await call('/api/tasks', 'POST', { title, assigneeId: assignee || null, dueOn: due || null });
    if (done) {
      setTitle('');
      setDue('');
    }
  }

  /**
   * A workflow: one task per line, in order, each due `gap` days after the one
   * before (from the start day, when there is one), all for the same person.
   */
  async function startWorkflow() {
    const lines = steps.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 30);
    setRunning(true);
    setError(false);
    for (const [index, line] of lines.entries()) {
      const dueOn = start ? new Date(Date.parse(`${start}T00:00:00Z`) + index * gap * 86_400_000).toISOString().slice(0, 10) : null;
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: line.slice(0, 200), assigneeId: assignee || null, dueOn }),
      }).catch(() => null);
      if (!response?.ok) {
        setError(true);
        break;
      }
    }
    setRunning(false);
    setSteps('');
    router.refresh();
  }

  const shown = tasks.filter((task) => !mine || task.assigneeId === myId);

  return (
    <div className="space-y-4">
      {canEdit && (
        <form
          className="card grid grid-cols-2 items-end gap-2 p-3 sm:flex sm:flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) void add();
          }}
        >
          <div className="col-span-2 min-w-0 flex-1 sm:basis-56">
            <label className="label" htmlFor="task-title">{t('newTask')}</label>
            <input id="task-title" className="input" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={t('placeholder')} />
          </div>
          <div>
            <label className="label" htmlFor="task-assignee">{t('assignee')}</label>
            <select id="task-assignee" className="input" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">{t('nobody')}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="task-due">{t('due')}</label>
            <input id="task-due" type="date" className="input" value={due} onChange={(event) => setDue(event.target.value)} />
          </div>
          <button type="submit" className="btn-primary col-span-2 sm:col-auto" disabled={!title.trim()}>
            <Icon name="plus" size={16} /> {t('add')}
          </button>
        </form>
      )}
      {canEdit && (
        <details className="card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('workflowTitle')}</summary>
          <div className="mt-3 space-y-2">
            <p className="hint">{t('workflowHint')}</p>
            <textarea aria-label={t('workflowSteps')} className="input" rows={4} value={steps} placeholder={t('workflowPlaceholder')} onChange={(event) => setSteps(event.target.value)} />
            <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
              <div>
                <label className="label" htmlFor="workflow-start">{t('workflowStart')}</label>
                <input id="workflow-start" type="date" className="input" value={start} onChange={(event) => setStart(event.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="workflow-gap">{t('workflowGap')}</label>
                <input id="workflow-gap" type="number" min={0} max={30} className="input" value={gap} onChange={(event) => setGap(Math.max(0, Math.min(30, Number(event.target.value) || 0)))} />
              </div>
              <button type="button" className="btn-secondary col-span-2 sm:col-auto" disabled={running || !steps.trim()} onClick={() => void startWorkflow()}>
                {running ? tCommon('working') : t('workflowStartButton')}
              </button>
            </div>
          </div>
        </details>
      )}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
          {t('onlyMine')}
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{tCommon('genericError')}</p>}
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon="check" title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((status) => {
            const column = shown.filter((task) => task.status === status);
            return (
              <section key={status} aria-label={t(`status_${status}`)} className="space-y-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {t(`status_${status}`)} <span className="nums text-slate-500">{column.length}</span>
                </h2>
                <ul className="space-y-2">
                  {column.map((task) => (
                    <li key={task.id} className="card space-y-1.5 p-3">
                      <p className={`text-sm font-medium ${status === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{task.title}</p>
                      <p className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                        {task.assigneeId && <span>{names.get(task.assigneeId) ?? ''}</span>}
                        {task.dueOn && <span className="nums">{task.dueOn}</span>}
                      </p>
                      {canEdit && (
                        <div className="flex flex-wrap gap-1.5">
                          {COLUMNS.filter((next) => next !== status).map((next) => (
                            <button key={next} type="button" className="btn-secondary h-8 px-2 text-xs" onClick={() => void call(`/api/tasks/${task.id}`, 'PATCH', { status: next })}>
                              {t(`moveTo_${next}`)}
                            </button>
                          ))}
                          <button type="button" className="btn-secondary h-8 px-2 text-xs" aria-label={t('delete')} onClick={() => void call(`/api/tasks/${task.id}`, 'DELETE')}>
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
