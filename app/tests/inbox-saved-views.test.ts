import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn(), transaction: vi.fn(), authorize: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw, $transaction: mocks.transaction } }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));

import { INBOX_SAVED_VIEW_BOUNDS, deleteInboxSavedViewConfirmation, inboxSavedViewCopy, normalizeInboxSavedViewQuery } from '@/modules/inbox/saved-views';
import { executeInboxSavedViewTool, inboxSavedViewToolDefinitions } from '@/modules/inbox/saved-views-mcp';
import { createInboxSavedView, deleteInboxSavedView, listInboxSavedViews } from '@/modules/inbox/server/saved-views';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const row = { id: 'view-a', name: 'Open comments', query: 'status=open&type=comment', createdAt: new Date('2026-10-22T00:00:00Z') };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ channels: [], channelIds: [], timeZone: 'UTC' });
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM saved_views WHERE')) return [row];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(1) }];
    if (sql.includes('INSERT INTO saved_views')) return [row];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw }));
});

describe('inbox saved view filters', () => {
  it('keeps only known triage filters in a stable order', () => {
    expect(normalizeInboxSavedViewQuery('status=open&type=comment&q=hello&quick=unread,negative')).toBe('q=hello&quick=unread%2Cnegative&status=open&type=comment');
    expect(normalizeInboxSavedViewQuery('type=all')).toBeNull();
    expect(normalizeInboxSavedViewQuery('type=comment&type=review')).toBeNull();
    expect(normalizeInboxSavedViewQuery('thread=comment%3Aabc')).toBe('');
    expect(normalizeInboxSavedViewQuery(`q=${'x'.repeat(INBOX_SAVED_VIEW_BOUNDS.maxQuery)}`)).toBeNull();
    expect(normalizeInboxSavedViewQuery('quick=unread,nope')).toBeNull();
  });

  it('ships view copy in English and French', () => {
    expect(inboxSavedViewCopy('fr').saveView).toBe('Enregistrer les filtres actuels');
    expect(inboxSavedViewCopy('en').saveView).toBe('Save current filters');
  });
});

describe('inbox saved view service', () => {
  it('lists the viewer’s own inbox views with relative addresses', async () => {
    const result = await listInboxSavedViews(actor);
    expect(result.views).toEqual([{ id: 'view-a', name: 'Open comments', query: 'status=open&type=comment', href: '/inbox?status=open&type=comment', createdAt: row.createdAt.toISOString() }]);
    const select = (mocks.queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(select).toContain(`screen =`);
  });

  it('saves normalized filters up to the per-screen limit', async () => {
    const result = await createInboxSavedView(actor, { name: ' Open comments ', query: 'thread=comment%3Aabc&status=open&type=comment' });
    expect(result.view.name).toBe('Open comments');
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => (strings.join('?').includes('COUNT(*)') ? [{ count: BigInt(INBOX_SAVED_VIEW_BOUNDS.maxPerScreen) }] : []));
    await expect(createInboxSavedView(actor, { name: 'x', query: 'status=open' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(createInboxSavedView(actor, { name: 'x', query: 'type=nope' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('deletes only with the exact confirmation and reports strangers as missing', async () => {
    await expect(deleteInboxSavedView(actor, { id: 'view-a', confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await deleteInboxSavedView(actor, { id: 'view-a', confirmation: deleteInboxSavedViewConfirmation('view-a') })).toEqual({ id: 'view-a', deleted: true });
    mocks.executeRaw.mockResolvedValue(0);
    await expect(deleteInboxSavedView(actor, { id: 'view-a', confirmation: deleteInboxSavedViewConfirmation('view-a') })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('inbox saved view MCP tools', () => {
  it('exposes list, create and delete through the owning service', async () => {
    expect(inboxSavedViewToolDefinitions.map(tool => tool.name)).toEqual(['list_inbox_saved_views', 'create_inbox_saved_view', 'delete_inbox_saved_view']);
    expect(((await executeInboxSavedViewTool(actor, 'list_inbox_saved_views', {})) as { views: unknown[] }).views).toHaveLength(1);
    await expect(executeInboxSavedViewTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
