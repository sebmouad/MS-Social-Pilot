import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn(), thread: vi.fn(), manage: vi.fn(), workflow: vi.fn(), toolbar: vi.fn() }));
vi.mock('@/modules/shell/server/chrome', () => ({ shellChrome: async () => ({ copy: { moreTabs: 'More' }, policy: {}, locale: 'en' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'inbox.progressivePageLimit' ? 3 : 180 }));
vi.mock('@/modules/inbox/server/details', () => ({ readInboxContactDetails: async () => null }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/inbox/server/read', () => ({ readInboxList: state.list, readInboxThread: state.thread }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ sidebar, children, scopedAccess }: { sidebar: import('react').ReactNode; children: import('react').ReactNode; scopedAccess?: boolean }) => createElement('main', { 'data-scoped-access': scopedAccess }, createElement('aside', null, sidebar), children) }));
vi.mock('@/modules/inbox/server/actions', () => ({ canManageInbox: state.manage, canManageInboxWorkflow: state.workflow }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: async () => ({ reply: false, hide: false, remove: false }) }));
vi.mock('@/modules/inbox/server/policy', () => ({ inboxReplyPolicy: async () => ({ allowed: false, headline: 'Read only' }) }));
vi.mock('../src/modules/inbox/ui/InboxActions', () => ({ InboxSyncBar: () => null, ReplyBox: () => null, ThreadToolbar: (props: { canResolve: boolean; canHide: boolean; canDelete: boolean }) => { state.toolbar(props); return createElement('div', { 'data-workflow': props.canResolve }); } }));
import InboxPage from '../src/modules/inbox/ui/InboxScreen';
import { InboxList } from '../src/modules/inbox/ui/InboxList';
import { OperationError } from '../src/lib/operation-error';
const listPage = { items: [], total: 8, limit: 2, cursor: 'list-position', olderCursor: 'list-older', newerCursor: 'list-newer', filters: { channelId: 'channel', kind: 'message', state: 'all', hidden: 'all', q: 'literal' }, channels: [{ id: 'channel', name: 'Example' }], lastSynced: null, timeZone: 'UTC', limits: { listPageSize: 25, threadPageSize: 50, searchMaxCharacters: 200, cursorMaxCharacters: 4096 } };
const threadPage = { thread: { kind: 'message', id: 'conversation', target: { id: 'channel', name: 'Example', providerId: 'remote', provider: 'facebook' }, resolved: false, hidden: false, postText: null, entries: [{ id: 'entry', author: 'Visitor', text: 'Stored history', time: new Date('2026-10-16T00:00:00Z'), fromChannel: false, sentBy: null }], lastInbound: null }, history: { total: 305, shown: 1, limit: 50, cursor: 'history-position', olderCursor: 'history-older', newerCursor: 'history-newer' } };
beforeEach(() => {
  vi.clearAllMocks(); state.viewer.mockResolvedValue({ user: { id: 'reader' }, workspaceId: 'workspace', permissions: { pageScope: { all: false, ids: ['channel'] } }, membership: { workspace: { timezone: 'UTC' } } }); state.list.mockResolvedValue(listPage); state.thread.mockResolvedValue(threadPage); state.manage.mockResolvedValue(false); state.workflow.mockResolvedValue(false);
});
const render = async (params = { thread: 'message:conversation', cursor: 'list-position', historyCursor: 'history-position' }) => renderToStaticMarkup(await InboxPage({ searchParams: Promise.resolve(params) }));
describe('Inbox paging and recoverable route context', () => {
  it('keeps both page positions while navigating and places controls in the existing sidebar', async () => {
    const html = await render();
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
    expect(html).toContain('data-scoped-access="true"');
    expect(state.thread).toHaveBeenCalledWith({ userId: 'reader', workspaceId: 'workspace' }, { key: 'message:conversation', cursor: 'history-position' }, { allowedChannelIds: ['channel'] });
    expect(html).toContain('name="thread" value="message:conversation"'); expect(html).toContain('1 of 305 stored messages shown');
    expect(html).toContain('outside the current list page'); expect(html).toContain('maxLength="200"');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&'), 'http://preview.test'));
    expect(links.some(url => url.searchParams.get('cursor') === 'list-older' && url.searchParams.get('historyCursor') === 'history-position')).toBe(true);
    expect(links.some(url => url.searchParams.get('historyCursor') === 'history-older' && url.searchParams.get('cursor') === 'list-position')).toBe(true);
  });
  it('invalidates appended rows when authorized channels change even if the first page is unchanged', async () => {
    const item = { key: 'message:conversation', kind: 'message', id: 'conversation', author: 'Nadia', preview: 'Saturday workshop', time: new Date('2026-10-21T12:00:00Z'), target: { id: 'channel', name: 'Atlas Kitchen', provider: 'facebook' }, unread: 1, needsReply: true, resolved: false, hidden: false, context: null, rating: null, recommendation: null, sentiment: null };
    const surfaceKey = (node: ReactNode): string | null => {
      if (Array.isArray(node)) return node.map(surfaceKey).find(Boolean) ?? null;
      if (!isValidElement<{ children?: ReactNode }>(node)) return null;
      return node.type === InboxList ? String(node.key) : surfaceKey(node.props.children);
    };
    state.list.mockResolvedValue({ ...listPage, items: [item], channels: [{ id: 'channel', name: 'Atlas Kitchen' }, { id: 'other', name: 'Rabat Reads' }] });
    const before = surfaceKey(await InboxPage({ searchParams: Promise.resolve({}) }));
    state.list.mockResolvedValue({ ...listPage, items: [item], channels: [{ id: 'channel', name: 'Atlas Kitchen' }] });
    const after = surfaceKey(await InboxPage({ searchParams: Promise.resolve({}) }));
    expect(before).toBeTruthy(); expect(after).toBeTruthy(); expect(after).not.toBe(before);
  });
  it('keeps local workflow controls when remote replies and moderation are unavailable', async () => {
    state.workflow.mockResolvedValue(true);
    const html = await render();
    expect(state.toolbar).toHaveBeenCalledWith(expect.objectContaining({ canResolve: true, canHide: false, canDelete: false }));
    expect(html).toContain('replying is unavailable for your role or this channel');
  });
  it('keeps a valid selected thread in reset recovery after invalid list cursor and masks unknown errors', async () => {
    state.list.mockRejectedValueOnce(new OperationError('invalid_request', 'Reset this Inbox cursor.'));
    const html = await render(); expect(html).toContain('Reset this Inbox cursor.'); expect(html).toContain('href="/inbox?thread=message%3Aconversation"');
    state.thread.mockRejectedValueOnce(new Error('postgres://private-password')); const failed = await render(); expect(failed).not.toContain('private-password'); expect(failed).toContain('could not be opened');
  });
  it('distinguishes a changed empty page from an empty inbox and provides Latest recovery', async () => {
    state.thread.mockRejectedValueOnce(new OperationError('not_found', 'Conversation unavailable.'));
    const html = await render(); expect(html).toContain('No items on this page'); expect(html).toContain('Inbox changed'); expect(html).toContain('Conversation unavailable.');
  });
});
