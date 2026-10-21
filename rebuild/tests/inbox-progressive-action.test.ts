import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn(), writer: true, previewLimit: 180 }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => state.previewLimit }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/modules/inbox/server/read', () => ({ readInboxList: state.read }));
vi.mock('@/modules/inbox/server/actions', () => ({ canManageInbox: async () => state.writer, canManageInboxWorkflow: async () => state.writer }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxCapabilities: async () => ({ reply: true, hide: true, remove: true }) }));
vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
vi.mock('../src/modules/inbox/ui/locale', () => ({ inboxLocale: async () => 'en' }));
import { loadMoreInboxRows } from '../src/modules/inbox/ui/list-action';
import { InboxSelectionProvider } from '../src/modules/inbox/ui/InboxSelection';
import type { InboxListItem, InboxListPage } from '../src/modules/inbox/server/types';

// Synthetic data only: ten selected Facebook Pages, alternating public comments
// and Messenger conversations, with explicit unread/reply/hidden/resolution facts.
const names = ['Atlas Kitchen', 'Rabat Reads', 'Casablanca Studio', 'Safi Ceramics', 'Fes Table', 'Essaouira Market', 'Marrakech Garden', 'Tangier Coffee', 'Agadir Walks', 'Meknes Bakery'];
const channels = names.map((name, index) => ({ id: `page-${index}`, name }));
const items: InboxListItem[] = Array.from({ length: 80 }, (_, index) => {
  const kind = index % 2 ? 'comment' : 'message'; const id = `activity-${index}`;
  return { key: `${kind}:${id}`, id, kind, author: `Visitor ${index + 1}`, preview: index % 2 ? 'Can I reserve two places for Saturday?' : 'Thanks for the opening hours. Is Sunday available?', time: new Date(Date.UTC(2026, 9, 21, 12, 0, -index)), target: { ...channels[index % channels.length], provider: 'facebook' }, unread: kind === 'message' ? index % 4 : 0, needsReply: index % 3 === 0, resolved: index % 7 === 0, hidden: kind === 'comment' && index % 5 === 0, context: kind === 'comment' ? 'Saturday workshop' : null, rating: null, recommendation: null, sentiment: kind === 'comment' ? 'positive' : null };
});
function page(offset = 0): InboxListPage {
  return { items: items.slice(offset, offset + 20), total: items.length, limit: 20, cursor: offset ? `position-${offset}` : null, olderCursor: offset + 20 < items.length ? `position-${offset + 20}` : null, newerCursor: offset ? `newer-${offset}` : null, filters: { channelId: null, kind: 'all', state: 'all', hidden: 'all', q: '' }, channels, timeZone: 'Africa/Casablanca', limits: { listPageSize: 20, threadPageSize: 50, searchMaxCharacters: 200, cursorMaxCharacters: 4096, bulkMaxItems: 20 }, lastSynced: new Date('2026-10-21T11:58:00Z') };
}
beforeEach(() => {
  vi.clearAllMocks(); state.writer = true; state.previewLimit = 180;
  state.viewer.mockResolvedValue({ user: { id: 'reader' }, workspaceId: 'workspace', permissions: { pageScope: { all: true, ids: [] } } });
  state.read.mockImplementation(async (_actor, input: { cursor?: string }) => page(Number(input.cursor?.replace('position-', '') ?? 0)));
});

describe('Inbox progressive entry point on ten-Page fixtures', () => {
  it('keeps newest-first service order, channel identities, unread facts and row navigation across all pages', async () => {
    const keys: string[] = []; const dates: number[] = [];
    let cursor: string | null = null;
    do {
      const result = await loadMoreInboxRows({ status: 'all', hidden: 'all', ...(cursor ? { cursor } : {}), limit: '20' });
      expect(result.ok).toBe(true); if (!result.ok) throw new Error('Expected a rendered page');
      keys.push(...result.rows.map(row => row.key));
      dates.push(...page(Number(cursor?.replace('position-', '') ?? 0)).items.map(item => item.time.getTime()));
      const html = renderToStaticMarkup(h(InboxSelectionProvider, { pageItems: result.rows.flatMap(row => row.selectable ? [row.selectable] : []), children: h('ul', null, result.rows.map(row => row.content)) }));
      for (const channel of channels) expect(html).toContain(channel.name);
      expect(html).toContain('Saturday'); expect(html).toContain('unread');
      expect(html).toContain('data-inbox-item'); expect(html).toContain('type="checkbox"');
      cursor = result.olderCursor;
    } while (cursor);
    expect(keys).toEqual(items.map(item => item.key)); expect(new Set(keys).size).toBe(80);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(state.viewer).toHaveBeenCalledTimes(4);
    expect(state.read).toHaveBeenLastCalledWith({ userId: 'reader', workspaceId: 'workspace' }, { state: 'all', hidden: 'all', cursor: 'position-60', limit: 20 }, undefined);
  });
  it('applies the runtime preview ceiling to continuation rows', async () => {
    state.previewLimit = 12;
    const result = await loadMoreInboxRows({ cursor: 'position-20' });
    expect(result.ok).toBe(true); if (!result.ok) throw new Error('Expected rows');
    const html = renderToStaticMarkup(h(InboxSelectionProvider, { pageItems: [], children: h('ul', null, result.rows.map(row => row.content)) }));
    expect(html).toContain('Can I reserv…');
    expect(html).not.toContain('Can I reserve two places');
  });

  it.each(['owner', 'member', 'viewer'])('keeps %s authority and forwards the current session channel ceiling', async role => {
    state.writer = role !== 'viewer';
    state.viewer.mockResolvedValue({ user: { id: role }, workspaceId: 'workspace', permissions: { pageScope: { all: role === 'owner', ids: ['page-0', 'page-1'] } } });
    const result = await loadMoreInboxRows({ quick: 'unread,unanswered', channel: 'page-0', q: 'Saturday', cursor: 'position-20' });
    expect(result.ok).toBe(true); if (!result.ok) throw new Error('Expected a rendered page');
    expect(state.read).toHaveBeenCalledWith({ userId: role, workspaceId: 'workspace' }, { channelId: 'page-0', q: 'Saturday', cursor: 'position-20', quick: ['unread', 'unanswered'] }, role === 'owner' ? undefined : { allowedChannelIds: ['page-0', 'page-1'] });
    expect(result.rows.every(row => Boolean(row.selectable) === state.writer)).toBe(true);
  });
  it('stops before reads on session loss and masks rejected cross-workspace/stale cursors', async () => {
    state.viewer.mockRejectedValueOnce(new Error('Session ended'));
    expect(await loadMoreInboxRows({ cursor: 'position-20' })).toEqual({ ok: false });
    expect(state.read).not.toHaveBeenCalled();
    // The reader owns cross-workspace/cursor refusal; the entry point must neither
    // fall back to a wider read nor leak the underlying failure to the customer.
    state.read.mockRejectedValueOnce(new Error('private database failure'));
    expect(await loadMoreInboxRows({ cursor: 'foreign-position' })).toEqual({ ok: false });
    expect(state.read).toHaveBeenCalledTimes(1);
  });
});
