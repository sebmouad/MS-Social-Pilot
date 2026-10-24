// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASYNC_POST_EXPORT_COPY } from '../src/modules/publishing/server/export/config';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('q=launch&status=published&channel=channel-7&page=4&view=cards') }));
vi.mock('../src/modules/publishing/ui/posts/export-actions', () => ({ loadPostExportLabels: vi.fn(async () => ASYNC_POST_EXPORT_COPY.en) }));
import { PostExport } from '../src/modules/publishing/ui/posts/PostExport';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const receipt = (status = 'queued') => ({ ok: true, json: async () => ({ id: 'export-1', status }) });
beforeEach(async () => {
 (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
 vi.stubGlobal('fetch', vi.fn());
 container = document.createElement('div'); document.body.append(container); root = createRoot(container);
 await act(async () => root.render(createElement(PostExport, { maxPosts: 5000, maxBytes: 1024 })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function consent() { await act(async () => container.querySelector<HTMLInputElement>('input')!.click()); }
async function prepare() { await act(async () => container.querySelector<HTMLButtonElement>('button')!.click()); }
describe('PostExport background workflow', () => {
 it('requires consent and sends only committed filters with exact confirmation', async () => {
  expect(container.querySelector('button')!.disabled).toBe(true);
  await prepare(); expect(fetch).not.toHaveBeenCalled();
  await consent(); vi.mocked(fetch).mockResolvedValue(receipt() as never); await prepare();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/publishing/posts/export/jobs');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ action: 'create', filters: { q: 'launch', status: 'published', channelId: 'channel-7' }, confirmation: 'EXPORT POSTS' });
  expect(container.textContent).toContain(ASYNC_POST_EXPORT_COPY.en.queued);
  expect(container.querySelector('input')!.checked).toBe(false);
 });
 it('blocks duplicate requests while preparation is pending', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }) as never);
  await consent();
  await act(async () => { container.querySelector('button')!.click(); container.querySelector('button')!.click(); });
  expect(fetch).toHaveBeenCalledTimes(1); expect(container.querySelector('button')!.disabled).toBe(true);
  await act(async () => finish(receipt()));
 });
 it('refreshes progress and offers an authorized download only when ready', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(receipt('processing') as never).mockResolvedValueOnce(receipt('ready') as never);
  await consent(); await prepare(); expect(container.querySelector('a')).toBeNull();
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === ASYNC_POST_EXPORT_COPY.en.refresh)!.click());
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/publishing/posts/export/jobs?action=status&id=export-1');
  expect(container.querySelector('a')!.getAttribute('href')).toBe('/api/publishing/posts/export/jobs?action=download&id=export-1');
  expect(container.textContent).toContain(ASYNC_POST_EXPORT_COPY.en.ready);
 });
 it('rejects malformed receipts and keeps safe failure feedback and consent for retry', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ error: 'private token', id: 'x', status: 'unknown' }) } as never);
  await consent(); await prepare();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(ASYNC_POST_EXPORT_COPY.en.failure);
  expect(container.textContent).not.toContain('private token'); expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('input')!.checked).toBe(true);
 });
});
