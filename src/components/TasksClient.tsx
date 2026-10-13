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

  const shown = tasks.filter((task) => !mine || task.assigneeId === myId);

  return (
    <div className="space-y-4">
      {canEdit && (
        <form
          className="card flex flex-wrap items-end gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) void add();
          }}
        >
          <div className="min-w-0 flex-1 basis-56">
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
          <button type="submit" className="btn-primary" disabled={!title.trim()}>
            <Icon name="plus" size={16} /> {t('add')}
          </button>
        </form>
      )}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
          {t('onlyMine')}
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{tCommon('genericError')}</p>}
      </div>
      {tasks.length === 0 ? (
        <EmptyState icon="approvals" title={t('emptyTitle')} hint={t('emptyHint')} />
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
