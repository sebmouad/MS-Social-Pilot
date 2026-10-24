// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

import { ReplyBox, ThreadToolbar } from '../src/modules/inbox/ui/InboxActions';
import { InboxCopyProvider } from '../src/modules/inbox/ui/copy-context';
import { ToastProvider } from '../src/components/Toast';
import { inboxCustomerCopy } from '../src/modules/inbox/customer-copy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; let host: HTMLElement | null = null;
async function mount(node: import('react').ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(h(ToastProvider, { children: h(InboxCopyProvider, { catalog: inboxCustomerCopy, children: node }) })); });
}
async function reset() { if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null; document.body.innerHTML = ''; }
const text = () => document.body.textContent ?? '';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(reset);

describe('inbox reply and moderation consequences', () => {
  it('tells who sees a reply before it is sent', async () => {
    await mount(h(ReplyBox, { id: 'm1', kind: 'message', allowed: true, headline: 'Replies are open' }));
    expect(text()).toContain('Private: your reply goes only to the people in this conversation.');
    await reset();
    await mount(h(ReplyBox, { id: 'c1', kind: 'comment', allowed: true, headline: 'Replies are open' }));
    expect(text()).toContain('Public: everyone who can see the post will see your reply.');
    expect(document.querySelector('[data-kind="comment"]')).not.toBeNull();
  });

  it('states the hide consequence on public threads and keeps resolve controls', async () => {
    await mount(h(ThreadToolbar, { id: 'c1', kind: 'comment', resolved: false, hidden: false, canResolve: true, canHide: true, canDelete: true, platformName: 'Facebook', listHref: '/inbox' }));
    expect(text()).toContain('Hiding removes this from public view. You can show it again at any time.');
    expect(text()).toContain('Mark resolved');
    await reset();
    await mount(h(ThreadToolbar, { id: 'm1', kind: 'message', resolved: false, hidden: false, canResolve: true, canHide: false, canDelete: false, platformName: 'Facebook', listHref: '/inbox' }));
    expect(text()).not.toContain('Hiding removes this from public view');
    expect(text()).toContain('Mark resolved');
  });
});
