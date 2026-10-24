// @vitest-environment jsdom
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn(), thread: vi.fn(), manage: vi.fn(), workflow: vi.fn(), toolbar: vi.fn(), language: 'en' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/modules/shell/server/chrome', () => ({ shellChrome: async () => ({ copy: { moreTabs: 'More' }, policy: {}, locale: 'en' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'inbox.progressivePageLimit' ? 3 : 180 }));
vi.mock('@/modules/inbox/server/details', () => ({ readInboxContactDetails: async () => null }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/inbox/ui/scope', () => ({ inboxScope: async (viewer: { permissions: { pageScope: { all: boolean; ids: string[] } } }, param?: string) => ({ ids: [], constraints: viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids }, param }) }));
vi.mock('../src/modules/inbox/server/read', () => ({ readInboxList: state.list, readInboxThread: state.thread }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children }: { children: import('react').ReactNode }) => h('main', null, children) }));
vi.mock('@/modules/inbox/server/actions', () => ({ canManageInbox: state.manage, canManageInboxWorkflow: state.workflow }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: async () => ({ reply: true, hide: true, remove: true }) }));
vi.mock('@/modules/inbox/server/policy', () => ({ inboxReplyPolicy: async () => ({ allowed: true, headline: 'Replies are open' }) }));
vi.mock('../src/modules/inbox/ui/InboxActions', () => ({ InboxSyncBar: () => null, ReplyBox: () => null, ThreadToolbar: (props: { kind: string; canResolve: boolean; canHide: boolean; canDelete: boolean }) => { state.toolbar(props); return h('div', { 'data-toolbar-kind': props.kind }); } }));

import InboxPage from '../src/modules/inbox/ui/InboxScreen';
import { inboxCustomerCopy } from '../src/modules/inbox/customer-copy';
import { inboxKindCounts } from '../src/modules/inbox/server/types';

const item = (kind: 'message' | 'comment' | 'review', id: string) => ({
  key: `${kind}:${id}`, kind, id, author: `Person ${id}`, preview: `Preview ${id}`, time: new Date('2026-10-21T12:00:00Z'),
  target: { id: 'channel', name: 'Example', provider: 'facebook' }, unread: kind === 'message' ? 2 : 0, needsReply: kind !== 'review',
  resolved: false, hidden: false, context: null, rating: kind === 'review' ? 5 : null, recommendation: null, sentiment: null,
});
const listPage = {
  items: [item('message', 'm1'), item('comment', 'c1'), item('review', 'r1')], total: 3, limit: 2, cursor: null,
  olderCursor: null, newerCursor: null, filters: { channelId: null, kind: 'message', state: 'open', hidden: 'visible', q: '' },
  channels: [{ id: 'channel', name: 'Example' }], lastSynced: new Date('2026-10-21T12:00:00Z'), timeZone: 'UTC',
  limits: { listPageSize: 25, threadPageSize: 50, searchMaxCharacters: 200, cursorMaxCharacters: 4096 },
  totals: { message: 4, comment: 7, review: 1 }, unread: { message: 3, comment: 0, review: 0 },
};
const threadEntry = { id: 'entry', author: 'Visitor', text: 'Stored history', time: new Date('2026-10-16T00:00:00Z'), fromChannel: false, sentBy: null, parentId: null, depth: 0, hidden: false };
const threadPage = (kind: 'message' | 'comment' | 'review') => ({
  thread: { kind, id: 'thread', rating: null, recommendation: null, target: { id: 'channel', name: 'Example', providerId: 'remote', provider: 'facebook' }, resolved: false, hidden: false, postText: kind === 'comment' ? 'The post' : null, entries: [threadEntry], lastInbound: null },
  history: { total: 1, shown: 1, limit: 50, cursor: null, olderCursor: null, newerCursor: null },
});

beforeEach(() => {
  vi.clearAllMocks(); state.language = 'en';
  state.viewer.mockResolvedValue({ user: { id: 'reader' }, workspaceId: 'workspace', permissions: { pageScope: { all: true, ids: [] } }, membership: { workspace: { timezone: 'UTC' } } });
  state.list.mockResolvedValue(listPage);
  state.thread.mockResolvedValue(threadPage('message'));
  state.manage.mockResolvedValue(true); state.workflow.mockResolvedValue(true);
});
const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await InboxPage({ searchParams: Promise.resolve(params) }));
const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll('&amp;', '&'), 'http://preview.test'));

describe('inbox kind separation', () => {
  it('defaults to the explicit Messages list and folds legacy mixed links into it', async () => {
    await render({});
    expect(state.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'message' }), undefined);
    state.list.mockClear();
    await render({ type: 'all' });
    expect(state.list).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'message' }), undefined);
    const html = await render({ type: 'comment' });
    expect(state.list).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ kind: 'comment' }), undefined);
    expect(html).not.toContain('All types');
  });

  it('opens messages, comments and reviews as separate lists with per-kind totals and message unread', async () => {
    const html = await render({});
    expect(html).toContain('aria-label="Inbox lists: messages, comments, reviews"');
    expect(html).toContain('Messages · Open');
    expect(html).toContain('>4<'); expect(html).toContain('>7<'); expect(html).toContain('>1<');
    expect(html).toContain('3 unread');
    expect(html).toContain('data-kind="message"'); expect(html).toContain('data-kind="comment"'); expect(html).toContain('data-kind="review"');
    const tabs = links(html).filter(url => url.pathname === '/inbox' && url.searchParams.has('type') && !url.searchParams.has('thread'));
    const comments = tabs.find(url => url.searchParams.get('type') === 'comment');
    expect(comments).toBeDefined();
  });

  it('keeps channel scope and other filters when switching kinds, and drops cursors and the open thread', async () => {
    state.list.mockResolvedValue({ ...listPage, cursor: 'list-position', filters: { ...listPage.filters, state: 'all', q: 'hello' }, quick: ['unread'] });
    const html = await render({ channel: 'ch1', status: 'all', q: 'hello', quick: 'unread', cursor: 'list-position', thread: 'message:m1' });
    const tabs = links(html).filter(url => url.pathname === '/inbox' && url.searchParams.get('type') === 'comment' && !url.searchParams.has('thread'));
    expect(tabs.length).toBeGreaterThan(0);
    const target = tabs[0];
    expect(target.searchParams.get('channel')).toBe('ch1');
    expect(target.searchParams.get('status')).toBe('all');
    expect(target.searchParams.get('q')).toBe('hello');
    expect(target.searchParams.get('quick')).toBe('unread');
    expect(target.searchParams.has('cursor')).toBe(false);
    expect(target.searchParams.has('historyCursor')).toBe(false);
  });

  it('marks every row with icon, label and edge treatment, with reviews as a distinct third kind', async () => {
    const html = await render({});
    expect(html).toContain('data-group="message"'); expect(html).toContain('data-group="comment"'); expect(html).toContain('data-group="review"');
    expect(html).toContain('>Message<'); expect(html).toContain('>Comment<'); expect(html).toContain('>Review<');
    expect(html).toContain('5 out of 5 stars');
    const rowLinks = links(html).filter(url => url.searchParams.get('thread') === 'comment:c1');
    expect(rowLinks.length).toBeGreaterThan(0);
  });

  it('frames the open thread as a private conversation or a public thread with its audience', async () => {
    state.thread.mockResolvedValue(threadPage('message'));
    expect(await render({ thread: 'message:thread' })).toContain('Private conversation. Only you, your team and Visitor can see these messages.');
    state.thread.mockResolvedValue(threadPage('comment'));
    expect(await render({ thread: 'comment:thread' })).toContain('Public comment thread. Everyone who can see the post can read these comments and your replies.');
    state.thread.mockResolvedValue(threadPage('review'));
    expect(await render({ thread: 'review:thread' })).toContain('Public review. Everyone who can see the page can read it.');
  });

  it('keeps resolve and moderation controls on the open thread', async () => {
    state.thread.mockResolvedValue(threadPage('comment'));
    const html = await render({ thread: 'comment:thread' });
    expect(state.toolbar).toHaveBeenCalledWith(expect.objectContaining({ canResolve: true, canHide: true, canDelete: true }));
    expect(html).toContain('data-toolbar-kind="comment"');
  });

  it('shows distinct empty states per kind, each with its next action in the same list', async () => {
    state.list.mockResolvedValue({ ...listPage, items: [], total: 0, lastSynced: new Date('2026-10-21T12:00:00Z'), filters: { ...listPage.filters, kind: 'comment' } });
    const html = await render({ type: 'comment' });
    expect(html).toContain('No open comments');
    expect(html).toContain('messages and reviews have their own lists');
    const resolved = links(html).find(url => url.searchParams.get('status') === 'resolved');
    expect(resolved?.searchParams.get('type')).toBe('comment');
    state.list.mockResolvedValue({ ...listPage, items: [], total: 0, lastSynced: null, filters: { ...listPage.filters, kind: 'review' } });
    const empty = await render({ type: 'review' });
    expect(empty).toContain('Reviews left on your pages appear here after the first sync');
    state.list.mockResolvedValue({ ...listPage, items: [], total: 0, lastSynced: new Date('2026-10-21T12:00:00Z'), filters: { ...listPage.filters, kind: 'review', q: 'nope' } });
    const noMatch = await render({ type: 'review', q: 'nope' });
    expect(noMatch).toContain('Nothing matches these filters');
    expect(noMatch).toContain('Messages and comments live in their own lists');
    const reset = links(noMatch).find(url => url.pathname === '/inbox' && url.searchParams.get('type') === 'review' && !url.searchParams.has('q'));
    expect(reset).toBeDefined();
  });

  it('keeps the same distinctions in French', async () => {
    state.language = 'fr';
    state.list.mockResolvedValue({ ...listPage, items: [], total: 0, lastSynced: new Date('2026-10-21T12:00:00Z'), filters: { ...listPage.filters, kind: 'comment' } });
    const html = await render({ type: 'comment' });
    expect(html).toContain('Aucun commentaire ouvert');
    expect(html).toContain('les messages et les avis ont leurs propres listes');
    state.thread.mockResolvedValue(threadPage('message'));
    expect(await render({ thread: 'message:thread' })).toContain('Conversation privée.');
  });

  it('covers every new customer string in English and French', () => {
    for (const key of ['inboxCopy.listsLabel', 'inboxCopy.audiencePublic', 'inboxCopy.audiencePrivate.text',
      'inboxCopy.noMatchBodyMessage', 'inboxCopy.noMatchBodyComment', 'inboxCopy.noMatchBodyReview',
      'inboxCopy.noOpenMessagesTitle', 'inboxCopy.noOpenMessagesBody', 'inboxCopy.noOpenCommentsTitle', 'inboxCopy.noOpenCommentsBody',
      'inboxCopy.noOpenReviewsTitle', 'inboxCopy.noOpenReviewsBody', 'inboxCopy.emptyBodyMessage', 'inboxCopy.emptyBodyComment',
      'inboxCopy.emptyBodyReview', 'REPLY_COPY.privateNote', 'REPLY_COPY.publicNote', 'actionCopy.hideNote', 'reviewCopy.audience']) {
      expect(inboxCustomerCopy[key]?.en, key).toMatch(/\S/);
      expect(inboxCustomerCopy[key]?.fr, key).toMatch(/\S/);
    }
  });

  it('folds grouped count rows into per-kind totals', () => {
    expect(inboxKindCounts([{ kind: 'message', count: BigInt(4) }, { kind: 'comment', count: 7 }, { kind: 'review', count: BigInt(0) }, { kind: 'unknown', count: 9 }])).toEqual({ message: 4, comment: 7, review: 0 });
    expect(inboxKindCounts([])).toEqual({ message: 0, comment: 0, review: 0 });
  });
});
