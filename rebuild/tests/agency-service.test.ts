import { customerCopy } from '@/modules/agency/ui/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: { $queryRaw: vi.fn(), appSetting: { findMany: vi.fn() } }, config: vi.fn(), invitations: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/modules/settings/server/invitations', () => ({ listTeamInvitations: mocks.invitations }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purge }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({
  canAccessFeature: (value: { features: Record<string, boolean> }, id: string) => value.features[id] === true,
}));
vi.mock('../src/server/entitlements', async () => ({
  resolveEntitlements: (await vi.importActual<typeof import('../src/server/entitlements')>('../src/server/entitlements')).resolveEntitlements,
  loadEntitlements: mocks.entitlements,
  canUseModule: (value: { modules: Record<string, boolean> }, id: string) => value.modules[id] === true,
  canUseFeature: (value: { features: Record<string, boolean> }, id: string) => value.features[id] === true,
}));

import { agencyOverview, agencySearchLimit, listAgencyClients } from '../src/modules/agency/server/agency';
import { AGENCY_CONFIG } from '../src/modules/agency/config';
import { agencyManifest } from '../src/modules/agency/manifest';

const actor = { userId: 'user-a' };
const defaults: Record<string, number> = {
  'agency.workspaceIdMaxLength': 200,
  'agency.workspaceLimit': 3, 'agency.failureWindowDays': 30, 'agency.clientListLimit': 1, 'agency.searchMaxLength': 20, 'agency.accessConcurrency': 8,
  'agency.attentionWeightUnavailable': 1000, 'agency.attentionWeightDisconnected': 100, 'agency.attentionWeightFailed': 10, 'agency.attentionWeightOverdue': 1,
};
let caps: Record<string, number>;
const sqlText = (query: unknown) => (Array.isArray(query) ? query.join('?') : '');
const admin = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, role: 'owner', suspendedAt: null, timezone: 'UTC', ...extra });
const metric = (id: string, extra: Record<string, unknown> = {}) => ({ id, channels: 2, disconnected: 0, scheduled: 1, failed: 0, openTasks: 0, overdueTasks: 0, members: 1, clients: 0, ...extra });
const FEATURES = ['agency/overview', 'agency/clients', 'settings/connections', 'publishing/posts', 'tasks/board', 'settings/team'];
const grant = (ids: string[]) => Object.fromEntries(ids.map(id => [id, true]));
let administered: ReturnType<typeof admin>[] = [];
let metrics: ReturnType<typeof metric>[] = [];
let denied: Set<string>;
/** Features withheld per workspace, applied to both entitlement and permission. */
let withheld: Record<string, string[]>;
let limited: Set<string>;
let policy: Array<{ key: string; value: unknown; encrypted: boolean }>;
let switches: Record<string, { workspace?: string[]; member?: string[] }>;

const ownedBy = (call: unknown[]) => call.slice(1).find(Array.isArray) as string[] | undefined;
const metricCalls = (token: string) => mocks.prisma.$queryRaw.mock.calls.filter(call => sqlText(call[0]).includes(token));

beforeEach(() => {
  vi.clearAllMocks(); administered = []; metrics = []; denied = new Set(); withheld = {}; limited = new Set(); policy = []; switches = {}; caps = { ...defaults };
  mocks.config.mockImplementation(async (key: string) => key === 'agency.customerCopy' ? customerCopy : caps[key]);
  mocks.invitations.mockResolvedValue({ available: true, invitations: [] });
  mocks.purge.mockResolvedValue(undefined);
  mocks.prisma.appSetting.findMany.mockImplementation(async (args: { where: { key: { in: string[] } } }) => policy.filter(item => args.where.key.in.includes(item.key)));
  const features = (workspaceId: string) => grant(FEATURES.filter(id => !(withheld[workspaceId] ?? []).includes(id)));
  mocks.entitlements.mockImplementation(async (_user: string, workspaceId: string) => (denied.has(workspaceId)
    ? { workspaceId, modules: { agency: false }, features: {} } : { workspaceId, modules: { agency: true }, features: features(workspaceId) }));
  mocks.permissions.mockImplementation(async (_user: string, workspaceId: string) => ({ features: features(workspaceId), pageScope: limited.has(workspaceId) ? { all: false, ids: ['t1'] } : { all: true } }));
  mocks.prisma.$queryRaw.mockImplementation(async (query: unknown, ...values: unknown[]) => {
    const text = sqlText(query);
    if (text.includes('"workspaceDisabled"')) { const own = switches[values[1] as string] ?? {}; return [{ workspaceDisabled: own.workspace ?? [], memberDisabled: own.member ?? [], planFeatures: null }]; }
    if (text.includes('ranked')) return [{ workspaceId: 'w1', userId: 'c1', name: 'Ann', email: 'a@example.test', total: 2 }];
    if (text.includes('FROM workspaces w WHERE w.id = ANY')) {
      // Each group query returns only its own columns, as the real SQL does.
      const columns = text.includes('FROM targets') ? ['channels', 'disconnected'] : text.includes('FROM posts') ? ['scheduled', 'failed']
        : text.includes('FROM tasks k') ? ['openTasks', 'overdueTasks'] : ['members', 'clients'];
      const ids = (values.find(Array.isArray) as string[]) ?? [];
      return metrics.filter(row => ids.includes(row.id)).map(row => Object.fromEntries([['id', row.id], ...columns.map(column => [column, (row as Record<string, unknown>)[column]])]));
    }
    return administered;
  });
});

describe('agency overview', () => {
  it('only queries memberships held by the signed-in user as owner/admin', async () => {
    await agencyOverview(actor);
    const call = mocks.prisma.$queryRaw.mock.calls[0]!;
    const text = sqlText(call[0]);
    expect(text).toContain('m."userId" =');
    expect(text).toContain("m.role::text IN ('owner', 'admin')");
    expect(text).toContain('"disabledAt" IS NULL');
    expect(call.slice(1)).toContain('user-a');
  });

  it('sorts by attention, filters, truncates to the configured limit, totals and never exposes tokens', async () => {
    administered = [admin('w1', 'Calm'), admin('w2', 'Broken'), admin('w3', 'Quiet'), admin('w4', 'Extra')];
    metrics = [metric('w1'), metric('w2', { disconnected: 1, failed: 2, overdueTasks: 3, openTasks: 4 }), metric('w3')];
    const result = await agencyOverview(actor);
    expect(result).toMatchObject({ truncated: true, filtered: false, limit: 3 });
    expect(result.workspaces.map(item => item.id)).toEqual(['w2', 'w1', 'w3']);
    expect(result.workspaces[0]).toMatchObject({ needsAttention: true, state: 'available' });
    expect(result.totals).toMatchObject({ workspaces: 3, needingAttention: 1, channels: 6, disconnected: 1, scheduled: 3, failed: 2, openTasks: 4, overdueTasks: 3 });
    expect(result.totals.coverage).toEqual({ channels: { covered: 3, of: 3 }, publishing: { covered: 3, of: 3 }, tasks: { covered: 3, of: 3 }, team: { covered: 3, of: 3 } });
    expect(JSON.stringify(result)).not.toMatch(/accessToken/i);
    expect((await agencyOverview(actor, { attentionOnly: true })).workspaces.map(item => item.id)).toEqual(['w2']);
    expect((await agencyOverview(actor, { sort: 'name', order: 'asc' })).workspaces.map(item => item.id)).toEqual(['w2', 'w1', 'w3']);
  });

  it('searches in SQL with a bound, escaped pattern before the cap and does not narrow the capped rows in code', async () => {
    administered = [admin('w9', 'Zebra Studio')];
    metrics = [metric('w9')];
    const result = await agencyOverview(actor, { q: '  50%_off!  ' });
    const call = mocks.prisma.$queryRaw.mock.calls[0]!;
    const text = sqlText(call[0]);
    expect(text).toContain('ILIKE');
    expect(text).toContain("ESCAPE '!'");
    expect(text.indexOf('ILIKE')).toBeLessThan(text.indexOf('LIMIT'));
    expect(text).not.toContain('50');
    expect(call.slice(1)).toContain('%50!%!_off!!%');
    expect(call.slice(1)).toContain(4);
    // The row the database returned is kept: the service no longer filters the capped window itself.
    expect(result.workspaces.map(item => item.id)).toEqual(['w9']);
    expect(result).toMatchObject({ filtered: true, truncated: false });
    expect(result.totals.workspaces).toBe(1);
  });

  it('runs no pattern when there is no search and reports totals as unfiltered', async () => {
    await agencyOverview(actor, { q: '   ' });
    const call = mocks.prisma.$queryRaw.mock.calls[0]!;
    expect(call.slice(1)).toContain(null);
    expect((await agencyOverview(actor)).filtered).toBe(false);
  });

  it('bounds search length with the Root setting and exposes it for the form', async () => {
    await expect(agencyOverview(actor, { q: 'x'.repeat(21) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(agencyOverview(actor, { q: 'x'.repeat(20) })).resolves.toMatchObject({ filtered: true });
    expect(await agencySearchLimit()).toBe(20);
    caps['agency.searchMaxLength'] = 40;
    await expect(agencyOverview(actor, { q: 'x'.repeat(30) })).resolves.toMatchObject({ filtered: true });
  });

  it('measures only workspaces that are currently entitled and available', async () => {
    administered = [admin('w1', 'Active'), admin('w2', 'No plan'), admin('w3', 'Paused', { suspendedAt: new Date() })];
    denied.add('w2'); metrics = [metric('w1')];
    const result = await agencyOverview(actor);
    expect(result.workspaces.map(item => [item.id, item.state])).toEqual([['w3', 'suspended'], ['w1', 'available']]);
    expect(result.workspaces[0]).toMatchObject({ metrics: null, needsAttention: true });
    for (const token of ['FROM targets', 'FROM posts', 'FROM tasks k', 'FROM memberships x']) expect(ownedBy(metricCalls(token)[0]!)).toEqual(['w1']);
    expect(mocks.entitlements).toHaveBeenCalledWith('user-a', 'w1', { allowInstallationInspection: false });
    expect(mocks.entitlements).not.toHaveBeenCalledWith('user-a', 'w3', expect.anything());
  });

  it('withholds counts of modules the person cannot use in a workspace and never shows them as zero', async () => {
    administered = [admin('w1', 'Full'), admin('w2', 'No tasks or team'), admin('w3', 'Limited channels')];
    withheld.w2 = ['tasks/board', 'settings/team']; limited.add('w3');
    metrics = [metric('w1', { openTasks: 5, overdueTasks: 2, failed: 1 }), metric('w2', { openTasks: 99, overdueTasks: 99, members: 99, clients: 99 }), metric('w3', { channels: 9, scheduled: 9, failed: 9, disconnected: 9 })];
    const result = await agencyOverview(actor, { sort: 'name', order: 'asc' });
    const byId = Object.fromEntries(result.workspaces.map(item => [item.id, item.metrics!]));
    expect(byId.w2).toMatchObject({ channels: 2, scheduled: 1, openTasks: null, overdueTasks: null, members: null, clients: null });
    expect(byId.w3).toMatchObject({ channels: null, disconnected: null, scheduled: null, failed: null, openTasks: 0, members: 1 });
    expect(JSON.stringify(result)).not.toContain('99');
    // The withheld groups were not even queried for those workspaces.
    expect(ownedBy(metricCalls('FROM tasks k')[0]!)).toEqual(['w1', 'w3']);
    expect(ownedBy(metricCalls('FROM memberships x')[0]!)).toEqual(['w1', 'w3']);
    expect(ownedBy(metricCalls('FROM targets')[0]!)).toEqual(['w1', 'w2']);
    expect(ownedBy(metricCalls('FROM posts')[0]!)).toEqual(['w1', 'w2']);
    expect(result.totals).toMatchObject({ openTasks: 5, overdueTasks: 2, channels: 4, scheduled: 2 });
    expect(result.totals.coverage).toEqual({ channels: { covered: 2, of: 3 }, publishing: { covered: 2, of: 3 }, tasks: { covered: 2, of: 3 }, team: { covered: 2, of: 3 } });
  });

  it('reports a total as unknown, not zero, when nobody contributed and sorts withheld values last', async () => {
    administered = [admin('w1', 'A'), admin('w2', 'B')];
    withheld.w1 = ['tasks/board']; withheld.w2 = ['tasks/board'];
    metrics = [metric('w1'), metric('w2')];
    const none = await agencyOverview(actor);
    expect(none.totals).toMatchObject({ openTasks: null, overdueTasks: null, scheduled: 2 });
    expect(none.totals.coverage.tasks).toEqual({ covered: 0, of: 2 });
    withheld = { w1: ['tasks/board'] };
    metrics = [metric('w1', { openTasks: 0 }), metric('w2', { openTasks: 1 })];
    for (const order of ['asc', 'desc'] as const) expect((await agencyOverview(actor, { sort: 'openTasks', order })).workspaces.map(item => item.id)).toEqual(['w2', 'w1']);
  });

  it('does not count a withheld group toward attention', async () => {
    administered = [admin('w1', 'A')];
    withheld.w1 = ['publishing/posts'];
    metrics = [metric('w1', { failed: 7 })];
    expect((await agencyOverview(actor)).workspaces[0]).toMatchObject({ needsAttention: false, metrics: { failed: null, scheduled: null } });
  });

  it('shows a workspace being erased without its data', async () => {
    administered = [admin('w1', 'Leaving')];
    mocks.purge.mockRejectedValueOnce(new Error('purging'));
    const result = await agencyOverview(actor);
    expect(result.workspaces[0]).toMatchObject({ state: 'deleting', metrics: null, needsAttention: true });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses, rather than showing an empty list, when no administered workspace is entitled', async () => {
    administered = [admin('w1', 'A'), admin('w2', 'B')];
    denied.add('w1'); denied.add('w2');
    await expect(agencyOverview(actor)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('drops a workspace where the person lacks Agency permission or the membership has gone, and fails closed on errors', async () => {
    administered = [admin('w1', 'A'), admin('w2', 'B'), admin('w3', 'C'), admin('w4', 'D')];
    withheld.w2 = ['agency/overview'];
    mocks.permissions.mockImplementation(async (_user: string, workspaceId: string) => {
      if (workspaceId === 'w3') return null;
      if (workspaceId === 'w4') throw new Error('db');
      return { features: grant(FEATURES.filter(id => !(withheld[workspaceId] ?? []).includes(id))), pageScope: { all: true } };
    });
    metrics = [metric('w1')];
    caps['agency.workspaceLimit'] = 4;
    expect((await agencyOverview(actor)).workspaces.map(item => item.id)).toEqual(['w1']);
  });

  it('orders attention by the Root weights, not by source constants', async () => {
    administered = [admin('w1', 'Failing'), admin('w2', 'Overdue')];
    metrics = [metric('w1', { failed: 1 }), metric('w2', { overdueTasks: 5 })];
    expect((await agencyOverview(actor)).workspaces.map(item => item.id)).toEqual(['w1', 'w2']);
    caps['agency.attentionWeightOverdue'] = 100;
    expect((await agencyOverview(actor)).workspaces.map(item => item.id)).toEqual(['w2', 'w1']);
    caps['agency.attentionWeightUnavailable'] = 0;
    administered = [admin('w1', 'Paused', { suspendedAt: new Date() }), admin('w2', 'Overdue')];
    expect((await agencyOverview(actor)).workspaces.map(item => item.id)).toEqual(['w2', 'w1']);
  });

  describe('installation policy and suspended rows', () => {
    const paused = () => { administered = [admin('w1', 'Active'), admin('w2', 'Paused', { suspendedAt: new Date() })]; metrics = [metric('w1')]; };
    it('lists a suspended workspace, metrics withheld, only while Agency stays enabled for the person there', async () => {
      paused();
      const result = await agencyOverview(actor);
      expect(result.workspaces.find(item => item.id === 'w2')).toMatchObject({ state: 'suspended', metrics: null });
      expect(mocks.entitlements).not.toHaveBeenCalledWith('user-a', 'w2', expect.anything());
    });
    it.each([['workspace', 'agency'], ['member', 'agency'], ['workspace', 'agency/overview'], ['member', 'agency/overview']] as const)('drops a suspended row when its %s switch disables %s', async (scope, key) => {
      paused(); switches.w2 = { [scope]: [key] };
      expect((await agencyOverview(actor)).workspaces.map(item => item.id)).toEqual(['w1']);
    });
    it('honors the clients feature switch for suspended rows', async () => {
      paused(); switches.w2 = { workspace: ['agency/clients'] };
      expect((await listAgencyClients(actor)).workspaces.map(item => item.workspaceId)).toEqual(['w1']);
      expect((await agencyOverview(actor)).workspaces.map(item => item.id)).toContain('w2');
    });
    it('refuses when every row is a suspended row with Agency switched off', async () => {
      administered = [admin('w2', 'Paused', { suspendedAt: new Date() })]; switches.w2 = { member: ['agency'] };
      await expect(agencyOverview(actor)).rejects.toMatchObject({ code: 'forbidden' });
    });
    it.each([
      ['entitlements.modules.agency', false], ['entitlements.features.agency/overview', false], ['entitlements.modules.agency', 'yes'],
    ])('refuses before any scoped read when installation policy %s is %s', async (key, value) => {
      paused(); policy = [{ key, value, encrypted: false }];
      await expect(agencyOverview(actor)).rejects.toMatchObject({ code: 'forbidden' });
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled(); expect(mocks.entitlements).not.toHaveBeenCalled();
    });
    it('applies the clients feature policy to clients only, and fails closed when policy cannot be read', async () => {
      paused(); policy = [{ key: 'entitlements.features.agency/clients', value: false, encrypted: false }];
      await expect(listAgencyClients(actor)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(agencyOverview(actor)).resolves.toMatchObject({ ok: true });
      mocks.prisma.appSetting.findMany.mockRejectedValue(new Error('db down'));
      await expect(agencyOverview(actor)).rejects.toMatchObject({ code: 'unavailable' });
    });
    it('queries the real policy keys and the actor-bound membership row', async () => {
      paused(); await agencyOverview(actor);
      expect(mocks.prisma.appSetting.findMany.mock.calls[0]![0].where.key.in).toEqual(['entitlements.modules.agency', 'entitlements.features.agency/overview']);
      const call = mocks.prisma.$queryRaw.mock.calls.find(item => sqlText(item[0]).includes('"workspaceDisabled"'))!;
      expect(sqlText(call[0])).toContain('m."userId" ='); expect(call.slice(1)).toEqual(['user-a', 'w2']);
    });
  });

  it('checks workspaces in parallel groups sized by Root', async () => {
    administered = [admin('w1', 'A'), admin('w2', 'B'), admin('w3', 'C')];
    let active = 0; let peak = 0;
    mocks.entitlements.mockImplementation(async (_user: string, workspaceId: string) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return { workspaceId, modules: { agency: true }, features: grant(FEATURES) };
    });
    caps['agency.accessConcurrency'] = 1; await agencyOverview(actor);
    expect(peak).toBe(1);
    caps['agency.accessConcurrency'] = 3; peak = 0; await agencyOverview(actor);
    expect(peak).toBe(3);
  });

  it('rejects invalid filters or configuration and returns no workspaces for a person who manages none', async () => {
    await expect(agencyOverview(actor, { sort: 'password' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(agencyOverview(actor, { workspaceId: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    for (const key of ['agency.workspaceLimit', 'agency.attentionWeightFailed', 'agency.accessConcurrency', 'agency.searchMaxLength']) {
      caps[key] = key === 'agency.attentionWeightFailed' ? -1 : 0;
      await expect(agencyOverview(actor)).rejects.toMatchObject({ code: 'unavailable' });
      await expect(agencySearchLimit()).rejects.toMatchObject({ code: 'unavailable' });
      caps[key] = defaults[key]!;
    }
    const empty = await agencyOverview(actor);
    expect(empty.workspaces).toEqual([]); expect(empty.totals.workspaces).toBe(0);
    expect(await listAgencyClients(actor)).toMatchObject({ workspaces: [] });
  });
});

describe('agency clients', () => {
  it('limits client lists, keeps client accounts when invitations fail, and reads invitations as the person', async () => {
    administered = [admin('w1', 'One'), admin('w2', 'Two')];
    mocks.invitations.mockImplementation(async (who: { workspaceId: string }) => {
      if (who.workspaceId === 'w2') throw new Error('mail down');
      return { available: true, invitations: [
        { id: 'i1', email: 'new@example.test', role: 'client', status: 'pending', expiresAt: new Date('2026-12-01T00:00:00Z') },
        { id: 'i2', email: 'staff@example.test', role: 'editor', status: 'pending', expiresAt: new Date() },
        { id: 'i3', email: 'done@example.test', role: 'client', status: 'accepted', expiresAt: new Date() },
      ] };
    });
    const result = await listAgencyClients(actor);
    expect(result).toMatchObject({ filtered: false, truncated: false, limit: 3 });
    expect(result.workspaces[0]!.clients).toHaveLength(1);
    expect(result.workspaces[0]!.clientCount).toBe(2);
    expect(result.workspaces[0]!.invitations).toEqual([{ id: 'i1', email: 'new@example.test', status: 'pending', expiresAt: '2026-12-01T00:00:00.000Z' }]);
    expect(result.workspaces[1]).toMatchObject({ invitationsAvailable: false, invitations: [] });
    expect(mocks.invitations).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'w1' });
  });

  it('does not read clients or invitations of suspended or non-entitled workspaces', async () => {
    administered = [admin('w1', 'One'), admin('w2', 'Paused', { suspendedAt: new Date() }), admin('w3', 'No plan')];
    denied.add('w3');
    const result = await listAgencyClients(actor);
    expect(result.workspaces.map(item => [item.workspaceId, item.state])).toEqual([['w1', 'available'], ['w2', 'suspended']]);
    expect(result.workspaces[1]).toMatchObject({ clientCount: null, clients: [] });
    expect(mocks.invitations).toHaveBeenCalledTimes(1);
    expect(ownedBy(metricCalls('ranked')[0]!)).toEqual(['w1']);
  });

  it('withholds clients and invitations from workspaces whose team the person cannot read', async () => {
    administered = [admin('w1', 'One'), admin('w2', 'No team')];
    withheld.w2 = ['settings/team'];
    const result = await listAgencyClients(actor);
    expect(result.workspaces[1]).toMatchObject({ workspaceId: 'w2', clientCount: null, clients: [], invitations: [], invitationsAvailable: false });
    expect(ownedBy(metricCalls('ranked')[0]!)).toEqual(['w1']);
    expect(mocks.invitations).toHaveBeenCalledTimes(1);
    expect(mocks.invitations).not.toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w2' }));
  });

  it('a client name or email search is not applied to workspaces whose team the person cannot read', async () => {
    administered = [admin('w1', 'One'), admin('w2', 'No team')];
    withheld.w2 = ['settings/team'];
    // The scan is workspace-name-only, so a term that only a client of w2 could match selects nothing by itself.
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    const result = await listAgencyClients(actor, { q: 'ann@example.test' });
    const scanText = sqlText(mocks.prisma.$queryRaw.mock.calls[0]![0]);
    expect(scanText).not.toMatch(/email|client/);
    expect(result.workspaces).toEqual([]);
    expect(metricCalls('ranked')).toHaveLength(0);
  });

  it('searches workspace names only, in SQL before the cap, and never touches client names or emails to select workspaces', async () => {
    administered = [admin('w1', 'One')];
    const result = await listAgencyClients(actor, { q: 'an_n%' });
    const [scan, members] = [mocks.prisma.$queryRaw.mock.calls[0]!, metricCalls('ranked')[0]!];
    const scanText = sqlText(scan[0]);
    expect(scanText).toContain('w.name ILIKE');
    expect(scanText).not.toMatch(/email|cu\.name|'client'|EXISTS/);
    expect(scanText.indexOf('ILIKE')).toBeLessThan(scanText.indexOf('LIMIT'));
    expect(scan.slice(1)).toContain('%an!_n!%%');
    expect(sqlText(members[0])).not.toContain('ILIKE');
    expect(members.slice(1)).not.toContain('%an!_n!%%');
    expect(JSON.stringify([scanText, sqlText(members[0])])).not.toContain('an_n');
    expect(result.filtered).toBe(true);
    mocks.prisma.$queryRaw.mockClear();
    await listAgencyClients(actor);
    expect(mocks.prisma.$queryRaw.mock.calls[0]!.slice(1)).not.toContain('%%');
    await expect(listAgencyClients(actor, { q: 'x'.repeat(21) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listAgencyClients(actor, { sort: 'name' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('reports truncation of the SQL-selected window', async () => {
    administered = [admin('w1', 'A'), admin('w2', 'B'), admin('w3', 'C'), admin('w4', 'D')];
    expect(await listAgencyClients(actor, { q: 'a' })).toMatchObject({ truncated: true, filtered: true, limit: 3 });
  });
});

describe('agency configuration and manifest', () => {
  it('exports valid unique configuration for every operational bound the services read', () => {
    const keys = AGENCY_CONFIG.map(entry => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...Object.keys(defaults), 'agency.customerCopy', 'agency.exportCopy', 'agency.clientInvitationCopy', 'agency.clientInvitationPolicy'].sort());
    for (const entry of AGENCY_CONFIG) { expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true); expect(entry.consumption).toBe('active'); }
    expect(agencyManifest.pages.map(page => page.id)).toEqual(['agency/overview', 'agency/clients']);
    expect(agencyManifest.rootSettingsPrefixes).toEqual(['agency.']);
  });
});
