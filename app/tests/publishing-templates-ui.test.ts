// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateManager } from '../src/modules/publishing/ui/templates/TemplateManager';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const props = { initialTemplates: [], labels: [{ id: 'label-a', name: 'Campaign' }], page: 1, hasMore: false, query: '', limits: { maxSearchCharacters: 120, maxNameCharacters: 120, maxCategoryCharacters: 80, maxBodyCharacters: 5000, maxHashtagsCharacters: 1000, maxFirstCommentCharacters: 2000, maxFirstCommentDelayMinutes: 10080 } };
async function render() { await act(async () => root.render(createElement(TemplateManager, props))); }
function button(label: string, parent: ParentNode = document) { const result = Array.from(parent.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (!result) throw new Error(`Missing button ${label}`); return result as HTMLButtonElement; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function enter(input: HTMLInputElement | HTMLTextAreaElement, value: string) { const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!; await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }); }

describe('template management UI', () => {
  it('requires exact review confirmation, sends the label, and accepts only a matching create receipt', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => ({ id: 'template-a', name: 'Welcome', category: '', body: 'Hello', hashtags: '', firstComment: '', firstCommentDelayMinutes: 37, labelId: 'label-a', createdAt: '2026-10-17T12:00:00Z', updatedAt: '2026-10-17T12:00:00Z' }) }));
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('New template', container));
    const edit = container.querySelector<HTMLDialogElement>('dialog')!;
    await enter(edit.querySelector<HTMLInputElement>('input')!, 'Welcome');
    await enter(edit.querySelector<HTMLTextAreaElement>('textarea')!, 'Hello');
    const delay = edit.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(delay.max).toBe('10080');
    await enter(delay, '37');
    await act(async () => { const select = edit.querySelector<HTMLSelectElement>('select')!; select.value = 'label-a'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(button('Create template', edit));
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ name: 'Welcome', body: 'Hello', firstCommentDelayMinutes: 37, labelId: 'label-a', confirmation: 'CREATE TEMPLATE Welcome' });
    expect(container.textContent).toContain('Template created.');
    expect(container.textContent).toContain('Welcome');
  });
  it('shows an offline error inside the active review dialog and retains the draft for retry', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ ok: true, json: async () => ({ id: 'retry-template', name: 'Retry test', category: '', body: 'Keep this draft', hashtags: '', firstComment: '', firstCommentDelayMinutes: 0, labelId: null, createdAt: '2026-10-17T12:00:00Z', updatedAt: '2026-10-17T12:00:00Z' }) });
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('New template', container));
    const edit = container.querySelector<HTMLDialogElement>('dialog')!;
    await enter(edit.querySelector<HTMLInputElement>('input')!, 'Retry test');
    await enter(edit.querySelector<HTMLTextAreaElement>('textarea')!, 'Keep this draft');
    await click(button('Create template', edit));
    expect(edit.textContent).toContain('save result is unknown');
    expect(edit.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep this draft');
    await click(button('Create template', edit));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Template created.');
  });
  it('deletes through the shared confirm dialog, sending the server confirmation without typing', async () => {
    const template = { id: 'template-z', name: 'Old promo', category: '', body: 'Sale', hashtags: '', firstComment: '', firstCommentDelayMinutes: 0, labelId: null, createdAt: '2026-10-17T12:00:00Z', updatedAt: '2026-10-17T12:00:00Z' };
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'template-z', deleted: true }) }));
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(createElement(TemplateManager, { ...props, initialTemplates: [template] })));
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Old promo"]')!);
    await click(Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === 'Delete')!);
    const confirm = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(confirm.textContent).toContain('Old promo');
    expect(confirm.querySelector('input')).toBeNull();
    await click(button('Delete template', confirm));
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ confirmation: 'DELETE TEMPLATE template-z' });
    expect(container.textContent).toContain('Template deleted.');
    expect(container.textContent).not.toContain('Old promo');
  });
  it('renders French copy', async () => {
    await act(async () => root.render(createElement(TemplateManager, { ...props, locale: 'fr' })));
    expect(container.textContent).toContain('Nouveau modèle');
    expect(container.textContent).toContain('Aucun modèle pour l’instant');
  });

});
