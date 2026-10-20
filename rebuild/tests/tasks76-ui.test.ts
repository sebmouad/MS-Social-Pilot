// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskBoard } from '../src/modules/tasks/ui/TaskBoard';
import { TASK_DEFAULT_LIMITS, type TaskView } from '../src/modules/tasks/tasks';
const refresh=vi.hoisted(()=>vi.fn());
vi.mock('next/navigation',()=>({useRouter:()=>({refresh})}));
let root:ReturnType<typeof createRoot>,container:HTMLDivElement;
const task:TaskView={id:'task-a',title:'Review campaign',notes:'Keep this note',status:'todo',assignee:null,dueOn:null,overdue:false,post:null,postHidden:false,createdBy:null,createdAt:'2026-10-18T10:00:00.000Z',updatedAt:'2026-10-18T10:00:00.000Z',commentCount:1,canEdit:true,canDelete:true};
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
  it('requires a consequence checkbox, hides protocol commands and sends the exact selected-task confirmation',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({ok:true})} as Response);
    await click(button('Delete'));const dialog=container.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Review campaign');expect(dialog.textContent).not.toContain('DELETE TASK');
    expect(button('Delete task',dialog).disabled).toBe(true);await click(button('Delete task',dialog));expect(fetch).not.toHaveBeenCalled();
    await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);await click(button('Delete task',dialog));
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
    await click(button('Details (1)')); const dialog = container.querySelector('dialog')!;
    await fill(dialog.querySelector<HTMLTextAreaElement>('textarea')!, 'Ready to review'); await click(button('Post comment', dialog));
    expect(sent()[0]).toEqual({ action: 'comment.add', taskId: 'task-a', body: 'Ready to review', confirmation: 'COMMENT ON TASK task-a' });
  });
});
