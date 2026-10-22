import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ raw: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.raw, $executeRaw: mocks.execute, $transaction: mocks.transaction } }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: (e: { features: Record<string, boolean> }, f: string) => e.features[f] === true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purge, withWorkspaceOperation: (_id: string, fn: () => unknown) => fn() }));
vi.mock('@/server/config/store', async () => {
 const { AGENTS_CONFIG, AGENT_COPY_CONFIG } = await import('../src/modules/agents/config');
 return { runtimeConfig: async (key: string) => [...AGENTS_CONFIG, ...AGENT_COPY_CONFIG].find(e => e.key === key)?.defaultValue };
});
import { writingAgents } from '../src/modules/agents/server/service';
import { resolvePermissions } from '../src/server/permissions';
const actor = { userId: 'member', workspaceId: 'workspace' };
beforeEach(() => {
 vi.resetAllMocks();
 mocks.entitlements.mockResolvedValue({ workspaceId: 'workspace', features: { 'agents/library': true } });
 mocks.raw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('memberships m') ? [{ id: 'member', role: 'owner', suspendedAt: null }] : []);
 mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: mocks.raw, $executeRaw: mocks.execute }));
 mocks.execute.mockResolvedValue(1);
});
function role(value: string) {
 mocks.permissions.mockResolvedValue(resolvePermissions({ role: value, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] }));
}
describe('writing agents current service authorization', () => {
 it('lets an owner read workspace-scoped briefs', async () => {
  role('owner'); await expect(writingAgents(actor, { action: 'list' })).resolves.toEqual({ agents: [] });
  expect(mocks.raw.mock.calls.at(-1)?.slice(1)).toContain('workspace');
 });
 it.each(['editor', 'contributor', 'viewer'])('allows %s reads but denies writes under current shared permissions', async value => {
  role(value); await expect(writingAgents(actor, { action: 'list' })).resolves.toEqual({ agents: [] });
  await expect(writingAgents(actor, { action: 'delete', id: 'a', confirmation: 'DELETE a' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(mocks.execute).not.toHaveBeenCalled();
 });
 it('denies a cross-workspace membership before querying briefs', async () => {
  role('owner'); mocks.raw.mockResolvedValue([]);
  await expect(writingAgents({ ...actor, workspaceId: 'foreign' }, { action: 'list' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(mocks.raw).toHaveBeenCalledTimes(1);
 });
 it('does not delete a foreign agent or audit a nonexistent mutation', async () => {
  role('owner'); mocks.execute.mockResolvedValue(0);
  await expect(writingAgents(actor, { action: 'delete', id: 'foreign-agent', confirmation: 'DELETE foreign-agent' })).rejects.toMatchObject({ code: 'not_found' });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0].slice(1)).toEqual(['foreign-agent', 'workspace']);
 });
});
