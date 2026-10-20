import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ query: vi.fn(), settings: vi.fn(), config: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn(), credential: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query, appSetting: { findMany: m.settings } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/entitlements', async () => ({ ...await vi.importActual<object>('@/server/entitlements'), loadEntitlements: m.entitlements }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: m.purge }));
vi.mock('@/modules/settings/person-keys/service', () => ({ assertPersonCredential: m.credential }));
import { handleMcpMessage } from '@/server/mcp/server';
import { resolvePermissions } from '@/server/permissions';
import { assertAgencyOverviewCredentialAccess } from './server/access';
const person = { scope: 'person' as const, userId: 'u', personKeyId: 'pk', readFeature: 'agency/overview' as const };
const features = ['agency/overview', 'settings/connections', 'publishing/posts', 'tasks/board', 'settings/team'];
let rows: Array<{ id: string; name: string; role: string; suspendedAt: Date | null; timezone: string }>;
let denied: Set<string>; let permissionsDenied: Set<string>; let limited: Set<string>;
const read = async (args = {}) => (await (await handleMcpMessage(person, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_agency_overview', arguments: args } })).json()).result;
beforeEach(() => {
 vi.clearAllMocks(); rows = ['a', 'b'].map(id => ({ id, name: id, role: 'owner', suspendedAt: null, timezone: 'UTC' })); denied = new Set(); permissionsDenied = new Set(); limited = new Set();
 m.credential.mockResolvedValue(undefined); m.settings.mockResolvedValue([]); m.purge.mockResolvedValue(undefined);
 m.config.mockImplementation(async key => ({ 'agency.workspaceLimit': 20, 'agency.failureWindowDays': 30, 'agency.clientListLimit': 20, 'agency.searchMaxLength': 200, 'agency.accessConcurrency': 8, 'agency.attentionWeightUnavailable': 1000, 'agency.attentionWeightDisconnected': 100, 'agency.attentionWeightFailed': 10, 'agency.attentionWeightOverdue': 1 }[key as string]));
 m.entitlements.mockImplementation(async (_u, id) => ({ workspaceId: id, modules: { agency: true }, features: Object.fromEntries(features.map(f => [f, !denied.has(id)])) }));
 m.permissions.mockImplementation(async (_u, id) => ({ ...resolvePermissions({ role: permissionsDenied.has(id) ? 'editor' : 'owner', workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }), pageScope: limited.has(id) ? { all: false, ids: [] } : { all: true } }));
 m.query.mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) => {
  const text = sql.join('');
  if (text.includes('FROM memberships m')) return rows;
  const ids = values.find(Array.isArray) as string[];
  const columns = text.includes('FROM targets') ? ['channels', 'disconnected'] : text.includes('FROM posts') ? ['scheduled', 'failed'] : text.includes('FROM tasks k') ? ['openTasks', 'overdueTasks'] : ['members', 'clients'];
  return ids.map(id => ({ id, ...Object.fromEntries(columns.map(c => [c, 0])) }));
 });
});
it('rechecks each workspace on each call and removes a lost membership without borrowing other workspace grants', async () => {
 expect((await read()).structuredContent.workspaces.map((w: {id: string}) => w.id).sort()).toEqual(['a', 'b']);
 rows = rows.filter(row => row.id === 'a');
 expect((await read()).structuredContent.workspaces.map((w: {id: string}) => w.id)).toEqual(['a']);
 const membershipCalls = m.query.mock.calls.filter(c => c[0].join('').includes('FROM memberships m'));
 expect(membershipCalls).toHaveLength(2);
 for (const call of membershipCalls) { expect(call.slice(1)).toContain('u'); expect(call[0].join('')).toContain("m.role::text IN ('owner', 'admin')"); expect(call[0].join('')).toContain('u."disabledAt" IS NULL'); }
 for (const id of ['a', 'b']) expect(m.entitlements).toHaveBeenCalledWith('u', id, { allowInstallationInspection: false });
});
it.each(['entitlements', 'role/permission', 'loader failure'])('omits a workspace after current %s changes', async cause => {
 await read();
 if (cause === 'entitlements') denied.add('b');
 if (cause === 'role/permission') permissionsDenied.add('b');
 if (cause === 'loader failure') m.entitlements.mockImplementation(async (_u, id) => { if (id === 'b') throw new Error('unreadable'); return { workspaceId: id, modules: { agency: true }, features: Object.fromEntries(features.map(f => [f, true])) }; });
 const result = (await read()).structuredContent; expect(result.workspaces.map((w: {id: string}) => w.id)).toEqual(['a']);
});
it('refuses when all current grants disappear and denies installation policy without metrics reads', async () => {
 denied.add('a'); denied.add('b'); expect((await read()).structuredContent.code).toBe('forbidden');
 m.query.mockClear(); m.settings.mockResolvedValue([{ key: 'entitlements.modules.agency', value: false, encrypted: false }]);
 expect((await read()).structuredContent.code).toBe('forbidden'); expect(m.query).not.toHaveBeenCalled();
});
it('keeps channel-scoped metrics unknown and purging workspace metrics withheld', async () => {
 limited.add('a'); m.purge.mockImplementation(async id => { if (id === 'b') throw new Error('purging'); });
 const result = (await read()).structuredContent;
 expect(result.workspaces.find((w: {id: string}) => w.id === 'a').metrics.channels).toBeNull();
 expect(result.workspaces.find((w: {id: string}) => w.id === 'b')).toMatchObject({ state: 'deleting', metrics: null });
 expect(result.totals.channels).toBeNull();
});
it('refuses invalid filters, supplied workspace ids and unsupported exports', async () => {
 for (const args of [{ workspaceId: 'foreign' }, { readFeature: 'settings/team' }, { sort: 'bad' }, { format: 'pdf' }, { q: 'x'.repeat(201) }]) expect((await read(args)).structuredContent.code).toBe('invalid_request');
 expect(m.query).not.toHaveBeenCalled();
});
it('requires a usable current overview workspace at issuance, independent of selected workspace', async () => {
 await expect(assertAgencyOverviewCredentialAccess({ userId: 'u' })).resolves.toBeUndefined();
 denied.add('a'); denied.add('b'); await expect(assertAgencyOverviewCredentialAccess({ userId: 'u' })).rejects.toMatchObject({ code: 'forbidden' });
 rows = []; await expect(assertAgencyOverviewCredentialAccess({ userId: 'u' })).rejects.toMatchObject({ code: 'forbidden' });
 m.config.mockResolvedValue(0); await expect(assertAgencyOverviewCredentialAccess({ userId: 'u' })).rejects.toMatchObject({ code: 'unavailable' });
});
