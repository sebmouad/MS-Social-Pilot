// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/modules/inbox/ui/BulkBar', () => ({ BulkBar: () => h('div', { 'data-bulk': true }, 'Select rows') }));
import { InboxList, type InboxRow, type InboxListContinuation } from '../src/modules/inbox/ui/InboxList';
const row = (index: number): InboxRow => ({ key: `message:${index}`, content: h('li', { key: index }, `Conversation ${index}`), selectable: null });
let root: ReturnType<typeof createRoot>; let host: HTMLDivElement;
let observe: (entries: { isIntersecting: boolean }[]) => void;
let observerOptions: IntersectionObserverInit | undefined;
let disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof observe, options?: IntersectionObserverInit) { observe = callback; observerOptions = options; } observe() {} disconnect() { disconnect(); } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function mount(loadMoreAction: (input: import('../src/modules/inbox/query').InboxLocation) => Promise<InboxListContinuation>, pageLimit = 4) {
  return act(async () => root.render(h(InboxList, { rows: [row(3), row(2)], total: 6, olderCursor: 'older-2', location: { quick: 'unread', q: 'recipe', thread: 'message:3', limit: '2' }, locale: 'en', title: 'Open', maxItems: 10, pageLimit, loadMoreAction })));
}
const intersect = () => act(async () => observe([{ isIntersecting: true }]));
const button = () => host.querySelector('button')!;

describe('progressive Inbox list', () => {
  it('observes the list pane and appends the next stored page without duplicate rows or lost filters', async () => {
    const load = vi.fn(async (): Promise<InboxListContinuation> => ({ ok: true, rows: [row(2), row(1)], olderCursor: null, total: 5 }));
    await mount(load); const pane = host.querySelector('[data-inbox-list-scroll]');
    expect(observerOptions?.root).toBe(pane);
    await intersect();
    expect(load).toHaveBeenCalledWith({ quick: 'unread', q: 'recipe', thread: 'message:3', limit: '2', cursor: 'older-2' });
    expect([...host.querySelectorAll('li')].map(node => node.textContent)).toEqual(['Conversation 3', 'Conversation 2', 'Conversation 1']);
    expect(host.textContent).toContain('3 items shown · 5 stored matches');
    expect(host.querySelector('button')).toBeNull();
  });
  it('guards duplicate in-flight reads and stops automatic retries on failure while retaining rows', async () => {
    let settle!: (value: InboxListContinuation) => void;
    const load = vi.fn(() => new Promise<InboxListContinuation>(resolve => { settle = resolve; }));
    await mount(load);
    await act(async () => { observe([{ isIntersecting: true }]); observe([{ isIntersecting: true }]); });
    expect(load).toHaveBeenCalledTimes(1); expect(button().disabled).toBe(true);
    await act(async () => settle({ ok: false }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Try loading');
    await intersect(); expect(load).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('li')).toHaveLength(2);
    await act(async () => button().click()); expect(load).toHaveBeenCalledTimes(2);
    await act(async () => settle({ ok: true, rows: [row(1)], olderCursor: null, total: 3 }));
    expect(host.querySelectorAll('li')).toHaveLength(3);
  });
  it('bounds appended pages using Root policy and keeps a real continuation link', async () => {
    const load = vi.fn(async (): Promise<InboxListContinuation> => ({ ok: true, rows: [row(1)], olderCursor: 'older-1', total: 6 }));
    await mount(load, 2); await intersect();
    expect(host.querySelector('button')).toBeNull();
    const link = host.querySelector<HTMLAnchorElement>('[data-inbox-continue]')!;
    expect(new URL(link.href).searchParams.get('cursor')).toBe('older-1');
    expect(new URL(link.href).searchParams.get('quick')).toBe('unread');
    expect(new URL(link.href).searchParams.get('thread')).toBe('message:3');
    expect(disconnect).toHaveBeenCalled();
  });
  it('keeps a keyboard button when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const load = vi.fn(async (): Promise<InboxListContinuation> => ({ ok: true, rows: [row(1)], olderCursor: null, total: 3 }));
    await mount(load); await act(async () => button().click());
    expect(load).toHaveBeenCalledTimes(1); expect(host.querySelectorAll('li')).toHaveLength(3);
  });
  it('ignores a completed read after the visible scope unmounts', async () => {
    let settle!: (value: InboxListContinuation) => void;
    await mount(() => new Promise(resolve => { settle = resolve; })); await intersect();
    await act(async () => root.render(h('p', null, 'Different workspace')));
    await act(async () => settle({ ok: true, rows: [row(0)], olderCursor: null, total: 1 }));
    expect(host.textContent).toBe('Different workspace');
  });
});
