// @vitest-environment jsdom
import { writeB7Fixture } from './b7-visual-fixture';
import fixtureStyles from '@/modules/tasks/ui/tasks.module.css';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskBoard } from '../src/modules/tasks/ui/TaskBoard';
import { TASK_DEFAULT_LIMITS, type TaskView } from '../src/modules/tasks/tasks';
const refresh=vi.hoisted(()=>vi.fn());
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
let root:ReturnType<typeof createRoot>,container:HTMLDivElement;
const task:TaskView={id:'task-a',title:'Review campaign',notes:'Keep this note',status:'todo',assignee:null,dueOn:null,overdue:false,post:null,postHidden:false,createdBy:null,createdAt:'2026-10-18T10:00:00.000Z',updatedAt:'2026-10-18T10:00:00.000Z',commentCount:1,checklist:{done:1,total:2},canEdit:true,canDelete:true};
const button=(label:string,parent:ParentNode=container)=>{const b=[...parent.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);if(!b)throw Error(`Missing ${label}`);return b;};
const click=async(b:HTMLElement)=>act(async()=>{b.click();});
beforeEach(async()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  container=document.createElement('div');document.body.append(container);root=createRoot(container);refresh.mockReset();vi.stubGlobal('fetch',vi.fn());
  await act(async()=>root.render(createElement(TaskBoard,{tasks:[task],assignees:[],canCreate:true,limits:TASK_DEFAULT_LIMITS,today:'2026-10-18',summary:{todo:1,doing:0,done:0,overdue:0},view:'table',filtered:false})));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe('Tasks customer confirmation and edit recovery',()=>{
  it('names the object and consequence, hides protocol commands and sends the exact selected-task confirmation',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({ok:true})} as Response);
    await click(button('Delete'));const dialog=container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Review campaign');expect(dialog.textContent).not.toContain('DELETE TASK');
    expect(dialog.textContent).toContain('permanently removed'); expect(fetch).not.toHaveBeenCalled();
    await click(button('Delete task',dialog));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({action:'task.delete',id:'task-a',confirmation:'DELETE TASK task-a'});
    expect(container.querySelector('dialog')).toBeNull();expect(container.textContent).toContain('Task deleted.');
  });
  it('preserves the edited fields and expected version when a conflicting update is refused',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:false,status:409,json:async()=>({error:'This task changed while you were editing it.'})} as Response);
    await click(button('Edit'));const dialog=container.querySelector('dialog')!,input=dialog.querySelector<HTMLInputElement>('input[required]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Revised campaign');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    await click(button('Save task',dialog));
    expect(container.querySelector('dialog[open]')).not.toBeNull();expect(input.value).toBe('Revised campaign');expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('changed while');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({action:'task.update',confirmation:'UPDATE TASK task-a',id:'task-a',title:'Revised campaign',expectedUpdatedAt:task.updatedAt});expect(refresh).not.toHaveBeenCalled();
  });
});

const fill = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
});
const sent = () => vi.mocked(fetch).mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(String(call[1]?.body)));
describe('Task board shared confirmations', () => {
  it('confirms task creation from the existing save control', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    await click(button('New task')); const dialog = container.querySelector('dialog')!;
    await fill(dialog.querySelector<HTMLInputElement>('input[required]')!, 'New campaign'); await click(button('Save task', dialog));
    expect(sent()[0]).toMatchObject({ action: 'task.create', title: 'New campaign', confirmation: 'CREATE TASK New campaign' });
  });
  it('confirms the chosen status through its direct action', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    await click(button('Start'));
    expect(sent()[0]).toEqual({ action: 'task.transition', id: 'task-a', status: 'doing', confirmation: 'MOVE TASK task-a TO doing' });
  });
  it('confirms the reviewed checklist count', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    await click(button('Add checklist')); const dialog = container.querySelector('dialog')!;
    await fill(dialog.querySelector<HTMLTextAreaElement>('textarea')!, 'Draft\nReview'); await click(button('Create tasks', dialog));
    expect(sent()[0]).toMatchObject({ action: 'task.createMany', titles: ['Draft', 'Review'], confirmation: 'CREATE 2 TASKS' });
  });
  it('confirms a comment for the currently viewed task', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true, comments: [], canComment: true }) } as Response);
    await click(button('Details (1)')); const dialog = container.querySelector('.ui-side-panel')!;
    await fill(dialog.querySelector<HTMLTextAreaElement>('textarea')!, 'Ready to review'); await click(button('Post comment', dialog));
    expect(sent()[0]).toEqual({ action: 'comment.add', taskId: 'task-a', body: 'Ready to review', confirmation: 'COMMENT ON TASK task-a' });
  });
});

it('saves only the edited title with optimistic version protection, keeping other task fields untouched', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="Edit Review campaign"]')!;
  await click(edit);
  const input = container.querySelector<HTMLInputElement>('.ui-inline-edit input')!;
  await fill(input, 'Campaign ready');
  await click(container.querySelector<HTMLButtonElement>('.ui-inline-edit button[aria-label="Save"]')!);
  expect(sent()[0]).toEqual({ action: 'task.update', id: task.id, title: 'Campaign ready', expectedUpdatedAt: task.updatedAt, confirmation: 'UPDATE TASK task-a' });
  expect(sent()[0]).not.toHaveProperty('notes'); expect(sent()[0]).not.toHaveProperty('postId');
  expect(refresh).toHaveBeenCalledOnce();
});

it('keeps an inline title draft open after a service refusal', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'This task changed. Refresh before saving.' }) } as Response);
  await click(container.querySelector<HTMLButtonElement>('button[aria-label="Edit Review campaign"]')!);
  const input = container.querySelector<HTMLInputElement>('.ui-inline-edit input')!;
  await fill(input, 'A revised title');
  await click(container.querySelector<HTMLButtonElement>('.ui-inline-edit button[aria-label="Save"]')!);
  expect(input.value).toBe('A revised title'); expect(container.querySelector('.ui-inline-edit [role=alert]')).not.toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

const renderBoard = async (overrides: Partial<Parameters<typeof TaskBoard>[0]> = {}) => act(async () => {
  root.render(createElement(TaskBoard, { tasks: [task], assignees: [], canCreate: true, limits: TASK_DEFAULT_LIMITS, today: '2026-10-18', summary: { todo: 1, doing: 0, done: 0, overdue: 0 }, view: 'board', filtered: false, ...overrides }));
});
const dragEvent = (element: Element, type: string) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { setData: vi.fn(), dropEffect: 'none', effectAllowed: 'none' } });
  element.dispatchEvent(event); return event;
};
describe('Task kanban polish', () => {
  it('moves a dragged task with the same service confirmation as the visible status button', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response);
    await renderBoard();
    // Initial list mode persists inside the mounted component: remount with a new key to use Board.
    await act(async () => root.render(createElement(TaskBoard, { key: 'kanban', tasks: [task], assignees: [], canCreate: true, limits: TASK_DEFAULT_LIMITS, today: '2026-10-18', summary: { todo: 1, doing: 0, done: 0, overdue: 0 }, view: 'board', filtered: false })));
    const column = container.querySelector('section[aria-label="In progress"]')!;
    await act(async () => { dragEvent(container.querySelector('[draggable="true"]')!, 'dragstart'); });
    await act(async () => { expect(dragEvent(column, 'dragover').defaultPrevented).toBe(true); });
    expect(column.getAttribute('data-drop-active')).toBe('true');
    await act(async () => { dragEvent(column, 'drop'); });
    expect(sent()).toEqual([{ action: 'task.transition', id: task.id, status: 'doing', confirmation: 'MOVE TASK task-a TO doing' }]);
    expect(column.hasAttribute('data-drop-active')).toBe(false);
    expect(container.textContent).toContain('Moved to In progress.');
  });

  it('ignores external drags and same-column drops, and offers no drag handle for read-only tasks', async () => {
    await act(async () => root.render(createElement(TaskBoard, { key: 'readonly', tasks: [{ ...task, canEdit: false }], assignees: [], canCreate: false, limits: TASK_DEFAULT_LIMITS, today: '2026-10-18', summary: { todo: 1, doing: 0, done: 0, overdue: 0 }, view: 'board', filtered: false })));
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    await act(async () => { dragEvent(container.querySelector('section[aria-label="Done"]')!, 'drop'); });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(TaskBoard, { key: 'editable', tasks: [task], assignees: [], canCreate: false, limits: TASK_DEFAULT_LIMITS, today: '2026-10-18', summary: { todo: 1, doing: 0, done: 0, overdue: 0 }, view: 'board', filtered: false })));
    await act(async () => { dragEvent(container.querySelector('[draggable="true"]')!, 'dragstart'); dragEvent(container.querySelector('section[aria-label="To do"]')!, 'drop'); });
    expect(fetch).not.toHaveBeenCalled(); expect(button('Start').tagName).toBe('BUTTON');
  });

  it('keeps the source card and status actions after a refused move', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'This task changed. Refresh before moving.' }) } as Response);
    await act(async () => root.render(createElement(TaskBoard, { key: 'failure', tasks: [task], assignees: [], canCreate: false, limits: TASK_DEFAULT_LIMITS, today: '2026-10-18', summary: { todo: 1, doing: 0, done: 0, overdue: 0 }, view: 'board', filtered: false })));
    await click(button('Start'));
    expect(container.querySelector('section[aria-label="To do"]')?.textContent).toContain(task.title);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Refresh before moving');
    expect(button('Start').disabled).toBe(false); expect(refresh).not.toHaveBeenCalled();
  });

  it('localizes task actions and due urgency, uses shared Avatars and discloses the scoped linked-post preview', async () => {
    await renderBoard({ locale: 'fr', tasks: [{ ...task, assignee: { id: 'member', name: 'Sara Martin' }, dueOn: '2026-10-18', post: { id: 'post', preview: 'Launch preview', status: 'draft' } }] });
    expect(container.textContent).toContain('Commencer'); expect(container.textContent).toContain('aujourd’hui');
    expect(container.querySelector('.ui-avatar')?.textContent).toBe('SM');
    const preview = container.querySelector('details')!;
    expect(preview.querySelector('summary')?.textContent).toBe('Publication liée');
    expect(preview.textContent).toContain('Launch preview');
    expect(container.querySelector('.ui-badge--warning')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Modifier Review campaign"]')).toBeTruthy();
  });
});

it('opens comments in the shared side panel, closes with Escape and restores the row action focus', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ comments: [], canComment: false }) } as Response);
  const opener = button('Details (1)'); opener.focus(); await click(opener);
  const panel = container.querySelector<HTMLElement>('.ui-side-panel')!;
  expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
  expect(document.activeElement).toBe(panel);
  expect(panel.textContent).toContain('Review campaign');
  expect(panel.textContent).toContain('No comments yet.');
  await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('.ui-side-panel')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('ignores a late comment response from the previously selected task', async () => {
  let oldResponse!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { oldResponse = resolve; }));
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [{ id: 'b-comment', body: 'Current comment', createdAt: task.createdAt, author: null, canDelete: false }], canComment: false }) } as Response);
  await renderBoard({ tasks: [task, { ...task, id: 'task-b', title: 'Second task' }], view: 'table' });
  const detailButtons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent === 'Details (1)');
  await click(detailButtons[0]); await click(detailButtons[1]);
  expect(container.querySelector('.ui-side-panel')?.textContent).toContain('Current comment');
  await act(async () => oldResponse({ ok: true, json: async () => ({ comments: [{ id: 'old-comment', body: 'Obsolete comment', createdAt: task.createdAt, author: null, canDelete: false }], canComment: true }) } as Response));
  const panel = container.querySelector('.ui-side-panel')!;
  expect(panel.textContent).toContain('Second task');
  expect(panel.textContent).toContain('Current comment');
  expect(panel.textContent).not.toContain('Obsolete comment');
  expect(panel.querySelector('textarea')).toBeNull();
});


it.runIf(Boolean(process.env.B7_FIXTURE_DIR))('exports the Tasks synthetic component fixture when requested', () => {
  writeB7Fixture('tasks', renderToStaticMarkup(createElement(TaskBoard, {
    tasks: [task, { ...task, id: 'task-b', title: 'Approve autumn launch', status: 'doing', dueOn: '2026-10-23' }, { ...task, id: 'task-c', title: 'Schedule the recap', status: 'done' }],
    assignees: [], canCreate: true, limits: TASK_DEFAULT_LIMITS, today: '2026-10-22', summary: { todo: 1, doing: 1, done: 1, overdue: 0 }, view: 'board', filtered: false,
  })), 'tasks', fixtureStyles);
});
