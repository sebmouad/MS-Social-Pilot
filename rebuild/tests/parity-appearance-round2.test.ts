import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), allowed: vi.fn(), config: vi.fn(), query: vi.fn(), execute: vi.fn(), tx: vi.fn(), audit: vi.fn(), set: vi.fn(), mode: 'dark' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: m.mode }), set: m.set }) }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session, prisma: { $queryRaw: m.query, $transaction: m.tx } }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: m.allowed }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: () => true }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: m.audit }));
import { appearanceSession, readAppearance, updateAppearance } from '@/modules/settings/server/appearance';
const actor = { userId: 'person', workspaceId: 'workspace', sessionTokenHash: 'session-hash' };
beforeEach(() => {
  vi.clearAllMocks(); m.mode = 'dark';
  m.session.mockResolvedValue({ userId: 'person', user: { id: 'person', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
  m.permissions.mockResolvedValue({}); m.entitlements.mockResolvedValue({ workspaceId: 'workspace' }); m.allowed.mockReturnValue(true);
  m.config.mockImplementation(async key => ({ 'theme.default': 'vivid', 'theme.defaultMode': 'system', 'settings.appearanceCookieMaxAgeSeconds': 42 })[key as string]);
  m.query.mockResolvedValue([{ theme: 'warm' }]); m.execute.mockResolvedValue(1);
  m.tx.mockImplementation(async run => run({ $executeRaw: m.execute }));
});
it('reads per-user saved theme and cookie-only mode with current feature authority', async () => {
  expect(await appearanceSession(actor)).toMatchObject({ theme: 'warm', mode: 'dark', modePersistence: 'cookie', themes: ['vivid', 'meta', 'warm', 'clean'], modes: ['light', 'dark', 'system'] });
  expect(m.query.mock.calls[0][1]).toBe('person');
  expect(m.allowed).toHaveBeenCalledWith({}, 'settings/appearance', 'read');
});
it('falls back to Root defaults for unsupported legacy palettes or invalid modes', async () => {
  m.query.mockResolvedValue([{ theme: 'facebook' }]);
  expect(await readAppearance(actor, 'invalid')).toMatchObject({ theme: 'vivid', mode: 'system' });
});
it.each(['vivid', 'meta', 'warm', 'clean'])('persists %s without a schema/mode column and audits atomically', async theme => {
  const result = await appearanceSession(actor, { theme, mode: 'system', confirmation: 'UPDATE APPEARANCE' });
  expect(result).toEqual({ theme, mode: 'system', modePersistence: 'cookie' });
  expect(m.execute.mock.calls[0].slice(1)).toEqual([theme, 'person']);
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), 'person', 'account.appearance_updated', { theme, mode: 'system', modePersistence: 'cookie' });
  expect(m.set).toHaveBeenCalledWith('social-pilot-mode', 'system', expect.objectContaining({ maxAge: 42, sameSite: 'lax' }));
  expect(m.set).toHaveBeenCalledWith('social-pilot-theme', theme, expect.objectContaining({ maxAge: 42 }));
});
it.each([{ theme: 'facebook' }, { mode: 'night' }, { confirmation: 'wrong' }, { surprise: true }])('rejects invalid choices/confirmation before writes %j', async patch => {
  await expect(updateAppearance(actor, { theme: 'meta', mode: 'light', confirmation: 'UPDATE APPEARANCE', ...patch })).rejects.toMatchObject({ code: 'invalid_request' });
  expect(m.tx).not.toHaveBeenCalled();
});
it('refuses bearer credentials, stale sessions and current permission denial', async () => {
  await expect(readAppearance({ ...actor, apiKeyId: 'key' })).rejects.toMatchObject({ code: 'forbidden' });
  m.session.mockResolvedValueOnce(null);
  await expect(readAppearance(actor)).rejects.toMatchObject({ code: 'unauthorized' });
  m.allowed.mockReturnValue(false);
  await expect(updateAppearance(actor, { theme: 'clean', mode: 'light', confirmation: 'UPDATE APPEARANCE' })).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.tx).not.toHaveBeenCalled();
});
it('does not set cookies when the database or audit fails', async () => {
  m.audit.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(appearanceSession(actor, { theme: 'clean', mode: 'light', confirmation: 'UPDATE APPEARANCE' })).rejects.toThrow('audit unavailable');
  expect(m.set).not.toHaveBeenCalled();
  m.execute.mockResolvedValueOnce(0);
  await expect(appearanceSession(actor, { theme: 'clean', mode: 'light', confirmation: 'UPDATE APPEARANCE' })).rejects.toMatchObject({ code: 'conflict' });
  expect(m.set).not.toHaveBeenCalled();
});
