// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldsManager } from '../src/modules/publishing/ui/collaboration/FieldsManager';
import { PostPanel } from '../src/modules/publishing/ui/collaboration/PostPanel';
import { restoreVersionConfirmation } from '../src/modules/publishing/collaboration/schemas';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function button(label: string) { const node = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label); if (!node) throw new Error(`Missing ${label}`); return node as HTMLButtonElement; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function setValue(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Publishing history batch 69 organization UX', () => {
  it('uses Root option count and length limits before enabling field review', async () => {
    await act(async () => root.render(createElement(FieldsManager, { initialFields: [], canManage: true, limits: { fieldLimit: 20, nameMax: 60, optionMax: 5, optionsMax: 2 } })));
    await click(button('New field'));
    await setValue(container.querySelector('input')!, 'Status');
    await setValue(container.querySelector('select')!, 'choice');
    const textarea = container.querySelector('textarea')!;
    await setValue(textarea, 'Waiting\nLong option\nDone');
    expect(container.querySelector('#field-option-help')?.textContent).toContain('no more than 2 choices');
    expect(button('Review').disabled).toBe(true);
    await setValue(textarea, 'Waiting\nLong option');
    expect(container.querySelector('#field-option-help')?.textContent).toContain('5 characters or fewer');
    expect(button('Review').disabled).toBe(true);
    await setValue(textarea, 'Wait\nDone');
    expect(button('Review').disabled).toBe(false);
  });

  it('renders the timestamp returned by the server for a newly saved note', async () => {
    const createdAt = '2026-10-18T12:34:56.000Z';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'note-db', createdAt, notified: 'none' }) }));
    await act(async () => root.render(createElement(PostPanel, {
      postId: 'p1', canWrite: true, labels: [], assigned: [], fields: [], notes: [], mentionable: [], noteMax: 2000,
      viewerId: 'u1', canModerate: true, versions: [], restore: false, recycle: null, canRestoreNow: false, timeZone: 'UTC',
    })));
    await setValue(container.querySelector('textarea')!, 'Server-timed note');
    await click(button('Add note'));
    expect(container.textContent).toContain('Server-timed note');
    expect(container.textContent).toContain('Oct 18, 2026');
  });

  it('reviews restored content without typing an opaque id, preserves a failed dialog for retry, and announces approval reset on success', async () => {
    const version = { id: 'ver_opaque-uuid-1234', authorName: 'Editor', createdAt: '2026-10-18T12:00:00.000Z', message: 'Reviewed earlier copy', scheduledAt: null };
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'A destination changed. No content was changed.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ postId: 'post-1', versionId: version.id, status: 'draft', approvalReset: true }) });
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(createElement(PostPanel, {
      postId: 'post-1', canWrite: true, labels: [], assigned: [], fields: [], notes: [], mentionable: [], noteMax: 2000,
      viewerId: 'u1', canModerate: true, versions: [version], restore: true, recycle: null, canRestoreNow: true, timeZone: 'UTC',
    })));

    expect(container.textContent).toContain('Reviewed earlier copy');
    await click(button('Restore'));
    let dialog = container.querySelector<HTMLDialogElement>('dialog');
    expect(dialog?.textContent).toContain('Reviewed earlier copy');
    expect(dialog?.querySelector('input')).toBeNull();
    const restore = button('Restore version');
    expect(restore.disabled).toBe(false);

    await click(restore);
    dialog = container.querySelector<HTMLDialogElement>('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('Reviewed earlier copy');
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain('A destination changed');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ postId: 'post-1', versionId: version.id, confirmation: restoreVersionConfirmation(version.id) });

    await click(button('Restore version'));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Version restored. The post needs approval again.');
  });
});
