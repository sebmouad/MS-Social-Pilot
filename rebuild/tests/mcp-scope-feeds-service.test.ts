import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedRow } from '../src/modules/feeds/server/feeds';

const state = vi.hoisted(() => ({
  permissions: vi.fn(), entitlements: vi.fn(), role: 'admin', active: true,
  rows: [] as Array<FeedRow & { workspaceId: string }>, writes: [] as string[],
}));
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() }, membership: { findFirst: vi.fn() },
  $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/entitlements', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/entitlements')>(), loadEntitlements: state.entitlements,
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  const { CONFIG_BY_KEY } = await import('../src/lib/config/registry');
  return CONFIG_BY_KEY.get(key)?.defaultValue;
} }));
vi.mock('../src/server/data-control/guard', () => ({
  assertWorkspaceNotPurging: vi.fn(), withWorkspaceOperation: async (_id: string, run: () => Promise<unknown>) => run(),
}));
vi.mock('../src/modules/installed-mcp', async () => ({ installedMcpGroups: () => FEEDS_MCP }));

import { FEEDS_MCP } from '../src/modules/feeds/mcp';
import { readFeeds, deleteFeed } from '../src/modules/feeds/server/feeds';
import { resolvePermissions } from '../src/server/permissions';
import { handleMcpMessage } from '../src/server/mcp/server';
import type { McpViewer } from '../src/server/mcp/types';
import type { Entitlements } from '../src/server/entitlements';
import { MODULES, PAGES } from '../src/lib/product';

const grants = (ids?: string[], role = 'admin') => ({ ...resolvePermissions({
  role, allPages: ids === undefined, pageAccess: (ids ?? []).map(targetId => ({ targetId })),
  workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [],
}), pageScope: ids === undefined ? { all: true as const } : { all: false as const, ids } });
const entitlements: Entitlements = {
  workspaceId: 'workspace-a',
  modules: Object.fromEntries(MODULES.map(module => [module.id, true])) as Entitlements['modules'],
  features: Object.fromEntries(PAGES.map(page => [page.id, true])) as Entitlements['features'],
  platformCapabilities: {},
};
const viewer = (ids: string[]): McpViewer => ({
  scope: 'workspace', userId: 'example-user', workspaceId: 'workspace-a', role: 'admin',
  workspace: { id: 'workspace-a', name: 'Example studio', timezone: 'UTC' },
  apiKeyId: 'example-key', resourceRestricted: true, maxResultItems: 100,
  permissions: grants(ids), entitlements, allowedAdAccountIds: [],
});
const actor = (who: McpViewer) => ({ userId: who.userId, workspaceId: who.workspaceId, allowedTargetIds: who.permissions!.pageScope.all ? undefined : who.permissions!.pageScope.ids });
const rpc = async (who: McpViewer, method: string, params: Record<string, unknown> = {}) =>
  (await handleMcpMessage(who, { jsonrpc: '2.0', id: 1, method, params })).json();
const call = (who: McpViewer, name: string, args: Record<string, unknown> = {}) => rpc(who, 'tools/call', { name, arguments: args });
const date = new Date('2026-10-01T12:00:00.000Z');
const row = (id: string, targetIds: string[], workspaceId = 'workspace-a'): FeedRow & { workspaceId: string } => ({
  id, workspaceId, targetIds, name: id, url: `https://example.test/${id}`, kind: 'rss', enabled: true,
  messageTemplate: '{title}', hashtags: '', autoApprove: false, spreadMinutes: 0, pollErrorCount: 0,
  lastPolledAt: null, lastError: null, lastEtag: null, lastModified: null, ingestFrom: date, createdAt: date, updatedAt: date,
});
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  vi.clearAllMocks(); state.writes = []; state.role = 'admin'; state.active = true;
  state.rows = [row('allowed', ['channel-a']), row('sibling', ['channel-b']), row('mixed', ['channel-a', 'channel-b']), row('workspace-wide', []), row('foreign', ['channel-a'], 'workspace-b')];
  state.permissions.mockImplementation(async () => grants(undefined, state.role));
  state.entitlements.mockResolvedValue(entitlements);
  db.user.findUnique.mockImplementation(async () => state.active ? { disabledAt: null } : null);
  db.membership.findFirst.mockImplementation(async () => ({ role: state.role }));
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  // Storage doubles enforce the SQL workspace/id parameters; authorization and feed filtering are real.
  db.$queryRawUnsafe.mockImplementation(async (_sql: string, workspaceId: string) => state.rows.filter(feed => feed.workspaceId === workspaceId));
  db.$queryRaw.mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) => {
    const text = sql.join('?');
    if (text.includes('FROM memberships')) return state.active ? [{ role: state.role, disabledAt: null }] : [];
    if (text.includes('FROM feed_sources')) return state.rows.filter(feed => feed.id === values[0] && feed.workspaceId === values[1]);
    return [];
  });
  db.$executeRaw.mockImplementation(async (sql: TemplateStringsArray) => { state.writes.push(sql.join('?')); return 1; });
});

describe('MCP feeds use the actual UI/REST service and current authority', () => {
  it.each([{ ids: ['channel-a'] }, { ids: ['channel-b'] }, { ids: [] }, { ids: ['foreign-channel'] }])('tool and resource equal the shared read service for ceiling $ids', async ({ ids }) => {
    const who = viewer(ids);
    const expected = wire(await readFeeds(actor(who)));
    const tool = await call(who, 'list_content_feeds');
    expect(tool.result.isError).not.toBe(true);
    expect(tool.result.structuredContent).toEqual(expected);
    const resource = await rpc(who, 'resources/read', { uri: 'msp://feeds/sources' });
    expect(resource.error).toBeUndefined();
    expect(JSON.parse(resource.result.contents[0].text)).toEqual(expected);
    expect(JSON.stringify(tool)).not.toMatch(/mixed|workspace-wide|foreign/);
    expect(state.writes).toEqual([]);
  });

  it('intersects the key ceiling with freshly narrowed membership on both transports', async () => {
    const who = viewer(['channel-a', 'channel-b']);
    state.permissions.mockResolvedValue(grants(['channel-b']));
    expect((await call(who, 'list_content_feeds')).result.structuredContent.feeds.map((feed: { id: string }) => feed.id)).toEqual(['sibling']);
    expect((await readFeeds(actor(who))).feeds.map(feed => feed.id)).toEqual(['sibling']);
    state.permissions.mockResolvedValue(grants([]));
    const resource = await rpc(who, 'resources/read', { uri: 'msp://feeds/sources' });
    expect(JSON.parse(resource.result.contents[0].text).feeds).toEqual([]);
  });

  it.each(['sibling', 'mixed', 'workspace-wide', 'foreign', 'unknown'])('refuses a correctly confirmed out-of-scope deletion of %s before any write', async id => {
    const who = viewer(['channel-a']);
    const args = { id, confirmation: `DELETE FEED ${id}` };
    await expect(deleteFeed(actor(who), args)).rejects.toMatchObject({ code: 'not_found' });
    const response = await call(who, 'delete_content_feed', args);
    expect(response.result.structuredContent.code).toBe('not_found');
    expect(state.writes).toEqual([]);
  });

  it('rechecks narrowed membership inside deletion despite a stale MCP viewer', async () => {
    const who = viewer(['channel-a']);
    state.permissions.mockResolvedValue(grants(['channel-b']));
    expect((await call(who, 'delete_content_feed', { id: 'allowed', confirmation: 'DELETE FEED allowed' })).result.structuredContent.code).toBe('not_found');
    expect(state.writes).toEqual([]);
  });

  it('returns the same successful deletion as the shared service plus an MCP audit receipt', async () => {
    const who = viewer(['channel-a']);
    const args = { id: 'allowed', confirmation: 'DELETE FEED allowed' };
    const expected = await deleteFeed(actor(who), args);
    state.writes = [];
    const result = (await call(who, 'delete_content_feed', args)).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ ...expected, mcpAuditRecorded: true });
    expect(state.writes.some(sql => sql.includes('DELETE FROM feed_sources'))).toBe(true);
    expect(state.writes.some(sql => sql.includes('activity_logs'))).toBe(true);
    expect(state.writes.some(sql => sql.includes('root_activities'))).toBe(true);
  });

  const actions = [
    ['create_content_feed', { name: 'Example', url: 'https://example.test/feed', targetIds: ['channel-a'] }, 'CREATE FEED Example'],
    ['update_content_feed', { id: 'allowed', name: 'Example', url: 'https://example.test/feed', targetIds: ['channel-a'] }, 'UPDATE FEED allowed'],
    ['delete_content_feed', { id: 'allowed' }, 'DELETE FEED allowed'],
    ['check_content_feed', { id: 'allowed', mode: 'drafts' }, 'CREATE FEED DRAFTS allowed'],
    ['check_content_feed', { id: 'allowed', mode: 'posts' }, 'CREATE FEED POSTS allowed'],
  ] as const;
  it.each(actions)('%s requires exact confirmation before authorization/storage', async (name, args, exact) => {
    for (const confirmation of [undefined, true, `${exact} `, exact.toLowerCase(), `${exact} other`]) {
      const response = await call(viewer(['channel-a']), name, { ...args, confirmation });
      expect(response.result.structuredContent.code).toBe('invalid_request');
    }
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it('refuses revoked current read/write authority even when the key snapshot still grants it', async () => {
    const who = viewer(['channel-a']);
    state.active = false;
    expect((await call(who, 'list_content_feeds')).result.structuredContent.code).toBe('unauthorized');
    expect((await call(who, 'delete_content_feed', { id: 'allowed', confirmation: 'DELETE FEED allowed' })).result.structuredContent.code).toBe('unauthorized');
    expect(state.writes).toEqual([]);
  });
});
