import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), allowed: vi.fn(), config: vi.fn(), query: vi.fn(), execute: vi.fn(), tx: vi.fn(), audit: vi.fn(), set: vi.fn(), find: vi.fn(), upsert: vi.fn(), mode: 'dark' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: m.mode }), set: m.set }) }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session, prisma: { $queryRaw: m.query, $transaction: m.tx, appSetting: { findUnique: m.find } } }));
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
  m.find.mockResolvedValue({ value: 'dark' }); m.query.mockResolvedValue([{ theme: 'warm' }]); m.execute.mockResolvedValue(1);
  m.tx.mockImplementation(async run => run({ $executeRaw: m.execute, appSetting: { upsert: m.upsert } }));
});
it('reads per-user saved theme and account mode independently of browser cookies with current feature authority', async () => {
  m.mode = 'light';
  expect(await appearanceSession(actor)).toMatchObject({ theme: 'warm', mode: 'dark', modePersistence: 'account', themes: ['vivid', 'meta', 'warm', 'clean'], modes: ['light', 'dark', 'system'] });
  expect(m.query.mock.calls[0][1]).toBe('person');
  expect(m.find).toHaveBeenCalledWith({ where: { key: 'settings.appearance.user.person.mode' }, select: { value: true } });
  expect(m.allowed).toHaveBeenCalledWith({}, 'settings/appearance', 'read');
});
it('falls back to Root defaults for unsupported legacy palettes or invalid modes', async () => {
  m.query.mockResolvedValue([{ theme: 'facebook' }]);
  m.find.mockResolvedValue({ value: 'invalid' });
  expect(await readAppearance(actor)).toMatchObject({ theme: 'vivid', mode: 'system' });
});
it.each(['vivid', 'meta', 'warm', 'clean'])('persists %s without a schema/mode column and audits atomically', async theme => {
  const result = await appearanceSession(actor, { theme, mode: 'system', confirmation: 'UPDATE APPEARANCE' });
  expect(result).toEqual({ theme, mode: 'system', modePersistence: 'account' });
  expect(m.execute.mock.calls[0].slice(1)).toEqual([theme, 'person']);
  expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'settings.appearance.user.person.mode' }, create: expect.objectContaining({ value: 'system', encrypted: false }), update: expect.objectContaining({ value: 'system' }) }));
  expect(m.audit).toHaveBeenCalledWith(expect.anything(), 'person', 'account.appearance_updated', { theme, mode: 'system', modePersistence: 'account' });
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

it('uses the account default for existing accounts without a stored mode', async () => {
  m.find.mockResolvedValue(null);
  expect(await readAppearance(actor)).toMatchObject({ theme: 'warm', mode: 'system', modePersistence: 'account' });
});
it('rejects mode storage failure before audit or cookie updates', async () => {
  m.upsert.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(appearanceSession(actor, { theme: 'clean', mode: 'light', confirmation: 'UPDATE APPEARANCE' })).rejects.toThrow('storage unavailable');
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.set).not.toHaveBeenCalled();
});
