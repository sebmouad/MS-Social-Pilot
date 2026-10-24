import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ allowed: true, writes: [] as { sql: string; values: unknown[] }[] }));
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'data.workspaceOperationTimeoutMs' ? 120000 : Object.fromEntries(NOTIFICATIONS_CONFIG.map(entry => [entry.key, entry.defaultValue]))[key] }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_: string, fn: () => unknown) => fn() }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async () => ({ workspaceId: 'workspace-a' }), canUseFeature: () => state.allowed }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => state.allowed }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] } }) }));
vi.mock('@/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: async () => [], publishingPostVisibilityWhere: vi.fn() }));
import { NOTIFICATIONS_CONFIG } from '../src/modules/settings/notifications/config';
import { updateNotificationPreferences } from '../src/modules/settings/notifications/server';
const actor = { userId: 'person-a', workspaceId: 'workspace-a' };
beforeEach(() => {
  vi.clearAllMocks(); state.allowed = true; state.writes = [];
  db.user.findUnique.mockResolvedValue({ disabledAt: null });
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => parts.join('').includes('FROM memberships') ? [{ role: 'owner', disabledAt: null }] : []);
  db.$executeRaw.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => { state.writes.push({ sql: parts.join('?'), values }); return 1; });
});
it('binds additional preferences to the current person/workspace and audits the changed flags', async () => {
  await updateNotificationPreferences(actor, { onTokenExpiry: false, onNewInbox: true, confirmation: 'UPDATE NOTIFICATION PREFERENCES' });
  const update = state.writes.find(q => q.sql.startsWith('UPDATE notification_settings'))!;
  expect(update.sql).toContain('WHERE "userId" = ? AND "workspaceId" = ?');
  expect(update.values.slice(-2)).toEqual([actor.userId, actor.workspaceId]);
  expect(update.values).toContain(false);
  expect(update.values).toContain(true);
  expect(update.sql).toContain('IS NOT NULL');
  const audit = state.writes.find(q => q.sql.includes('INSERT INTO activity_logs'))!;
  expect(audit.values.some(value => typeof value === 'string' && value.includes('onTokenExpiry') && value.includes('onNewInbox'))).toBe(true);
});
it('refuses a stale feature grant before any preference write', async () => {
  state.allowed = false;
  await expect(updateNotificationPreferences(actor, { onPublishFailure: false, confirmation: 'UPDATE NOTIFICATION PREFERENCES' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(state.writes).toHaveLength(0);
});
it('requires the exact preference confirmation before any write', async () => {
  await expect(updateNotificationPreferences(actor, { onPublishFailure: false, confirmation: 'wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
  expect(state.writes).toHaveLength(0);
});
