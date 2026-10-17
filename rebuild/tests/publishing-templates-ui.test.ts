// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarDockContext } from '../src/components/SidebarDock';
import { TemplateManager } from '../src/app/publishing/templates/TemplateManager';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dock: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); dock = document.createElement('div'); document.body.append(container, dock); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dock.remove(); vi.unstubAllGlobals(); });
const props = { initialTemplates: [], labels: [{ id: 'label-a', name: 'Campaign' }], page: 1, hasMore: false, query: '' };
async function render() { await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(TemplateManager, props)))); }
function button(label: string, parent: ParentNode = document) { const result = Array.from(parent.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (!result) throw new Error(`Missing button ${label}`); return result as HTMLButtonElement; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function enter(input: HTMLInputElement | HTMLTextAreaElement, value: string) { const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!; await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }); }

describe('template management UI', () => {
  it('requires exact review confirmation, sends the label, and accepts only a matching create receipt', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => ({ id: 'template-a', name: 'Welcome', category: '', body: 'Hello', hashtags: '', firstComment: '', labelId: 'label-a', createdAt: '2026-10-17T12:00:00Z', updatedAt: '2026-10-17T12:00:00Z' }) }));
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('New template', dock));
    const edit = container.querySelector<HTMLDialogElement>('dialog')!;
    await enter(edit.querySelector<HTMLInputElement>('input')!, 'Welcome');
    await enter(edit.querySelector<HTMLTextAreaElement>('textarea')!, 'Hello');
    await act(async () => { const select = edit.querySelector<HTMLSelectElement>('select')!; select.value = 'label-a'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(button('Create template', edit));
    const review = container.querySelectorAll<HTMLDialogElement>('dialog')[1]!;
    expect(review.textContent).toContain('CREATE TEMPLATE Welcome');
    expect(button('Confirm save', review).disabled).toBe(true);
    await enter(review.querySelector<HTMLInputElement>('input')!, 'CREATE TEMPLATE Welcome');
    await click(button('Confirm save', review));
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ name: 'Welcome', body: 'Hello', labelId: 'label-a', confirmation: 'CREATE TEMPLATE Welcome' });
    expect(container.textContent).toContain('Template created.');
    expect(container.textContent).toContain('Welcome');
  });
});
