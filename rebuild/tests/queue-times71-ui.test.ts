// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarDockContext } from '../src/components/SidebarDock';
import { QueueTimes } from '../src/app/publishing/collaboration/QueueTimes';

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
const props = { slots: [], targets: [{ id: 'channel-1', name: 'North' }, { id: 'channel-2', name: 'South' }], canEditShared: true, canEditChannels: true, limit: 20, initialSlot: { dayOfWeek: 1, hour: 9, minute: 0 }, timeZone: 'America/Los_Angeles' };
async function render() { await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(QueueTimes, props)))); }
function button(label: string, parent: ParentNode = container) { const result = Array.from(parent.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (!result) throw new Error(`Missing button ${label}`); return result as HTMLButtonElement; }
function selector(parent: ParentNode = dock) { return parent.querySelector<HTMLSelectElement>('select')!; }
function timeInput(parent: ParentNode = container) { return parent.querySelector<HTMLInputElement>('input[type="time"]')!; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('queue timetable controls', () => {
  it('keeps the scope selector in the sidebar and invalid cleared time never adds the initial slot', async () => {
    await render();
    expect(dock.textContent).toContain('Shared by all channels');
    expect(container.textContent).not.toContain('Timetable');
    expect(container.textContent).toContain('America/Los Angeles');
    expect(timeInput().value).toBe('09:00');
    await setValue(timeInput(), '');
    await click(button('Add time'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter a valid time');
    expect(container.querySelector('tbody')).toBeNull();
    expect(timeInput().value).toBe('');
  });

  it('preserves separate unsaved timetables and add drafts while switching scope', async () => {
    await render();
    await setValue(timeInput(), '10:15');
    await click(button('Add time'));
    expect(container.textContent).toContain('Monday'); expect(container.textContent).toContain('10:15');
    await setValue(selector(), 'channel-1');
    expect(timeInput().value).toBe('09:00');
    const day = container.querySelector<HTMLSelectElement>('select')!;
    await setValue(day, '4');
    await setValue(timeInput(), '08:30');
    await click(button('Add time'));
    expect(container.textContent).toContain('Thursday'); expect(container.textContent).toContain('08:30');
    await setValue(selector(), '');
    expect(container.textContent).toContain('10:15');
    expect(dock.textContent).toContain('Shared by all channels · Unsaved changes');
    await setValue(selector(), 'channel-1');
    expect(container.textContent).toContain('Thursday'); expect(container.textContent).toContain('08:30');
    expect(dock.textContent).toContain('North · Unsaved changes');
  });

  it('disables scope and editor controls while a save is pending', async () => {
    let resolve!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetch = vi.fn(() => new Promise<{ ok: boolean; json: () => Promise<unknown> }>(yes => { resolve = yes; }));
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('Add time'));
    await click(button('Review changes'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.querySelector('input')).toBeNull();
    expect(dialog.textContent).toContain('Monday 09:00');
    await click(button('Save queue times', dialog));
    expect(fetch).toHaveBeenCalledWith('/api/publishing/queue-slots', expect.objectContaining({ body: JSON.stringify({ targetId: null, slots: [{ dayOfWeek: 1, hour: 9, minute: 0 }], confirmation: 'REPLACE QUEUE TIMES SHARED' }) }));
    expect(selector().disabled).toBe(true);
    expect(timeInput().disabled).toBe(true);
    expect(button('Working…', dialog).disabled).toBe(true);
    await act(async () => resolve({ ok: true, json: async () => ({ targetId: null, count: 1 }) }));
  });
});
