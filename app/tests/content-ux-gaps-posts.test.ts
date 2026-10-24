// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), queryRaw: vi.fn(async (): Promise<Array<{ postId: string; reach: string | null; measured: string }>> => []) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async () => 50) }));

import { PostsTable } from '../src/modules/publishing/ui/posts/PostsTable';
import { ReachCell } from '../src/modules/publishing/ui/posts/PostTableCells';
import { loadPostReach } from '../src/modules/publishing/server/post-reach';
import { ToastProvider } from '../src/components/Toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const target = (id: string, status = 'published') => ({ id: `pt-${id}`, status, remotePostId: `remote-${id}`, remoteUrl: null, target: { id, type: 'channel', name: `Channel ${id}`, pictureUrl: null, platformName: 'Facebook' } });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', authorId: 'user-1', createdAt: new Date('2026-10-18T10:00:00Z'), message: 'Launch day', firstComment: null, link: null, media: [],
  status: 'published', publishedAt: new Date('2026-10-19T10:00:00Z'), scheduledAt: null, targets: [target('c1')],
  whenLabel: 'Oct 19, 2026', authorName: 'Your team', canEdit: true, canDuplicate: false,
  reach: { value: 1234, measured: 1 }, ...over,
});

describe('posts reach column', () => {
  it('shows a Reach header in English and French', () => {
    const en = renderToStaticMarkup(createElement(PostsTable, { rows: [row()] as never, caption: 'Posts', selectable: false, canRetry: false, manage: null, empty: createElement('p', null, 'Empty') }));
    expect(en).toContain('>Reach<');
    const fr = renderToStaticMarkup(createElement(PostsTable, { rows: [row()] as never, caption: 'Posts', locale: 'fr', selectable: false, canRetry: false, manage: null, empty: createElement('p', null, 'Vide') }));
    expect(fr).toContain('>Portée<');
  });
  it('formats stored reach and marks missing reach unavailable', () => {
    expect(renderToStaticMarkup(createElement(ReachCell, { reach: { value: 1234, measured: 1 }, locale: 'en' }))).toContain('1,234');
    expect(renderToStaticMarkup(createElement(ReachCell, { reach: { value: null, measured: 0 }, locale: 'en' }))).toContain('—');
  });
});

describe('post row click', () => {
  it('opens the post detail page', async () => {
    await act(async () => root.render(createElement(ToastProvider, null, createElement(PostsTable, { rows: [row()] as never, caption: 'Posts', selectable: false, canRetry: false, manage: null, empty: createElement('p', null, 'Empty') }))));
    const cells = container.querySelectorAll('tbody tr td');
    expect(cells.length).toBeGreaterThan(1);
    await act(async () => { cells[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(mocks.push).toHaveBeenCalledWith('/content/post/p1');
  });
});

describe('post reach loader', () => {
  it('maps stored snapshots to per-post reach and skips unmeasured posts', async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { postId: 'p1', reach: '1234', measured: '2' },
      { postId: 'p2', reach: null, measured: '0' },
    ]);
    const found = await loadPostReach('workspace-1', ['p1', 'p2', 'p3']);
    expect(found.get('p1')).toEqual({ value: 1234, measured: 2 });
    expect(found.get('p2')).toEqual({ value: null, measured: 0 });
    expect(found.has('p3')).toBe(false);
  });
});
