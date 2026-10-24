import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ cookies: {} as Record<string, string>, session: vi.fn(), query: vi.fn(), find: vi.fn(), config: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (key: string) => m.cookies[key] ? { value: m.cookies[key] } : undefined }) }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session, prisma: { $queryRaw: m.query, appSetting: { findUnique: m.find } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/modules/settings/server/account', () => ({ authorizeAccountSession: vi.fn() }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: vi.fn() }));
import { initialAppearance } from '@/modules/settings/server/appearance';
beforeEach(() => {
  vi.clearAllMocks();
  m.cookies = { msp_session: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  m.session.mockResolvedValue({ userId: 'person', user: { id: 'person', disabledAt: null }, pending: null, expiresAt: new Date('2099-01-01') });
  m.query.mockResolvedValue([{ theme: 'clean' }]); m.find.mockResolvedValue({ value: 'dark' });
  m.config.mockImplementation(async (key: string) => ({ 'theme.default': 'vivid', 'theme.defaultMode': 'system' })[key]);
});
it('loads both account preferences on a new device without cookies', async () => {
  expect(await initialAppearance()).toEqual({ theme: 'clean', mode: 'dark' });
  expect(m.query.mock.calls[0][1]).toBe('person');
  expect(m.find).toHaveBeenCalledWith({ where: { key: 'settings.appearance.user.person.mode' }, select: { value: true } });
});
it('keeps valid cookies as a fast cache without account lookups', async () => {
  m.cookies['social-pilot-theme'] = 'warm'; m.cookies['social-pilot-mode'] = 'light';
  expect(await initialAppearance()).toEqual({ theme: 'warm', mode: 'light' });
  expect(m.session).not.toHaveBeenCalled(); expect(m.query).not.toHaveBeenCalled();
});
it('fills only absent or invalid cache entries from the account', async () => {
  m.cookies['social-pilot-theme'] = 'warm'; m.cookies['social-pilot-mode'] = 'invalid';
  expect(await initialAppearance()).toEqual({ theme: 'warm', mode: 'dark' });
});
it.each(['absent', 'malformed', 'expired', 'pending', 'disabled'] as const)('uses Root defaults for %s sessions without reading private preferences', async kind => {
  if (kind === 'absent') m.cookies = {};
  if (kind === 'malformed') m.cookies.msp_session = 'bad';
  if (kind === 'expired') m.session.mockResolvedValue(null);
  if (kind === 'pending') m.session.mockResolvedValue({ userId: 'person', user: { id: 'person', disabledAt: null }, pending: 'two-factor', expiresAt: new Date('2099-01-01') });
  if (kind === 'disabled') m.session.mockResolvedValue({ userId: 'person', user: { id: 'person', disabledAt: new Date() }, pending: null, expiresAt: new Date('2099-01-01') });
  expect(await initialAppearance()).toEqual({ theme: 'vivid', mode: 'system' });
  expect(m.query).not.toHaveBeenCalled(); expect(m.find).not.toHaveBeenCalled();
});
