// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { QueuePostButton } from '../src/modules/publishing/ui/posts/QueuePostButton';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); refresh.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const props = { postId: 'post-1', postMessage: 'A reviewed post', destinations: ['North channel'], timeZone: 'UTC' };
async function render() { await act(async () => root.render(createElement(QueuePostButton, props))); }
function button(label: string, parent: ParentNode = document) { const result = Array.from(parent.querySelectorAll('button')).find(item => item.textContent?.trim() === label); if (!result) throw new Error(`Missing button ${label}`); return result as HTMLButtonElement; }
async function click(element: HTMLElement) { await act(async () => element.click()); }

describe('queue existing post UI', () => {
  it('reviews the post and pending destinations, sends exact confirmation, then reports server-assigned time', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ postId: 'post-1', status: 'scheduled', scheduledAt: '2026-10-18T12:30:00.000Z', scheduledLabel: 'Oct 18, 2026, 12:30 PM' }) }));
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('Add to queue'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('A reviewed post');
    expect(dialog.textContent).toContain('North channel');
    expect(dialog.textContent).toContain('next saved queue time');
    expect(dialog.querySelector('input')).toBeNull();
    await click(button('Add to queue', dialog));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/publishing/queue', expect.objectContaining({ method: 'POST', body: JSON.stringify({ postId: 'post-1', confirmation: 'QUEUE POST post-1' }) }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Post added to the queue for');
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('keeps the review open with post content after failure and permits retry', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ ok: true, json: async () => ({ postId: 'post-1', status: 'scheduled', scheduledAt: '2026-10-18T12:30:00.000Z', scheduledLabel: 'Oct 18, 2026, 12:30 PM' }) });
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('Add to queue'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    await click(button('Add to queue', dialog));
    expect(dialog.textContent).toContain('A reviewed post');
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('offline');
    expect(refresh).not.toHaveBeenCalled();
    await click(button('Add to queue', dialog));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('treats approval-required queue placement as success without promising publication', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ postId: 'post-1', status: 'pending_approval', scheduledAt: '2026-10-18T12:30:00.000Z', scheduledLabel: 'Oct 18, 2026, 12:30 PM' }) }));
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('Add to queue'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('Approval may be required');
    await click(button('Add to queue', dialog));
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('It still needs approval before it can publish.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('guards duplicate confirmation clicks while the request is in flight', async () => {
    let resolve!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetch = vi.fn(() => new Promise<{ ok: boolean; json: () => Promise<unknown> }>(yes => { resolve = yes; }));
    vi.stubGlobal('fetch', fetch); await render();
    await click(button('Add to queue'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    const confirm = button('Add to queue', dialog);
    await act(async () => { confirm.click(); confirm.click(); });
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => resolve({ ok: true, json: async () => ({ postId: 'post-1', status: 'scheduled', scheduledAt: '2026-10-18T12:30:00.000Z', scheduledLabel: 'Oct 18, 2026, 12:30 PM' }) }));
  });
});
