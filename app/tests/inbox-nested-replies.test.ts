// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadEntry } from '../src/modules/inbox/server/types';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/modules/inbox/ui/inbox.module.css', () => ({ default: {} }));
vi.mock('../src/components', async () => ({ ...await import('../src/components/Button'), ...await import('../src/components/Dialog') }));
vi.mock('../src/server/data', () => ({ prisma: {} }));
import { nestReplies } from '../src/modules/inbox/server/read';
import { ThreadToolbar } from '../src/modules/inbox/ui/InboxActions';

const opening = { id: 'c0', remoteId: 'r0' };
const make = (item: { id: string }, parentId: string, depth: number): ThreadEntry => ({ id: item.id, author: item.id, text: '', time: new Date(0), fromChannel: false, sentBy: null, parentId, depth, hidden: false });

describe('nestReplies', () => {
  it('places replies under their parent, chronological among siblings, with depth', () => {
    const page = [
      { id: 'a', remoteId: 'ra', parentRemoteId: 'r0' },
      { id: 'b', remoteId: 'rb', parentRemoteId: 'r0' },
      { id: 'a1', remoteId: 'ra1', parentRemoteId: 'ra' },
      { id: 'a2', remoteId: 'ra2', parentRemoteId: 'ra1' },
    ];
    expect(nestReplies(page, opening, make).map(e => [e.id, e.parentId, e.depth])).toEqual([['a', 'c0', 1], ['a1', 'a', 2], ['a2', 'a1', 3], ['b', 'c0', 1]]);
  });

  it('attaches a reply whose parent is on another page directly under the opening comment', () => {
    expect(nestReplies([{ id: 'x', remoteId: 'rx', parentRemoteId: 'earlier-page' }], opening, make).map(e => [e.id, e.parentId, e.depth])).toEqual([['x', 'c0', 1]]);
  });

  it('keeps nested reply windows complete across ten synthetic Page discussions', () => {
    for (let page = 0; page < 10; page++) {
      const root = { id: `page-${page}-root`, remoteId: `page-${page}-remote-root` };
      const replies = Array.from({ length: 60 }, (_, index) => ({
        id: `page-${page}-reply-${index}`, remoteId: `page-${page}-remote-${index}`,
        parentRemoteId: index % 3 === 0 ? root.remoteId : `page-${page}-remote-${index - 1}`,
      }));
      const shown: string[] = [];
      for (let offset = 0; offset < replies.length; offset += 20) {
        const window = replies.slice(offset, offset + 20);
        const entries = nestReplies(window, root, make);
        expect(entries).toHaveLength(window.length);
        const visibleParents = new Set([root.id, ...entries.map(entry => entry.id)]);
        expect(entries.every(entry => visibleParents.has(entry.parentId!))).toBe(true);
        shown.push(...entries.map(entry => entry.id));
      }
      expect(new Set(shown)).toEqual(new Set(replies.map(reply => reply.id)));
    }
  });

  it('survives a stored parent cycle and self parent without repeating or dropping into recursion', () => {
    const out = nestReplies([{ id: 'p', remoteId: 'rp', parentRemoteId: 'rq' }, { id: 'q', remoteId: 'rq', parentRemoteId: 'rp' }, { id: 's', remoteId: 'rs', parentRemoteId: 'rs' }], opening, make);
    expect(out.map(e => e.id)).toEqual(['s']);
  });
});

describe('reply actions', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it('offers hide and delete for a reply without resolve, and hides through the shared action with the reply id', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(createElement(ThreadToolbar, { reply: true, id: 'reply-1', kind: 'comment', resolved: false, hidden: false, canResolve: true, canHide: true, canDelete: true, platformName: 'Example', listHref: '/inbox' })));
    const labels = [...container.querySelectorAll('button')].map(button => button.textContent);
    expect(labels).toContain('Hide reply');
    expect(labels).toContain('Delete reply');
    expect(labels).not.toContain('Mark resolved');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Hide reply')!.click());
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body))).toEqual({ action: 'moderate', id: 'reply-1', hidden: true });
    expect(router.refresh).toHaveBeenCalled();
  });
});
