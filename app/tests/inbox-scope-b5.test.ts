import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ scope: vi.fn(), viewer: vi.fn(), read: vi.fn() }));
vi.mock('@/modules/shell/server/scope', () => ({ pageChannelScope: state.scope }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 180 }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/modules/inbox/server/read', () => ({ readInboxList: state.read }));
vi.mock('@/modules/inbox/server/actions', () => ({ canManageInbox: async () => true, canManageInboxWorkflow: async () => true }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: async () => ({ reply: true, hide: true, remove: true }) }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
vi.mock('../src/modules/inbox/ui/locale', () => ({ inboxLocale: async () => 'en' }));

import { inboxScope } from '../src/modules/inbox/ui/scope';
import { loadMoreInboxRows } from '../src/modules/inbox/ui/list-action';
import { InboxFilterRow } from '../src/modules/inbox/ui/InboxFilterRow';
import { InboxCopyProvider } from '../src/modules/inbox/ui/copy-context';
import { inboxCustomerCopy } from '../src/modules/inbox/customer-copy';

const member = { workspaceId: 'w', permissions: { pageScope: { all: false as const, ids: ['a', 'b', 'c'] } } };
const owner = { workspaceId: 'w', permissions: { pageScope: { all: true as const, ids: [] as string[] } } };
beforeEach(() => { vi.clearAllMocks(); state.scope.mockResolvedValue({ ids: [], dropped: 0, source: 'none', channels: [] }); });

describe('Inbox honours the sidebar channel scope', () => {
  it('narrows what the services may read to the channels chosen in the sidebar', async () => {
    state.scope.mockResolvedValue({ ids: ['a', 'b'], dropped: 0, source: 'url', channels: [] });
    const scope = await inboxScope(member, 'a,b');
    expect(scope.constraints).toEqual({ allowedChannelIds: ['a', 'b'] });
    expect(scope.param).toBe('a,b');
    expect(state.scope).toHaveBeenCalledWith(member, { channel: 'a,b' });
    // A workspace owner with no member restriction is narrowed the same way.
    expect((await inboxScope(owner, 'a,b')).constraints).toEqual({ allowedChannelIds: ['a', 'b'] });
  });

  it('falls back to the member’s own access when the whole workspace is in view', async () => {
    expect((await inboxScope(member, undefined)).constraints).toEqual({ allowedChannelIds: ['a', 'b', 'c'] });
    expect((await inboxScope(owner, undefined)).constraints).toBeUndefined();
  });

  it('does not put a remembered (cookie) scope into links, only a scope from the address', async () => {
    state.scope.mockResolvedValue({ ids: ['a'], dropped: 0, source: 'cookie', channels: [] });
    const scope = await inboxScope(member, undefined);
    expect(scope.constraints).toEqual({ allowedChannelIds: ['a'] });
    expect(scope.param).toBeUndefined();
  });

  it('continues a long list under the same scope and never reads the scope as a single-channel filter', async () => {
    state.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w', permissions: member.permissions });
    state.scope.mockResolvedValue({ ids: ['a', 'b'], dropped: 0, source: 'url', channels: [] });
    state.read.mockResolvedValue({ items: [], olderCursor: null, newerCursor: null, cursor: null, total: 0, limit: 20, filters: { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '' }, quick: [], channels: [], timeZone: 'UTC', lastSynced: null, limits: {} });
    await loadMoreInboxRows({ channel: 'a,b', q: 'hello', cursor: 'position-20' });
    expect(state.read).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { q: 'hello', cursor: 'position-20' }, { allowedChannelIds: ['a', 'b'] });
  });

  it('has no channel picker in the Filter button and keeps the scope in the form', () => {
    const html = renderToStaticMarkup(h(InboxCopyProvider, { catalog: inboxCustomerCopy, children: h(InboxFilterRow, { action: '/inbox', resetHref: '/inbox', scope: 'a,b', locale: 'en', disabledLimit: false, activeCount: 0, filters: { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '' } }) }));
    expect(html).toContain('<input type="hidden" name="channel" value="a,b"/>');
    expect(html.match(/<input[^>]*name="channel"/g)).toHaveLength(1);
  });
});
