import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rules: Array<[RegExp, unknown]> = [];
  const executed: Array<{ sql: string; values: unknown[] }> = [];
  const queried: Array<{ sql: string; values: unknown[] }> = [];
  const text = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ');
  const db: any = {
    user: { findUnique: vi.fn() },
    workspaceDataPurge: { findUnique: vi.fn() },
    membership: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      queried.push({ sql, values });
      const rule = rules.find(([pattern]) => pattern.test(sql));
      if (!rule && (sql.includes('SELECT id FROM users WHERE id = ANY') || sql.includes('pg_advisory_xact_lock'))) return [];
      if (!rule) throw new Error(`Unexpected query: ${sql}`);
      if (rule[1] instanceof Error) throw rule[1];
      return rule[1];
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { executed.push({ sql: text(strings), values }); return 1; }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { db, users: {} as Record<string, unknown>, rules, executed, queried, config: vi.fn(), setUserAccess: vi.fn(), setWorkspaceAccess: vi.fn() };
});
vi.mock('../src/server/data', () => ({ prisma: h.db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: h.config }));
vi.mock('../src/server/root/user-controls', () => ({ setRootUserDisabled: h.setUserAccess }));
vi.mock('../src/server/root/workspace-access', () => ({ setRootWorkspaceAccess: h.setWorkspaceAccess }));

import { assignRootPlan, listRootPlanHistory, listRootPlans, listRootSubscribers, updateRootPlan } from '../src/server/root/legacy/plans';
import { changeRootMemberRole, exportRootPrivileges, listRootPrivileges } from '../src/server/root/legacy/privileges';
import { loadRootLifecycle, setLifecycleUserAccess, setLifecycleWorkspaceAccess, transferWorkspaceOwnership } from '../src/server/root/legacy/lifecycle';
import { getRootError, listRootErrors, setRootErrorResolved } from '../src/server/root/legacy/errors';
import { readRootBackupStatus, readRootDiagnosticsSummary } from '../src/server/root/legacy/backups';
import { ROOT_LEGACY_CONFIG } from '../src/server/root/legacy/config';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';

const when = (pattern: RegExp, value: unknown) => h.rules.unshift([pattern, value]);
const actor = (root: boolean | null = true, disabledAt: Date | null = null) => h.db.user.findUnique.mockImplementation(async (args: { where: { id?: string; email?: string } }) => {
  if (args.where.email) return h.users[args.where.email] ?? null;
  return root === null ? null : { isInstanceOwner: root, disabledAt };
});
const audits = () => h.executed.filter(call => call.sql.includes('INSERT INTO root_activities'));
const writes = () => h.executed.filter(call => !call.sql.includes('INSERT INTO root_activities'));
const plan = { id: 'plan-1', key: 'pro', name: 'Pro', position: 1, currency: 'EUR', priceMonthly: 1000, priceYearly: 10000, extraChannelPrice: 100, channels: 10, members: 5, workspaces: 2, postsPerMonth: null, aiCredits: null, features: ['publishing/posts'], isDefault: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.rules.length = 0; h.executed.length = 0; h.queried.length = 0;
  for (const key of Object.keys(h.users)) delete h.users[key];
  h.db.workspaceDataPurge.findUnique.mockResolvedValue(null);
  for (const definition of ROOT_LEGACY_CONFIG) {
    CONFIG_BY_KEY.set(definition.key, definition);
  }
  h.config.mockImplementation(async (key: string) => CONFIG_BY_KEY.get(key)?.defaultValue);
  for (const fn of Object.values(h.db.membership) as any[]) fn.mockReset();
  h.db.membership.findMany.mockResolvedValue([]);
  h.db.membership.findUnique.mockResolvedValue(null);
  h.db.membership.updateMany.mockResolvedValue({ count: 0 });
  actor(true);
});

describe('Root-only authorization', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['listRootPlans', () => listRootPlans('u')],
    ['listRootPlanHistory', () => listRootPlanHistory('u')],
    ['updateRootPlan', () => updateRootPlan('u', 'plan-1', { patch: { name: 'X' }, confirmation: 'UPDATE PLAN pro' })],
    ['assignRootPlan', () => assignRootPlan('u', { userId: 'a', planKey: null, confirmation: 'x' })],
    ['listRootPrivileges', () => listRootPrivileges('u')],
    ['exportRootPrivileges', () => exportRootPrivileges('u')],
    ['changeRootMemberRole', () => changeRootMemberRole('u', { membershipId: 'm', role: 'admin', confirmation: 'x' })],
    ['loadRootLifecycle', () => loadRootLifecycle('u')],
    ['transferWorkspaceOwnership', () => transferWorkspaceOwnership('u', { workspaceId: 'w', newOwnerEmail: 'a@b.test', previousOwners: 'keep', confirmation: 'x' })],
    ['listRootErrors', () => listRootErrors('u')],
    ['getRootError', () => getRootError('u', 'e')],
    ['setRootErrorResolved', () => setRootErrorResolved('u', 'e', true)],
    ['readRootBackupStatus', () => readRootBackupStatus('u')],
    ['readRootDiagnosticsSummary', () => readRootDiagnosticsSummary('u')],
  ];
  for (const [label, call] of calls) {
    it.each([['a workspace owner who is not Root', false, null], ['a disabled Root account', true, new Date()], ['an unknown account', null, null]] as const)(`${label} is denied for %s with no reads of private data and no writes`, async (_name, root, disabledAt) => {
      actor(root, disabledAt);
      await expect(call()).rejects.toMatchObject({ code: 'forbidden' });
      expect(h.queried).toHaveLength(0);
      expect(h.executed).toHaveLength(0);
    });
  }
});

describe('Root operational bounds', () => {
  it('fails closed when a Root limit is absent from the host registry or invalid at runtime', async () => {
    const definition = ROOT_LEGACY_CONFIG.find(item => item.key === 'root.legacy.planHistoryLimit')!;
    CONFIG_BY_KEY.delete(definition.key);
    await expect(listRootPlanHistory('root')).rejects.toMatchObject({ code: 'unavailable' });
    CONFIG_BY_KEY.set(definition.key, definition);
    h.config.mockResolvedValueOnce(-1);
    await expect(listRootPlanHistory('root')).rejects.toMatchObject({ code: 'unavailable' });
    expect(h.queried).toHaveLength(0);
  });
});

describe('plans', () => {
  it('lists plans with feature groups per module and flags features outside the catalog', async () => {
    when(/FROM plans p/, [{ ...plan, features: ['publishing/posts', 'legacy_thing'], subscribers: 3 }]);
    const result = await listRootPlans('root');
    expect(result.plans[0]).toMatchObject({ subscribers: 3, unlistedFeatures: ['legacy_thing'] });
    expect(result.featureGroups.map(group => group.id)).toEqual(expect.arrayContaining(['shared', 'publishing', 'inbox', 'analytics', 'ads', 'settings', 'platform:facebook']));
  });

  it('updates only after the exact confirmation and writes the diff to the audit in the same transaction', async () => {
    when(/FROM plans WHERE id/, [plan]);
    await expect(updateRootPlan('root', 'plan-1', { patch: { members: 8 }, confirmation: 'update plan pro' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.executed).toHaveLength(0);
    const result = await updateRootPlan('root', 'plan-1', { patch: { members: 8, features: ['publishing/posts', 'ads/performance', 'ads/performance'] }, confirmation: 'UPDATE PLAN pro' });
    expect(result).toMatchObject({ changed: true, changedFields: ['members', 'features'] });
    expect(h.db.$transaction).toHaveBeenCalled();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]!.values).toContain(8);
    expect(writes()[0]!.values).toContainEqual(['publishing/posts', 'ads/performance']);
    const detail = JSON.parse(audits()[0]!.values[3] as string);
    expect(detail.changes.members).toEqual({ from: 5, to: 8 });
    expect(audits()[0]!.values[2]).toBe('root.plan_updated');
  });

  it('rejects unknown features, empty patches and unknown fields; keeps already-present legacy keys', async () => {
    when(/FROM plans WHERE id/, [{ ...plan, features: ['legacy_thing'] }]);
    await expect(updateRootPlan('root', 'plan-1', { patch: { features: ['made_up_key'] }, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateRootPlan('root', 'plan-1', { patch: {}, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(updateRootPlan('root', 'plan-1', { patch: { key: 'new' }, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'invalid_request' });
    const kept = await updateRootPlan('root', 'plan-1', { patch: { features: ['legacy_thing', 'ads/performance'] }, confirmation: 'UPDATE PLAN pro' });
    expect(kept.changed).toBe(true);
  });

  it('reports no change without writing, and 404s a missing plan', async () => {
    when(/FROM plans WHERE id/, [plan]);
    expect(await updateRootPlan('root', 'plan-1', { patch: { name: 'Pro' }, confirmation: 'anything' })).toMatchObject({ changed: false });
    expect(h.executed).toHaveLength(0);
    h.rules.length = 0; when(/FROM plans WHERE id/, []);
    await expect(updateRootPlan('root', 'nope', { patch: { name: 'X' }, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('makes a plan the default only with its own phrase and clears the previous default; refuses to unset', async () => {
    when(/FROM plans WHERE id/, [plan]);
    await expect(updateRootPlan('root', 'plan-1', { patch: { isDefault: true }, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'invalid_request' });
    await updateRootPlan('root', 'plan-1', { patch: { isDefault: true }, confirmation: 'SET DEFAULT PLAN pro' });
    expect(writes()[0]!.sql).toContain(`"isDefault" = false WHERE id <>`);
    expect(writes()).toHaveLength(2);
    h.rules.length = 0; h.executed.length = 0; when(/FROM plans WHERE id/, [{ ...plan, isDefault: true }]);
    await expect(updateRootPlan('root', 'plan-1', { patch: { isDefault: false }, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.executed).toHaveLength(0);
  });

  it('assigns and clears a plan with exact confirmations and audit of both sides', async () => {
    when(/FROM users WHERE id/, [{ id: 'u1', email: 'a@x.test', planId: 'plan-0', disabledAt: null }]);
    when(/FROM plans WHERE key/, [{ id: 'plan-1', key: 'pro' }]);
    when(/SELECT key FROM plans WHERE id/, [{ key: 'free' }]);
    await expect(assignRootPlan('root', { userId: 'u1', planKey: 'pro', confirmation: 'ASSIGN PLAN pro TO other@x.test' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.executed).toHaveLength(0);
    expect(await assignRootPlan('root', { userId: 'u1', planKey: 'pro', confirmation: 'ASSIGN PLAN pro TO a@x.test' })).toMatchObject({ changed: true, planKey: 'pro' });
    expect(JSON.parse(audits()[0]!.values[3] as string)).toEqual({ userId: 'u1', fromPlanKey: 'free', toPlanKey: 'pro' });
    h.executed.length = 0;
    await assignRootPlan('root', { userId: 'u1', planKey: null, confirmation: 'REMOVE PLAN FROM a@x.test' });
    expect(writes()[0]!.values[0]).toBeNull();
  });

  it('is a no-op when the plan is unchanged and 404s unknown plans or accounts', async () => {
    when(/FROM users WHERE id/, [{ id: 'u1', email: 'a@x.test', planId: 'plan-1', disabledAt: null }]);
    when(/FROM plans WHERE key/, [{ id: 'plan-1', key: 'pro' }]);
    expect(await assignRootPlan('root', { userId: 'u1', planKey: 'pro', confirmation: 'ASSIGN PLAN pro TO a@x.test' })).toMatchObject({ changed: false });
    expect(h.executed).toHaveLength(0);
    h.rules.length = 0; when(/FROM users WHERE id/, []);
    await expect(assignRootPlan('root', { userId: 'zz', planKey: null, confirmation: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('exposes plan history without raw audit detail', async () => {
    when(/FROM root_activities a/, [{ id: 'a1', action: 'root.plan_assigned', createdAt: new Date('2026-10-17T10:00:00Z'), actorEmail: 'root@x.test', subjectEmail: 'u@x.test', detail: { userId: 'u1', fromPlanKey: 'free', toPlanKey: 'pro', secret: 'DO-NOT-RETURN' } }]);
    const history = await listRootPlanHistory('root');
    expect(history.items[0]).toMatchObject({ fromPlan: 'free', toPlan: 'pro', subject: 'u@x.test' });
    expect(JSON.stringify(history)).not.toContain('DO-NOT-RETURN');
  });
});

describe('privileges', () => {
  const row = (over: object = {}) => ({ membershipId: 'm1', workspaceId: 'w1', workspace: 'Acme', userId: 'u1', name: 'Ann', email: 'ann@x.test', role: 'editor', allPages: false, pageCount: 2, isRoot: false, disabled: false, suspended: false, lastSession: null, total: 1, ...over });

  it('shows full reach for owners and admins and counts for limited members; binds search literally', async () => {
    when(/FROM memberships m JOIN users u/, [row(), row({ membershipId: 'm2', role: 'admin', total: 2 }), row({ membershipId: 'm3', role: 'viewer', allPages: true, total: 3 })]);
    const result = await listRootPrivileges('root', { q: '50%_', role: 'editor', page: '2' });
    expect(result.items.map(item => item.channels)).toEqual([2, 'all', 'all']);
    const call = h.queried.at(-1)!;
    expect(call.values).toContain('%50\\%\\_%');
    expect(call.values).toContain('editor');
    expect(call.values.at(-1)).toBe(50);
  });

  it('rejects an invalid role, unknown filters and over-long search before querying', async () => {
    await expect(listRootPrivileges('root', { role: 'superuser' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listRootPrivileges('root', { sneaky: '1' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listRootPrivileges('root', { q: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.queried).toHaveLength(0);
  });

  it('exports spreadsheet-safe CSV and refuses a partial result', async () => {
    when(/FROM memberships m JOIN users u/, [row({ name: '=HYPERLINK("x")', workspace: 'A, "B"', total: 1 })]);
    const result = await exportRootPrivileges('root', {});
    expect(result.csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(result.csv).toContain('"A, ""B"""');
    expect(result).toMatchObject({ rows: 1, total: 1, truncated: false });
    when(/FROM memberships m JOIN users u/, [row({ total: 9000 })]);
    await expect(exportRootPrivileges('root', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });

  const member = [{ id: 'm1', userId: 'u1', workspaceId: 'w1', role: 'editor', email: 'ann@x.test' }];
  it('changes a role only with the exact confirmation and audits from/to', async () => {
    when(/JOIN users u ON u.id = m."userId" WHERE m.id/, member);
    when(/FROM workspaces WHERE id/, [{ id: 'w1' }]);
    when(/SELECT role::text AS role FROM memberships/, [{ role: 'editor' }]);
    await expect(changeRootMemberRole('root', { membershipId: 'm1', role: 'admin', confirmation: 'CHANGE ROLE ann@x.test IN w2 TO admin' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.executed).toHaveLength(0);
    expect(await changeRootMemberRole('root', { membershipId: 'm1', role: 'admin', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO admin' })).toMatchObject({ changed: true, previousRole: 'editor' });
    expect(JSON.parse(audits()[0]!.values[3] as string)).toMatchObject({ workspaceId: 'w1', from: 'editor', to: 'admin' });
  });

  it('protects the last active owner, blocks during deletion and reports no-ops', async () => {
    when(/JOIN users u ON u.id = m."userId" WHERE m.id/, member);
    when(/FROM workspaces WHERE id/, [{ id: 'w1' }]);
    when(/SELECT role::text AS role FROM memberships/, [{ role: 'owner' }]);
    when(/COUNT\(\*\)::int AS count FROM memberships/, [{ count: 1 }]);
    await expect(changeRootMemberRole('root', { membershipId: 'm1', role: 'admin', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO admin' })).rejects.toMatchObject({ code: 'conflict' });
    h.db.workspaceDataPurge.findUnique.mockResolvedValue({ status: 'requested' });
    await expect(changeRootMemberRole('root', { membershipId: 'm1', role: 'admin', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO admin' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.executed).toHaveLength(0);
    h.db.workspaceDataPurge.findUnique.mockResolvedValue(null);
    expect(await changeRootMemberRole('root', { membershipId: 'm1', role: 'owner', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO owner' })).toMatchObject({ changed: false });
    h.rules.length = 0; when(/JOIN users u ON u.id = m."userId" WHERE m.id/, []);
    await expect(changeRootMemberRole('root', { membershipId: 'missing', role: 'owner', confirmation: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('lifecycle', () => {
  const input = { workspaceId: 'w1', newOwnerEmail: 'New@X.test', previousOwners: 'demote_admin', confirmation: 'TRANSFER WORKSPACE w1 TO new@x.test' };
  const setup = (existing: { id: string; role: string } | null = null) => {
    when(/FROM workspaces WHERE id/, [{ id: 'w1', name: 'Acme' }]);
    when(/FROM users WHERE email =/, [{ id: 'u2', email: 'new@x.test', disabledAt: null }]);
    h.db.membership.findMany.mockResolvedValue([{ id: 'm1', userId: 'u1' }]);
    h.db.membership.findUnique.mockResolvedValue(existing);
    h.db.membership.updateMany.mockResolvedValue({ count: 1 });
  };

  it('transfers ownership atomically: creates membership, demotes old owners, audits', async () => {
    setup();
    expect(await transferWorkspaceOwnership('root', input)).toMatchObject({ changed: true, newOwnerId: 'u2', demoted: 1, createdMembership: true });
    expect(h.db.membership.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u2', workspaceId: 'w1', role: 'owner' }) });
    expect(h.queried.find(call => call.sql.includes('id = ANY'))?.values[0]).toEqual(['root', 'u1', 'u2']);
    expect(h.db.membership.updateMany).toHaveBeenCalledWith({ where: { workspaceId: 'w1', role: 'owner', userId: { not: 'u2' } }, data: { role: 'admin' } });
    expect(JSON.parse(audits()[0]!.values[3] as string)).toMatchObject({ workspaceId: 'w1', toUserId: 'u2', previousOwnerIds: ['u1'], demoted: 1 });
    expect(h.executed.every(call => !/DELETE/i.test(call.sql))).toBe(true);
  });

  it('promotes an existing member and can keep co-owners', async () => {
    setup({ id: 'm9', role: 'editor' });
    await transferWorkspaceOwnership('root', { ...input, previousOwners: 'keep' });
    expect(h.db.membership.update).toHaveBeenCalledWith({ where: { id: 'm9' }, data: { role: 'owner' } });
    expect(h.db.membership.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a wrong confirmation, disabled or unknown recipient, deletion in progress, missing workspace and existing sole owner', async () => {
    setup();
    await expect(transferWorkspaceOwnership('root', { ...input, confirmation: 'TRANSFER WORKSPACE w1 TO other@x.test' })).rejects.toMatchObject({ code: 'invalid_request' });
    h.rules.unshift([/FROM users WHERE email =/, [{ id: 'u2', email: 'new@x.test', disabledAt: new Date() }]]);
    await expect(transferWorkspaceOwnership('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    h.rules.unshift([/FROM users WHERE email =/, []]);
    await expect(transferWorkspaceOwnership('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    h.db.workspaceDataPurge.findUnique.mockResolvedValue({ status: 'failed' });
    await expect(transferWorkspaceOwnership('root', input)).rejects.toMatchObject({ code: 'conflict' });
    h.db.workspaceDataPurge.findUnique.mockResolvedValue(null);
    setup({ id: 'm9', role: 'owner' });
    h.db.membership.findMany.mockResolvedValue([{ id: 'm9', userId: 'u2' }]);
    await expect(transferWorkspaceOwnership('root', input)).rejects.toMatchObject({ code: 'conflict' });
    h.rules.length = 0; when(/FROM workspaces WHERE id/, []);
    await expect(transferWorkspaceOwnership('root', input)).rejects.toMatchObject({ code: 'not_found' });
    expect(h.executed).toHaveLength(0);
    expect(h.db.membership.create).not.toHaveBeenCalled();
  });

  it('delegates account and workspace access to the existing atomic Root services', async () => {
    h.setUserAccess.mockResolvedValue({ changed: true, sessionsRevoked: 0 });
    h.setWorkspaceAccess.mockResolvedValue({ changed: true });
    await setLifecycleUserAccess('root', 'u1', false, 'ENABLE a@x.test');
    await setLifecycleWorkspaceAccess('root', 'w1', false, 'RESTORE WORKSPACE w1');
    expect(h.setUserAccess).toHaveBeenCalledWith('root', 'u1', false, 'ENABLE a@x.test');
    expect(h.setWorkspaceAccess).toHaveBeenCalledWith('root', 'w1', false, 'RESTORE WORKSPACE w1');
    await expect(setLifecycleUserAccess('root', '', true, 'x')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setLifecycleWorkspaceAccess('root', 'w1', true, '')).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('lists lifecycle state and states plainly that deletion is unavailable', async () => {
    when(/FROM users WHERE "disabledAt" IS NOT NULL/, [{ id: 'u1', name: 'A', email: 'a@x.test', disabledAt: new Date('2026-10-01'), isInstanceOwner: false }]);
    when(/FROM workspaces w WHERE w."suspendedAt"/, [{ id: 'w1', name: 'Acme', suspendedAt: new Date('2026-10-02'), owners: ['o@x.test'] }]);
    when(/FROM workspace_data_purges/, [{ workspaceId: 'w1', status: 'requested' }]);
    const result = await loadRootLifecycle('root');
    expect(result).toMatchObject({ deletion: 'unavailable', pendingDeletions: [{ workspaceId: 'w1' }], suspendedWorkspaces: [{ owners: ['o@x.test'] }] });
  });
});

describe('error browser', () => {
  const err = (over: object = {}) => ({ id: 'e1', source: 'server', name: 'TypeError', message: 'failed with Bearer abcdefghijklmnop and token=SECRETVALUE', stack: 'at x '.repeat(2000), location: '/api/posts', release: 'abc', count: 3, firstSeenAt: new Date('2026-10-01'), lastSeenAt: new Date('2026-10-02'), resolvedAt: null, total: 1, ...over });

  it('redacts credential-like text and omits stacks from the list', async () => {
    when(/FROM error_events/, [err()]);
    const result = await listRootErrors('root', { status: 'all', source: 'server', q: '100%' });
    expect(result.items[0]!.message).not.toMatch(/abcdefghijklmnop|SECRETVALUE/);
    expect(result.items[0]).not.toHaveProperty('stack');
    expect(h.queried.at(-1)!.values).toContain('%100\\%%');
  });

  it('returns a truncated redacted stack only for the detail read and 404s a missing id', async () => {
    when(/FROM error_events WHERE id/, [err()]);
    const detail = await getRootError('root', 'e1');
    expect(detail.stack!.length).toBeLessThanOrEqual(4001);
    h.rules.length = 0; when(/FROM error_events WHERE id/, []);
    await expect(getRootError('root', 'zz')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('validates filters and reports an absent table as unavailable rather than empty', async () => {
    await expect(listRootErrors('root', { source: 'cron' })).rejects.toMatchObject({ code: 'invalid_request' });
    when(/FROM error_events/, new Error('relation "error_events" does not exist'));
    await expect(listRootErrors('root', {})).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('resolves and reopens with audit, and does nothing when the state already matches', async () => {
    when(/FROM error_events WHERE id/, [{ id: 'e1', resolvedAt: null }]);
    expect(await setRootErrorResolved('root', 'e1', true)).toMatchObject({ changed: true });
    expect(audits()[0]!.values[2]).toBe('root.error_resolved');
    h.executed.length = 0;
    expect(await setRootErrorResolved('root', 'e1', false)).toMatchObject({ changed: false });
    expect(h.executed).toHaveLength(0);
    h.rules.length = 0; when(/FROM error_events WHERE id/, [{ id: 'e1', resolvedAt: new Date() }]);
    await setRootErrorResolved('root', 'e1', false);
    expect(audits()[0]!.values[2]).toBe('root.error_reopened');
    h.rules.length = 0; when(/FROM error_events WHERE id/, []);
    await expect(setRootErrorResolved('root', 'zz', true)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('backup status and diagnostics', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const run = (kind: string, status: string, finishedAt: string) => ({ id: `${kind}-${finishedAt}`, kind, status, detail: 'size 12GB token=SECRETVALUE', startedAt: new Date(finishedAt), finishedAt: new Date(finishedAt) });

  it('classifies recent, stale, failed and never-recorded runs and never claims verification', async () => {
    when(/FROM backup_runs/, [run('offsite', 'ok', '2026-10-17T06:00:00Z'), run('restore_test', 'failed', '2026-10-16T00:00:00Z'), run('restore_test', 'ok', '2026-08-01T00:00:00Z')]);
    const status = await readRootBackupStatus('root', now);
    expect(status.checks.map(check => [check.kind, check.state])).toEqual([['offsite', 'recent'], ['restore_test', 'failed_latest']]);
    expect(status.checks.every(check => check.verification === 'recorded_by_script')).toBe(true);
    expect(status.limits.join(' ')).toMatch(/not read the backup files/);
    expect(status.summary).toMatch(/not verified|unverified/);
    expect(JSON.stringify(status)).not.toContain('SECRETVALUE');
    h.rules.length = 0; when(/FROM backup_runs/, [run('offsite', 'ok', '2026-10-10T00:00:00Z')]);
    const stale = await readRootBackupStatus('root', now);
    expect(stale.checks.map(check => check.state)).toEqual(['stale', 'never_recorded']);
  });

  it('reports an absent backup table as unavailable and unverified, with no checks invented', async () => {
    when(/FROM backup_runs/, new Error('relation "backup_runs" does not exist'));
    const status = await readRootBackupStatus('root', now);
    expect(status).toMatchObject({ source: 'unavailable', checks: [], runs: [] });
    expect(status.summary).toMatch(/unverified/);
  });

  it('summarizes alerts and errors but marks provider health as not assessed', async () => {
    when(/FROM system_alerts/, [{ id: 'a1', key: 'worker_stopped', openedAt: new Date('2026-10-17T00:00:00Z') }]);
    when(/FROM error_events/, [{ open: 4, last24h: 1 }]);
    const summary = await readRootDiagnosticsSummary('root', now);
    expect(summary).toMatchObject({ openAlerts: [{ key: 'worker_stopped' }], errors: { open: 4, openLast24h: 1 }, providerHealth: { state: 'not_assessed' } });
    h.rules.length = 0;
    when(/FROM system_alerts/, new Error('relation "system_alerts" does not exist'));
    when(/FROM error_events/, new Error('relation "error_events" does not exist'));
    expect(await readRootDiagnosticsSummary('root', now)).toMatchObject({ openAlerts: null, errors: null });
  });
});

describe('review hardening', () => {
  const member = [{ id: 'm1', userId: 'u1', workspaceId: 'w1', role: 'editor', email: 'ann@x.test' }];
  it('bounds the plan catalog and subscriber list and labels cut-off results', async () => {
    h.config.mockImplementation(async (key: string) => key === 'root.legacy.planCatalogLimit' || key === 'root.legacy.subscriberListLimit' ? 1 : CONFIG_BY_KEY.get(key)?.defaultValue);
    when(/FROM plans p/, [{ ...plan, subscribers: 1 }, { ...plan, id: 'p2', key: 'b', subscribers: 0 }]);
    const catalog = await listRootPlans('root');
    expect(catalog).toMatchObject({ limit: 1, truncated: true });
    expect(catalog.plans).toHaveLength(1);
    expect(h.queried.at(-1)!.values).toContain(2);
    when(/FROM users u LEFT JOIN plans/, [{ id: 'a' }, { id: 'b' }]);
    expect(await listRootSubscribers('root')).toMatchObject({ truncated: true, limit: 1, items: [{ id: 'a' }] });
  });

  it('runs mutations under the Root transaction timeout and lock wait, and fails closed without them', async () => {
    when(/FROM plans WHERE id/, [plan]);
    await updateRootPlan('root', 'plan-1', { patch: { name: 'New' }, confirmation: 'UPDATE PLAN pro' });
    expect(h.db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { timeout: 15000, maxWait: 5000 });
    const lockWait = CONFIG_BY_KEY.get('root.accountOperationLockWaitMs')!;
    CONFIG_BY_KEY.delete('root.accountOperationLockWaitMs');
    h.db.$transaction.mockClear();
    try { await expect(updateRootPlan('root', 'plan-1', { patch: { name: 'New2' }, confirmation: 'UPDATE PLAN pro' })).rejects.toMatchObject({ code: 'unavailable' }); } finally { CONFIG_BY_KEY.set('root.accountOperationLockWaitMs', lockWait); }
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it('locks every owner (re-reading the set) before a role change and fails if owners keep changing', async () => {
    when(/JOIN users u ON u.id = m."userId" WHERE m.id/, member);
    when(/FROM workspaces WHERE id/, [{ id: 'w1' }]);
    when(/SELECT role::text AS role FROM memberships/, [{ role: 'owner' }]);
    when(/COUNT\(\*\)::int AS count FROM memberships/, [{ count: 2 }]);
    h.db.membership.findMany.mockResolvedValue([{ id: 'o1', userId: 'o1' }]);
    await changeRootMemberRole('root', { membershipId: 'm1', role: 'admin', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO admin' });
    expect(h.queried.filter(q => q.sql.includes('FOR UPDATE') && q.sql.includes('ANY')).some(q => (q.values[0] as string[]).includes('o1'))).toBe(true);
    let n = 0;
    h.db.membership.findMany.mockImplementation(async () => [{ id: `x${n}`, userId: `x${n++}` }]);
    await expect(changeRootMemberRole('root', { membershipId: 'm1', role: 'viewer', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO viewer' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.executed).toHaveLength(2);
  });

  it('refuses to make a disabled account an owner', async () => {
    when(/JOIN users u ON u.id = m."userId" WHERE m.id/, member);
    when(/FROM workspaces WHERE id/, [{ id: 'w1' }]);
    when(/SELECT role::text AS role FROM memberships/, [{ role: 'editor' }]);
    actor(true);
    const base = h.db.user.findUnique.getMockImplementation()!;
    h.db.user.findUnique.mockImplementation(async (args: any) => args.where.id === 'u1' ? { isInstanceOwner: false, disabledAt: new Date() } : base(args));
    await expect(changeRootMemberRole('root', { membershipId: 'm1', role: 'owner', confirmation: 'CHANGE ROLE ann@x.test IN w1 TO owner' })).rejects.toMatchObject({ code: 'conflict' });
    expect(h.executed).toHaveLength(0);
  });

  it('redacts credential-like name, location query and cookie text in error output', async () => {
    when(/FROM error_events/, [{ id: 'e', source: 'server', name: 'Err token=ABCDEF123456', message: 'cookie: sessionid=abc123', location: '/api/x?code=SECRETCODE&y=1', release: '0123456789abcdef0123456789abcdef01234567', count: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), resolvedAt: null }]);
    const out = JSON.stringify(await listRootErrors('root'));
    expect(out).not.toMatch(/ABCDEF123456|abc123|SECRETCODE/);
    expect(out).toContain('0123456789abcdef0123456789abcdef01234567');
  });
});


describe('integration review regressions', () => {
  it('applies MCP result ceilings before privilege pagination, not after rows are fetched', async () => {
    when(/FROM memberships m JOIN users u/, []);
    const result = await listRootPrivileges('root', { page: 2 }, 7);
    expect(result.pageSize).toBe(7);
    expect(h.queried.at(-1)!.values.slice(-2)).toEqual([7, 7]);
    await expect(listRootPrivileges('root', {}, NaN)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('does not lose older per-kind backup facts when the visible run history is short', async () => {
    const run = (kind: string) => ({ id: kind, kind, status: 'ok', detail: null, startedAt: new Date('2026-10-17T10:00:00Z'), finishedAt: new Date('2026-10-17T10:00:00Z') });
    when(/FROM backup_runs/, [run('offsite')]);
    when(/SELECT DISTINCT ON/, [run('offsite'), run('restore_test')]);
    const result = await readRootBackupStatus('root', new Date('2026-10-17T12:00:00Z'), 1);
    expect(result.runs).toHaveLength(1);
    expect(result.checks.map(item => item.state)).toEqual(['recent', 'recent']);
  });
});
