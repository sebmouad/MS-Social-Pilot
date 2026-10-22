import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn() }, config: vi.fn(), purging: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), canModule: vi.fn(), canFeature: vi.fn(), canAccess: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfigBatch: mocks.config, runtimeConfig: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purging }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccess }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseModule: mocks.canModule, canUseFeature: mocks.canFeature }));

import { listWorkspaceActivity, listWorkspaceEmails } from '../src/modules/history/server/history';
import { HISTORY_MCP } from '../src/modules/history/mcp';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const policy: Record<string, unknown> = {
  'history.pageSize': 2, 'history.maxOffset': 10, 'history.searchMaxCharacters': 10, 'history.detailMaxFields': 3, 'history.detailValueMaxCharacters': 12,
  'history.errorMaxCharacters': 40, 'history.recentFailureDays': 7, 'history.hiddenDetailKeys': ['token', 'secret'], 'root.auditRetentionDays': 30,
};
let role: string | null = 'owner'; let moduleOn = true; let featureOn = true; let allowed = true; let ceilingAllows = true;
let calls: Array<{ sql: string; values: unknown[] }> = [];
let activityRows: unknown[] = []; let emailRows: unknown[] = [];
const at = new Date('2026-10-21T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks(); role = 'owner'; moduleOn = true; featureOn = true; allowed = true; ceilingAllows = true; calls = [];
  activityRows = [{ id: 'a1', action: 'tasks.created', actorId: 'u1', actorName: 'Sara', detail: { title: 'Plan', secretKey: 'x', nested: { a: 1 }, token: 't', a: 1, b: 2, c: 3 }, createdAt: at }];
  emailRows = [{ id: 'e1', to: 'x@example.test', subject: 'Hi', template: 'invite', status: 'failed', error: 'SMTP rejected user@example.test with password=hunter2 and a very long trailing explanation', createdAt: at }];
  mocks.config.mockImplementation(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, policy[key]])));
  mocks.purging.mockResolvedValue(undefined);
  mocks.permissions.mockResolvedValue({ marker: 'current' });
  mocks.entitlements.mockResolvedValue({ workspaceId: 'workspace-a' });
  mocks.canModule.mockImplementation(() => moduleOn);
  mocks.canFeature.mockImplementation(() => featureOn);
  mocks.canAccess.mockImplementation((p: { marker?: string }) => p.marker === 'current' ? allowed : ceilingAllows);
  mocks.prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?'); calls.push({ sql, values });
    if (sql.includes('FROM memberships')) return role ? [{ role, timezone: 'Europe/Paris' }] : [];
    if (sql.includes('FROM activity_logs')) return activityRows;
    if (sql.includes('COUNT(*)')) return [{ count: 3 }];
    if (sql.includes('FROM email_logs')) return emailRows;
    return [];
  });
});

describe('History authorization (service boundary)', () => {
  it.each(['owner', 'admin'])('lets a workspace %s read activity and emails', async value => {
    role = value;
    await expect(listWorkspaceActivity(actor)).resolves.toMatchObject({ items: [{ id: 'a1' }] });
    await expect(listWorkspaceEmails(actor)).resolves.toMatchObject({ items: [{ id: 'e1' }] });
  });
  it.each(['editor', 'contributor', 'viewer', 'client'])('refuses a %s member before reading any log', async value => {
    role = value;
    await expect(listWorkspaceActivity(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listWorkspaceEmails(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls.every(call => call.sql.includes('FROM memberships'))).toBe(true);
  });
  it('refuses a person with no membership in the workspace (cross-workspace read)', async () => {
    role = null;
    await expect(listWorkspaceActivity({ userId: 'user-a', workspaceId: 'workspace-b' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls.some(call => call.sql.includes('FROM activity_logs'))).toBe(false);
  });
  it('refuses when the module, the feature or the member permission is off', async () => {
    moduleOn = false; await expect(listWorkspaceActivity(actor)).rejects.toMatchObject({ code: 'forbidden' });
    moduleOn = true; featureOn = false; await expect(listWorkspaceActivity(actor)).rejects.toMatchObject({ code: 'forbidden' });
    featureOn = true; allowed = false; await expect(listWorkspaceEmails(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('a key ceiling can only narrow: an owner with a ceiling that denies History is refused', async () => {
    ceilingAllows = false;
    await expect(listWorkspaceActivity({ ...actor, permissionCeiling: { marker: 'ceiling' } as never })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('always scopes the query to the authorized workspace, never to input', async () => {
    await listWorkspaceActivity(actor, { q: 'tasks' });
    const read = calls.find(call => call.sql.includes('FROM activity_logs'))!;
    expect(read.values).toContain('workspace-a');
    await expect(listWorkspaceActivity(actor, { workspaceId: 'workspace-b' })).rejects.toMatchObject({ code: 'invalid_request' });
    await listWorkspaceEmails(actor);
    for (const call of calls.filter(entry => entry.sql.includes('email_logs'))) expect(call.values).toContain('workspace-a');
  });
});

describe('History reads', () => {
  it('shows scalar details only, hides secret-like keys, cuts values and reports who did it', async () => {
    const result = await listWorkspaceActivity(actor);
    expect(result.items[0]).toMatchObject({ actorName: 'Sara', hadActor: true, createdAt: at.toISOString() });
    expect(result.items[0]!.details.map(item => item.key)).toEqual(['title', 'a', 'b']);
    expect(result).toMatchObject({ timeZone: 'Europe/Paris', retentionDays: 30, hasMore: false, pageSize: 2 });
  });
  it('marks deleted people and automatic work apart', async () => {
    activityRows = [{ id: 'a2', action: 'x.y', actorId: 'gone', actorName: null, detail: null, createdAt: at }, { id: 'a3', action: 'x.z', actorId: null, actorName: null, detail: null, createdAt: at }];
    const result = await listWorkspaceActivity(actor);
    expect(result.items.map(item => [item.actorName, item.hadActor])).toEqual([[null, true], [null, false]]);
  });
  it('pages with offset/hasMore and caps the page by Root size and the MCP ceiling', async () => {
    activityRows = [{ id: '1' }, { id: '2' }, { id: '3' }].map(row => ({ ...row, action: 'a', actorId: null, actorName: null, detail: null, createdAt: at }));
    const page = await listWorkspaceActivity(actor, { limit: 50 });
    expect(page.items).toHaveLength(2); expect(page.hasMore).toBe(true);
    const capped = await listWorkspaceActivity(actor, {}, 1);
    expect(capped.items).toHaveLength(1);
    await expect(listWorkspaceActivity(actor, { offset: 11 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listWorkspaceActivity(actor, { q: 'x'.repeat(11) })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('removes addresses and secrets from delivery problems and counts recent failures', async () => {
    const result = await listWorkspaceEmails(actor, { problemsOnly: true });
    expect(result.items[0]!.error).not.toMatch(/user@example|hunter2/);
    expect(result.items[0]!.error!.length).toBeLessThanOrEqual(40);
    expect(result).toMatchObject({ recentFailures: 3, recentFailureDays: 7 });
  });
});

describe('History MCP tools', () => {
  const [group] = HISTORY_MCP;
  const viewer = { userId: 'user-a', workspaceId: 'workspace-a', role: 'owner' } as never;
  it('declares read-only manager tools on the settings/history feature', () => {
    expect(group!.tools.map(tool => tool.name)).toEqual(['list_workspace_activity', 'list_workspace_email_log']);
    expect(Object.values(group!.features)).toEqual(['settings/history', 'settings/history']);
    expect(group!.writeTools).toBeUndefined();
    expect(group!.managers?.[0]?.hideFromList).toBe(true);
  });
  it('run through the same service and its authorization', async () => {
    await expect(group!.execute(viewer, 'list_workspace_activity', {}, 5)).resolves.toMatchObject({ items: [{ id: 'a1' }] });
    role = 'viewer';
    await expect(group!.execute(viewer, 'list_workspace_email_log', {}, 5)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(group!.execute(viewer, 'nope', {}, 5)).rejects.toMatchObject({ code: 'not_found' });
  });
});
