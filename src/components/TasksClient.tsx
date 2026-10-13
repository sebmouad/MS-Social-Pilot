'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '@/lib/client-request';
import { makeWorkflow, runWorkflow, type WorkflowRow } from '@/lib/task-workflow';
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
  const titleInput = useRef<HTMLInputElement>(null);
  const workflowInput = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addLock = useRef(false);
  const workflowLock = useRef(false);
  const [workflowRows, setWorkflowRows] = useState<WorkflowRow[] | null>(null);
  const [steps, setSteps] = useState('');
  const [start, setStart] = useState('');
  const [gap, setGap] = useState(1);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    // Adopt text typed or autofilled before React attached its input handlers.
    if (titleInput.current?.value) setTitle(titleInput.current.value);
    if (workflowInput.current?.value) setSteps(workflowInput.current.value);
  }, []);
  const names = new Map(members.map((member) => [member.id, member.name]));

  async function call(path: string, method: string, body?: unknown) {
    setError(null);
    const result = await requestJson<{ id?: string }>(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!result.ok) {
      setError(result.error ?? (result.kind !== 'http' ? t('createUncertain') : tCommon('genericError')));
      return false;
    }
    if (method === 'POST' && !result.data?.id) { setError(t('createUncertain')); return false; }
    router.refresh();
    return true;
  }

  async function add() {
    if (addLock.current || workflowLock.current) return;
    addLock.current = true;
    setAdding(true);
    try {
      if (await call('/api/tasks', 'POST', { title, assigneeId: assignee || null, dueOn: due || null })) {
        setTitle(''); setDue('');
      }
    } finally { addLock.current = false; setAdding(false); }
  }

  async function startWorkflow() {
    if (workflowLock.current || addLock.current) return;
    let rows: WorkflowRow[];
    try { rows = workflowRows ?? makeWorkflow(steps, start, gap, assignee); }
    catch (error) { setError(t(error instanceof Error && error.message === 'rows' ? 'workflowRowLimit' : 'workflowTitleLimit')); return; }
    workflowLock.current = true;
    setRunning(true); setError(null);
    try {
      const result = await runWorkflow(rows, async (row) => {
        const response = await requestJson<{ id?: string }>('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: row.title, assigneeId: row.assigneeId, dueOn: row.dueOn }) });
        if (!response.ok) { setError(response.error ?? (response.kind !== 'http' ? t('createUncertain') : tCommon('genericError'))); return response.kind !== 'http' ? 'uncertain' : false; }
        if (!response.data?.id) { setError(t('createUncertain')); return 'uncertain'; }
        return true;
      }, setWorkflowRows);
      setWorkflowRows(result);
      setSteps(result.filter(row => row.state !== 'created').map(row => row.title).join('\n'));
      router.refresh();
    } finally { workflowLock.current = false; setRunning(false); }
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
            <input ref={titleInput} id="task-title" className="input" disabled={adding} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={t('placeholder')} />
          </div>
          <div>
            <label className="label" htmlFor="task-assignee">{t('assignee')}</label>
            <select id="task-assignee" disabled={adding || running} className="input" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">{t('nobody')}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="task-due">{t('due')}</label>
            <input id="task-due" type="date" disabled={adding} className="input" value={due} onChange={(event) => setDue(event.target.value)} />
          </div>
          <button type="submit" className="btn-primary col-span-2 sm:col-auto" disabled={adding || running || !title.trim()}>
            <Icon name="plus" size={16} /> {adding ? tCommon('working') : t('add')}
          </button>
        </form>
      )}
      {canEdit && (
        <details className="card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">{t('workflowTitle')}</summary>
          <div className="mt-3 space-y-2">
            <p className="hint">{t('workflowHint')}</p>
            <textarea ref={workflowInput} aria-label={t('workflowSteps')} className="input" rows={4} disabled={running || !!workflowRows} value={steps} placeholder={t('workflowPlaceholder')} onChange={(event) => setSteps(event.target.value)} />
            <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
              <div>
                <label className="label" htmlFor="workflow-start">{t('workflowStart')}</label>
                <input id="workflow-start" type="date" className="input" disabled={running || !!workflowRows} value={start} onChange={(event) => setStart(event.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="workflow-gap">{t('workflowGap')}</label>
                <input id="workflow-gap" type="number" min={0} max={30} className="input" disabled={running || !!workflowRows} value={gap} onChange={(event) => setGap(Math.max(0, Math.min(30, Number(event.target.value) || 0)))} />
              </div>
              <button type="button" className="btn-secondary col-span-2 sm:col-auto" disabled={running || adding || !steps.trim() || (!!workflowRows && !workflowRows.some(row => row.state === 'failed' || row.state === 'unattempted'))} onClick={() => void startWorkflow()}>
                {running ? tCommon('working') : workflowRows ? t('workflowRetry') : t('workflowStartButton')}
              </button>
            </div>
            {workflowRows && <><ul className="space-y-1 text-sm" aria-live="polite">{workflowRows.map((row, index) => <li key={index}>{row.title} — {t(`workflow_${row.state}`)}</li>)}</ul>
              <button className="btn-secondary" type="button" disabled={running} onClick={() => { setSteps(workflowRows.filter(row => row.state === 'failed' || row.state === 'unattempted').map(row => row.title).join('\n')); setWorkflowRows(null); }}>{t('workflowEditRemaining')}</button></>}
          </div>
        </details>
      )}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
          {t('onlyMine')}
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
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
