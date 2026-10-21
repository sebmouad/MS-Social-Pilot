// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxSelectionProvider, SelectBox, useInboxSelection, type SelectableItem } from '../src/modules/inbox/ui/InboxSelection';

vi.mock('../src/modules/inbox/components/ThreadProductivity', () => ({ ThreadProductivity: ({ onUseSavedReply }: { onUseSavedReply?: (text: string) => void }) => h('button', { onClick: () => onUseSavedReply?.('Draft for this visitor') }, 'Use reply') }));
vi.mock('../src/components/useConfirm', () => ({ useConfirm: () => [async () => true, null] }));
vi.mock('../src/modules/inbox/ui/InboxActions', () => ({ ReplyBox: ({ value, id, kind }: { value: string; id: string; kind: string }) => h('output', { 'data-thread': `${kind}:${id}` }, value) }));
import { ThreadTools } from '../src/modules/inbox/ui/ThreadTools';

let root: ReturnType<typeof createRoot>; let host: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const item = (id: string, can = true): SelectableItem => ({ key: `comment:${id}`, id, kind: 'comment', label: id, platformName: 'Facebook', resolved: false, hidden: false, can: { resolve: can, hide: can, remove: can } });
function SelectionState() { const selection = useInboxSelection(); return h('output', null, [...selection.items.values()].map(item => `${item.key}:${item.can.hide}`).join(',')); }
const selectionView = (items: SelectableItem[]) => h(InboxSelectionProvider, { pageItems: items, children: [...items.map(item => h(SelectBox, { key: item.key, item, label: item.id })), h(SelectionState, { key: 'state' })] });
const render = (node: import('react').ReactNode) => act(async () => root.render(node));
const click = () => act(async () => (host.querySelector('input, button') as HTMLElement).click());

describe('Inbox state belongs to the visible scope', () => {
  it('drops selected items when the visible page changes', async () => {
    await render(selectionView([item('first')])); await click();
    expect(host.querySelector('output')?.textContent).toBe('comment:first:true');
    await render(selectionView([item('second')]));
    expect(host.querySelector('output')?.textContent).toBe('');
  });
  it('reconciles selected permissions with fresh server facts for the same row', async () => {
    await render(selectionView([item('first')])); await click();
    await render(selectionView([item('first', false)]));
    expect(host.querySelector('output')?.textContent).toBe('comment:first:false');
  });
  it('keeps a draft on refresh and clears it when switching conversation or kind', async () => {
    const view = (id: string, kind: 'message' | 'comment' = 'message') => h(ThreadTools, { id, kind, canWrite: true, canReply: true, allowed: true, headline: '' });
    await render(view('first')); await click();
    expect(host.querySelector('output')?.textContent).toBe('Draft for this visitor');
    await render(view('first'));
    expect(host.querySelector('output')?.textContent).toBe('Draft for this visitor');
    await render(view('second'));
    expect(host.querySelector('output')?.textContent).toBe('');
    await click(); await render(view('second', 'comment'));
    expect(host.querySelector('output')?.textContent).toBe('');
  });
});
