'use client';
import { uiCopy, type UiLocale } from './copy';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AutoTextarea } from '@/components/AutoTextarea';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { SidebarDock } from '@/components/SidebarDock';
import { Badge, DataTable, SegmentedControl, InlineEdit, ConfirmDialog, EmptyState, Select, Avatar, useToast } from '@/components';
import { IconGripVertical, IconChecklist, IconLayoutKanban, IconList } from '@tabler/icons-react';
import { RouteNotice } from '@/components/RouteNotice';
import { TASK_STATUSES, TASK_STATUS_LABELS, TASK_TRANSITIONS, taskConfirmations, type TaskCommentView, type TaskLimits, type TaskPostChoice, type TaskStatus, type TaskSummary, type TaskView } from '@/modules/tasks/tasks';
import styles from './tasks.module.css';

type Person = { id: string; name: string };
type Mode = { kind: 'form'; task: TaskView | null } | { kind: 'delete'; task: TaskView } | { kind: 'detail'; task: TaskView } | { kind: 'checklist' } | null;

export function TaskBoard({ tasks, assignees, canCreate, limits, today, summary, view, filtered, locale = 'en' }: { tasks: TaskView[]; assignees: Person[]; canCreate: boolean; limits: TaskLimits; today: string; summary: TaskSummary; view: 'table' | 'board'; filtered: boolean; locale?: UiLocale }) {
  const t = uiCopy(locale);
  const UNKNOWN = t("The result is unknown. Refresh the list and check the task before trying again.");
  const message = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : t("The change could not be confirmed. Refresh the list and check the task before trying again.");
  const day = (value: string) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed) : value; };
  const verb = (status: TaskStatus) => status === 'todo' ? t("Reopen") : status === 'doing' ? t("Start") : t("Mark done");

  const router = useRouter();
  const toast = useToast();
  const [layout, setLayout] = useState(view);
  const dragged = useRef<string | null>(null);
  const [dropStatus, setDropStatus] = useState<TaskStatus | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState({ title: '', notes: '', assigneeId: '', dueOn: '' });
  /** undefined: leave the link as it is; null: remove it; string: link this post. */
  const [postChange, setPostChange] = useState<string | null | undefined>(undefined);
  const [postLabel, setPostLabel] = useState('');
  const [postSearch, setPostSearch] = useState('');
  const [postChoices, setPostChoices] = useState<{ posts: TaskPostChoice[]; hasMore: boolean; offset: number; available: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [checklist, setChecklist] = useState({ lines: '', assigneeId: '', startOn: '', gapDays: '1' });

  const [deletingComment, setDeletingComment] = useState<{ task: TaskView; comment: TaskCommentView } | null>(null);
  const [comments, setComments] = useState<{ items: TaskCommentView[]; hasMore: boolean; canComment: boolean } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const [formError, setFormError] = useState('');
  const inFlight = useRef(false);
  const say = (text: string, error = false) => { setNotice(current => ({ error, text, key: (current?.key ?? 0) + 1 })); if (error) toast.failed(text, () => router.refresh(), t("Refresh tasks")); else toast.notify({ title: text }); };

  async function send(body: Record<string, unknown>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.ok !== true) { setFormError(message(result)); say(message(result), true); return false; }
      return true;
    } catch { setFormError(UNKNOWN); say(UNKNOWN, true); return false; }
    finally { setBusy(false); inFlight.current = false; }
  }

  function openForm(task: TaskView | null) {
    setDraft({ title: task?.title ?? '', notes: task?.notes ?? '', assigneeId: task?.assignee?.id ?? '', dueOn: task?.dueOn ?? '' });
    setPostChange(undefined); setPostLabel(task?.post ? task.post.preview || t("Untitled post") : ''); setPostSearch(''); setPostChoices(null);
    setFormError(''); setNotice(null); setMode({ kind: 'form', task });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) { setFormError(t("Enter a task title.")); return; }
    if (mode?.kind !== 'form') return;
    const fields = { title: draft.title.trim(), notes: draft.notes.trim() || null, assigneeId: draft.assigneeId || null, dueOn: draft.dueOn || null, ...(postChange === undefined ? {} : { postId: postChange }) };
    if (await send(mode.task ? { action: 'task.update', confirmation: taskConfirmations.update(mode.task.id), id: mode.task.id, expectedUpdatedAt: mode.task.updatedAt, ...fields } : { action: 'task.create', confirmation: taskConfirmations.create(fields.title), ...fields })) {
      setMode(null); say(mode.task ? t("Task updated.") : t("Task created.")); router.refresh();
    }
  }
  async function findPosts(offset = 0) {
    if (searching) return;
    setSearching(true); setFormError('');
    try {
      const response = await fetch(`/api/tasks/posts?${new URLSearchParams({ ...(postSearch.trim() ? { q: postSearch.trim() } : {}), offset: String(offset) })}`, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !Array.isArray(body.posts)) { setFormError(message(body)); return; }
      setPostChoices({ posts: body.posts, hasMore: Boolean(body.hasMore), offset, available: body.available !== false });
    } catch { setFormError(t("Posts could not be loaded. Check your connection and try again.")); }
    finally { setSearching(false); }
  }
  async function saveChecklist(event: React.FormEvent) {
    event.preventDefault();
    const titles = checklist.lines.split('\n').map(line => line.trim()).filter(Boolean);
    if (!titles.length) { setFormError(t("Enter at least one task, one per line.")); return; }
    if (titles.length > limits.workflowRowLimit) { setFormError(t("A checklist can have at most {0} tasks. Remove {1} and try again.", limits.workflowRowLimit, titles.length - limits.workflowRowLimit)); return; }
    const tooLong = titles.findIndex(title => title.length > limits.titleMaxCharacters);
    if (tooLong >= 0) { setFormError(t("Line {0} is longer than {1} characters.", tooLong + 1, limits.titleMaxCharacters)); return; }
    const gap = Number(checklist.gapDays || 0);
    if (!Number.isInteger(gap) || gap < 0 || gap > limits.workflowGapMaxDays) { setFormError(t("Days between due dates must be a whole number from 0 to {0}.", limits.workflowGapMaxDays)); return; }
    if (await send({ action: 'task.createMany', confirmation: taskConfirmations.createMany(titles.length), titles, assigneeId: checklist.assigneeId || null, startOn: checklist.startOn || null, gapDays: gap })) {
      setMode(null); say(t('{0} tasks created.', titles.length)); router.refresh();
    }
  }
  async function move(task: TaskView, status: TaskStatus) {
    setNotice(null);
    if (await send({ action: 'task.transition', confirmation: taskConfirmations.transition(task.id, status), id: task.id, status })) { say(t('Moved to {0}.', t(TASK_STATUS_LABELS[status]))); router.refresh(); }
  }
  async function remove(task: TaskView) {
    if (await send({ action: 'task.delete', id: task.id, confirmation: taskConfirmations.delete(task.id) })) { setMode(null); say(t("Task deleted.")); router.refresh(); return null; }
    return UNKNOWN;
  }
  async function loadComments(task: TaskView, offset: number) {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}${offset ? `?commentOffset=${offset}` : ''}`, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !Array.isArray(body.comments)) { setFormError(message(body)); return false; }
      setComments(current => ({ items: offset && current ? [...current.items, ...body.comments] : body.comments, hasMore: Boolean(body.commentsHasMore), canComment: body.canComment === true }));
      return true;
    } catch { setFormError(t("Comments could not be loaded. Close this window and try again.")); return false; }
  }
  function openDetail(task: TaskView) {
    setComments(null); setCommentDraft(''); setFormError(''); setNotice(null); setMode({ kind: 'detail', task });
    void loadComments(task, 0);
  }
  async function addComment(task: TaskView) {
    if (!commentDraft.trim()) { setFormError(t("Enter a comment.")); return; }
    setFormError('');
    if (await send({ action: 'comment.add', confirmation: taskConfirmations.comment(task.id), taskId: task.id, body: commentDraft.trim() })) { setCommentDraft(''); if (!(await loadComments(task, 0))) setFormError(t("The comment was saved, but the list could not be refreshed.")); router.refresh(); }
  }
  async function removeComment(task: TaskView, comment: TaskCommentView) {
    setFormError('');
    if (await send({ action: 'comment.delete', id: comment.id, confirmation: taskConfirmations.deleteComment(comment.id) })) { await loadComments(task, 0); say(t("Comment deleted.")); router.refresh(); return null; }
    return UNKNOWN;
  }

  const close = () => { if (!busy) setMode(null); };
  const dueCell = (task: TaskView) => task.dueOn ? <Badge tone={task.status === 'done' ? 'neutral' : task.overdue ? 'danger' : task.dueOn === today ? 'warning' : 'neutral'}>{day(task.dueOn)}{task.overdue ? t(" (overdue)") : task.status !== 'done' && task.dueOn === today ? t(" (today)") : ''}</Badge> : <span className={styles.meta}>{t("No date")}</span>;
  const taskTitle = (task: TaskView) => <InlineEdit value={task.title} label={task.title} editLabel={t('Edit')} saveLabel={t('Save')} cancelLabel={t('Cancel')} failureLabel={UNKNOWN} disabled={busy || !task.canEdit} maxLength={limits.titleMaxCharacters} onSave={async title => {
    if (!title.trim()) return t("Enter a task title.");
    if (!(await send({ action: 'task.update', id: task.id, title: title.trim(), expectedUpdatedAt: task.updatedAt, confirmation: taskConfirmations.update(task.id) }))) return UNKNOWN;
    say(t("Task updated.")); router.refresh(); return null;
  }} />;
  const assignee = (task: TaskView) => <span className={styles.assignee}><Avatar name={task.assignee?.name ?? t("Unassigned")} size="sm" decorative />{task.assignee?.name ?? t("Unassigned")}</span>;
  const postNote = (task: TaskView) => task.post ? <details className={styles.postPreview}><summary>{t("Linked post")}</summary><p>{task.post.preview || t("Untitled post")}</p><Badge>{t(task.post.status.replaceAll('_', ' '))}</Badge></details> : task.postHidden ? <span className={styles.meta}>{t("Linked post is not available to you.")}</span> : null;
  const rowActions = (task: TaskView) => <div className={styles.actions}>
    {task.canEdit && TASK_TRANSITIONS[task.status].map(status => <Button key={status} size="sm" disabled={busy} onClick={() => move(task, status)}>{verb(status)}</Button>)}
    <Button size="sm" variant="quiet" onClick={() => openDetail(task)}>{t("Details")}{task.commentCount ? ` (${task.commentCount})` : ''}</Button>
    {task.canEdit && <Button size="sm" variant="quiet" onClick={() => openForm(task)}>{t("Edit")}</Button>}
    {task.canDelete && <Button size="sm" variant="danger" onClick={() => { setFormError(''); setMode({ kind: 'delete', task }); }}>{t("Delete")}</Button>}
  </div>;

  return <>
    <SidebarDock><SegmentedControl legend={t('Task layout')} value={layout} options={[
      { value: 'board', label: t('Board'), icon: <IconLayoutKanban size={18} /> },
      { value: 'table', label: t('List'), icon: <IconList size={18} /> },
    ]} onChange={value => {
      if (value !== 'board' && value !== 'table') return;
      setLayout(value); const url = new URL(window.location.href); url.searchParams.set('view', value);
      window.history.replaceState(window.history.state, '', url);
    }} /></SidebarDock>
    {deletingComment && <ConfirmDialog open title={t("Delete comment")} objectName={deletingComment.comment.body} consequence={t("This comment is permanently removed from the task.")} confirmLabel={t("Delete comment")} cancelLabel={t("Cancel")} failureLabel={UNKNOWN} onClose={() => setDeletingComment(null)} onConfirm={() => removeComment(deletingComment.task, deletingComment.comment)} />}
    {notice && <RouteNotice error={notice.error} focusKey={`task-notice-${notice.key}`}>{notice.text}</RouteNotice>}
    <div className={styles.toolbar}>
      <ul className={styles.summary} aria-label={t("Workspace task totals")}>
        {TASK_STATUSES.map(status => <li key={status}><strong>{summary[status]}</strong> {t(TASK_STATUS_LABELS[status])}</li>)}
        {summary.overdue > 0 && <li className={styles.overdue}><strong>{summary.overdue}</strong> {t('Overdue')}</li>}
      </ul>
      {canCreate && <div className={styles.actions}><Button variant="primary" onClick={() => openForm(null)}>{t("New task")}</Button><Button onClick={() => { setChecklist({ lines: '', assigneeId: '', startOn: '', gapDays: '1' }); setFormError(''); setNotice(null); setMode({ kind: 'checklist' }); }}>{t("Add checklist")}</Button></div>}
    </div>
    {tasks.length === 0 ? <EmptyState title={filtered ? t("No tasks match these filters.") : t("No tasks yet.")} icon={<IconChecklist />} action={filtered ? <a href="/tasks">{t("Reset filters")}</a> : canCreate ? <Button onClick={() => openForm(null)}>{t("New task")}</Button> : <a href="/settings/team">{t("View team")}</a>}>{canCreate ? t("Create a task or paste a checklist to start tracking work.") : t("Tasks created by your team appear here.")}</EmptyState>
      : layout === 'board' ? <><p className={styles.help}>{t("Drag a task to another column, or use its status buttons to move it.")}</p><div className={styles.columns}>{TASK_STATUSES.map(status => {
        const column = tasks.filter(task => task.status === status);
        return <section key={status} aria-label={t(TASK_STATUS_LABELS[status])} className={styles.column} data-drop-active={dropStatus === status || undefined}
          onDragOver={event => {
            const task = tasks.find(item => item.id === dragged.current);
            if (!busy && task?.canEdit && TASK_TRANSITIONS[task.status].includes(status)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropStatus(status); }
          }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStatus(null); }}
          onDrop={event => {
            event.preventDefault(); setDropStatus(null);
            const task = tasks.find(item => item.id === dragged.current); dragged.current = null;
            if (!busy && task?.canEdit && TASK_TRANSITIONS[task.status].includes(status)) void move(task, status);
          }}>
          <h2>{t(TASK_STATUS_LABELS[status])} <span className={styles.meta}>{column.length}</span></h2>
          {column.length === 0 ? <p className={styles.help}>{t("Nothing here.")}</p> : <ul>{column.map(task => <li key={task.id} className={styles.card}>
            <span className={styles.title}>{taskTitle(task)}</span>
            {task.canEdit && <span className={styles.dragHandle} draggable={!busy} aria-hidden="true" onDragStart={event => {
              if (busy) { event.preventDefault(); return; }
              dragged.current = task.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id);
            }} onDragEnd={() => { dragged.current = null; setDropStatus(null); }}><IconGripVertical size={18} /></span>}
            {postNote(task)}
            <div>{assignee(task)} {dueCell(task)}</div>
            {rowActions(task)}
          </li>)}</ul>}
        </section>;
      })}</div></>
      : <DataTable caption={t("Workspace tasks")} rows={tasks} rowKey={task => task.id} columns={[
        { key: 'title', label: t("Task"), render: task => <><span className={styles.title}>{taskTitle(task)}</span>{postNote(task)}</> },
        { key: 'status', label: t("Status"), render: task => <Badge tone={task.status === 'done' ? 'success' : task.status === 'doing' ? 'module' : 'neutral'}>{t(TASK_STATUS_LABELS[task.status])}</Badge> },
        { key: 'assignee', label: t("Assigned to"), render: assignee },
        { key: 'due', label: t("Due"), render: dueCell },
        { key: 'actions', label: t("Actions"), render: rowActions },
      ]} /> }


    <Dialog closeLabel={t('Close')} open={mode?.kind === 'form'} title={mode?.kind === 'form' && mode.task ? t("Edit task") : t("New task")} onClose={close} busy={busy}
      actions={<><Button onClick={close} disabled={busy}>{t("Cancel")}</Button><Button variant="primary" type="submit" form="task-form" disabled={busy}>{busy ? t("Saving...") : t("Save task")}</Button></>}>
      <form noValidate id="task-form" className={styles.form} onSubmit={save}>
        {formError && <RouteNotice error focusKey={`task-form-${formError}`}>{formError}</RouteNotice>}
        <label>{t("Title")}<input value={draft.title} maxLength={limits.titleMaxCharacters} required onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>{t("Notes")}<AutoTextarea value={draft.notes} maxLength={limits.notesMaxCharacters} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
        <label>{t("Assigned to")}<Select aria-label={t("Assigned to")} value={draft.assigneeId} disabled={busy} onChange={assigneeId => setDraft({ ...draft, assigneeId })} options={[{ value: "", label: t("Unassigned") }, ...assignees.map(person => ({ value: person.id, label: person.name }))]} /></label>
        <label>{t("Due date")}<input type="date" value={draft.dueOn} onChange={event => setDraft({ ...draft, dueOn: event.target.value })} /></label>
        <fieldset className={styles.link}>
          <legend>{t("Linked post")}</legend>
          <p className={styles.help} role="status">{postChange === null ? t("No post linked.") : postChange ? t("Linking: {0}", postLabel) : postLabel ? t("Linked: {0}", postLabel) : mode?.kind === 'form' && mode.task?.postHidden ? t("A post you cannot see is linked. It stays linked unless you remove it.") : t("No post linked.")}</p>
          <div className={styles.actions}>
            <input type="search" aria-label={t("Search posts to link")} value={postSearch} maxLength={200} placeholder={t("Search post text")} onChange={event => setPostSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void findPosts(0); } }} />
            <Button type="button" size="sm" disabled={searching} onClick={() => findPosts(0)}>{searching ? t("Searching...") : t("Find posts")}</Button>
            {(postChange || (postChange === undefined && (postLabel || (mode?.kind === 'form' && mode.task?.postHidden)))) && <Button type="button" size="sm" variant="quiet" onClick={() => { setPostChange(null); setPostLabel(''); }}>{t("Remove link")}</Button>}
          </div>
          {postChoices && (!postChoices.available ? <p className={styles.help}>{t("Posts are not available to link from your access.")}</p> : postChoices.posts.length === 0 ? <p className={styles.help}>{t("No posts match that search.")}</p> : <ul className={styles.choices}>
            {postChoices.posts.map(post => <li key={post.id}><label><input type="radio" name="task-post" checked={postChange === post.id} onChange={() => { setPostChange(post.id); setPostLabel(post.preview || t("Untitled post")); }} /><span>{post.preview || t("Untitled post")} <span className={styles.meta}>({t(post.status.replaceAll('_', ' '))})</span></span></label></li>)}
          </ul>)}
          {postChoices && (postChoices.offset > 0 || postChoices.hasMore) && <div className={styles.actions}>
            <Button type="button" size="sm" disabled={searching || postChoices.offset === 0} onClick={() => findPosts(Math.max(0, postChoices.offset - postChoices.posts.length))}>{t("Previous posts")}</Button>
            <Button type="button" size="sm" disabled={searching || !postChoices.hasMore} onClick={() => findPosts(postChoices.offset + postChoices.posts.length)}>{t("More posts")}</Button>
          </div>}
        </fieldset>
      </form>
    </Dialog>

    <Dialog closeLabel={t('Close')} open={mode?.kind === 'checklist'} title={t("Add checklist")} description={t("Each line becomes a task. Everything is created together, or nothing is.")} onClose={close} busy={busy}
      actions={<><Button onClick={close} disabled={busy}>{t("Cancel")}</Button><Button variant="primary" type="submit" form="task-checklist" disabled={busy}>{busy ? t("Creating...") : t("Create tasks")}</Button></>}>
      <form noValidate id="task-checklist" className={styles.form} onSubmit={saveChecklist}>
        {formError && <RouteNotice error focusKey={`task-checklist-${formError}`}>{formError}</RouteNotice>}
        <label>{t("Tasks, one per line (up to")} {limits.workflowRowLimit})<AutoTextarea value={checklist.lines} rows={6} onChange={event => setChecklist({ ...checklist, lines: event.target.value })} placeholder={locale === 'fr' ? 'Rédiger la publication\nObtenir une approbation\nPlanifier' : 'Draft the post\nGet approval\nSchedule it'} /></label>
        <label>{t("Assigned to")}<Select aria-label={t("Assigned to")} value={checklist.assigneeId} disabled={busy} onChange={assigneeId => setChecklist({ ...checklist, assigneeId })} options={[{ value: "", label: t("Unassigned") }, ...assignees.map(person => ({ value: person.id, label: person.name }))]} /></label>
        <label>{t("First due date (optional)")}<input type="date" value={checklist.startOn} onChange={event => setChecklist({ ...checklist, startOn: event.target.value })} /></label>
        <label>{t("Days between due dates")}<input type="number" inputMode="numeric" min={0} max={limits.workflowGapMaxDays} value={checklist.gapDays} disabled={!checklist.startOn} onChange={event => setChecklist({ ...checklist, gapDays: event.target.value })} /></label>
      </form>
    </Dialog>

    {mode?.kind === 'delete' && <ConfirmDialog open title={t("Delete task")} objectName={mode.task.title} consequence={t("The task and its comments are permanently removed for everyone in this workspace.")} confirmLabel={t("Delete task")} cancelLabel={t("Cancel")} pendingLabel={t("Deleting...")} failureLabel={UNKNOWN} onClose={close} onConfirm={() => remove(mode.task)} />}

    <Dialog closeLabel={t('Close')} open={mode?.kind === 'detail' && !deletingComment} title={mode?.kind === 'detail' ? mode.task.title : t("Task")} onClose={close} busy={busy}
      actions={<Button onClick={close} disabled={busy}>{t("Close")}</Button>}>
      {mode?.kind === 'detail' && <div className={styles.form}>
        {formError && <RouteNotice error focusKey={`task-detail-${formError}`}>{formError}</RouteNotice>}
        {mode.task.notes && <p className={styles.notes}>{mode.task.notes}</p>}
        {postNote(mode.task)}
        <h3>{t("Comments")}</h3>
        {comments === null ? (formError ? null : <p className={styles.help} role="status">{t("Loading comments...")}</p>) : comments.items.length === 0 ? <p className={styles.help}>{t("No comments yet.")}</p> : <ul className={styles.comments}>{comments.items.map(comment => <li key={comment.id}>
          <span className={styles.meta}>{comment.author?.name ?? t("Former member")} · {new Date(comment.createdAt).toLocaleString()}</span>{comment.body}
          {comment.canDelete && <div><Button size="sm" variant="quiet" disabled={busy} onClick={() => setDeletingComment({ task: mode.task, comment })}>{t("Delete comment")}</Button></div>}
        </li>)}</ul>}
        {comments?.hasMore && <div><Button size="sm" disabled={busy} onClick={() => loadComments(mode.task, comments.items.length)}>{t("Load more comments")}</Button></div>}
        {comments?.canComment && <>
          <label>{t("Add a comment")}<AutoTextarea value={commentDraft} maxLength={limits.commentMaxCharacters} onChange={event => setCommentDraft(event.target.value)} /></label>
          <div><Button variant="primary" disabled={busy || !commentDraft.trim()} onClick={() => addComment(mode.task)}>{busy ? t("Posting...") : t("Post comment")}</Button></div>
        </>}
      </div>}
    </Dialog>
  </>;
}
