import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), audit: vi.fn(), config: vi.fn(), tx: vi.fn() }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session, prisma: { $transaction: m.tx } }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (permissions: { role: string }, _feature: string, access: string) => access === 'read' || ['owner', 'editor'].includes(permissions.role) }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: () => true }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: m.audit }));
import { WEB_APP_DEFAULTS } from '@/modules/settings/web-app/config';
import { publicWebApp, readWebApp, prepareWebApp, INSTALL_CONFIRMATION } from '@/modules/settings/web-app/service';
const actor = { userId: 'person', workspaceId: 'workspace', sessionTokenHash: 'valid-session-hash' };
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ userId: actor.userId, user: { id: actor.userId, disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
  m.permissions.mockResolvedValue({ role: 'owner' }); m.entitlements.mockResolvedValue({ workspaceId: actor.workspaceId });
  m.config.mockResolvedValue(WEB_APP_DEFAULTS); m.tx.mockImplementation(async run => run({}));
});
it('exposes only public branding for browser metadata without private account reads', async () => {
  expect(await publicWebApp()).toEqual(WEB_APP_DEFAULTS); expect(m.config).toHaveBeenCalledWith('settings.webApp'); expect(m.session).not.toHaveBeenCalled();
});
it.each(['owner', 'editor'])('authorizes %s and audits confirmed preparation, never fabricating installation success', async role => {
  m.permissions.mockResolvedValue({ role });
  expect(await prepareWebApp(actor, { confirmation: INSTALL_CONFIRMATION })).toEqual({ prepared: true, installed: false, browserConfirmationRequired: true });
  expect(m.audit).toHaveBeenCalledWith({}, actor.userId, 'account.web_app_installation_prepared', { workspaceId: actor.workspaceId, browserConfirmationRequired: true });
  expect(m.permissions).toHaveBeenCalledWith(actor.userId, actor.workspaceId);
});
it('allows viewer reads but refuses writes, missing membership and cross-workspace reads', async () => {
  m.permissions.mockResolvedValue({ role: 'viewer' }); expect(await readWebApp(actor)).toEqual(WEB_APP_DEFAULTS);
  await expect(prepareWebApp(actor, { confirmation: INSTALL_CONFIRMATION })).rejects.toMatchObject({ code: 'forbidden' });
  m.permissions.mockResolvedValue(null); await expect(readWebApp(actor)).rejects.toMatchObject({ code: 'forbidden' });
  m.permissions.mockResolvedValue({ role: 'owner' }); m.entitlements.mockResolvedValue({ workspaceId: 'another-workspace' });
  await expect(readWebApp(actor)).rejects.toMatchObject({ code: 'forbidden' }); expect(m.audit).not.toHaveBeenCalled();
});
it.each([{}, { confirmation: 'INSTALL' }, { confirmation: INSTALL_CONFIRMATION, installed: true }])('rejects incorrect or extra consent arguments %j', async input => {
  await expect(prepareWebApp(actor, input)).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.audit).not.toHaveBeenCalled();
});
it('refuses API keys, stale or foreign sessions and Root-disabled installation', async () => {
  await expect(readWebApp({ ...actor, apiKeyId: 'key' })).rejects.toMatchObject({ code: 'forbidden' });
  m.session.mockResolvedValueOnce(null); await expect(readWebApp(actor)).rejects.toMatchObject({ code: 'unauthorized' });
  m.session.mockResolvedValueOnce({ userId: 'someone', user: { id: 'someone', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
  await expect(readWebApp(actor)).rejects.toMatchObject({ code: 'unauthorized' });
  m.config.mockResolvedValue({ ...WEB_APP_DEFAULTS, enabled: false });
  await expect(prepareWebApp(actor, { confirmation: INSTALL_CONFIRMATION })).rejects.toMatchObject({ code: 'forbidden' }); expect(m.audit).not.toHaveBeenCalled();
});
it('rechecks access before audit and fails the operation if audit cannot be saved', async () => {
  m.permissions.mockResolvedValueOnce({ role: 'owner' }).mockResolvedValueOnce(null);
  await expect(prepareWebApp(actor, { confirmation: INSTALL_CONFIRMATION })).rejects.toMatchObject({ code: 'forbidden' }); expect(m.audit).not.toHaveBeenCalled();
  m.permissions.mockResolvedValue({ role: 'owner' }); m.audit.mockRejectedValueOnce(new Error('audit offline'));
  await expect(prepareWebApp(actor, { confirmation: INSTALL_CONFIRMATION })).rejects.toThrow('audit offline');
});
