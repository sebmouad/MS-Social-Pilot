import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ viewer: vi.fn(), session: vi.fn(), user: vi.fn(), password: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: m.viewer }));
vi.mock('@/modules/settings/person-keys/session', () => ({ personKeySessionActor: m.session }));
vi.mock('@/server/data', () => ({ prisma: { user: { findUnique: m.user } } }));
vi.mock('@/server/account-settings', () => ({ accountPasswordPolicy: m.password }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'fr' }) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT ${path}`); }, usePathname: () => '/settings/account' }));
import AccountPage from '@/modules/settings/ui/account/AccountScreen';
import { PersonKeysAccountFallback } from '@/modules/settings/person-keys/AccountFallback';
beforeEach(() => { vi.clearAllMocks(); m.viewer.mockRejectedValue(new Error('NEXT_REDIRECT /no-workspace')); m.session.mockResolvedValue({ userId: 'person' }); m.user.mockResolvedValue({ name: 'Person', disabledAt: null }); });
it('offers person credential management when workspace account settings refuse access', async () => {
 const page = await AccountPage(); expect(page.type).toBe(PersonKeysAccountFallback); expect(page.props.locale).toBe('fr');
 const fallback = await PersonKeysAccountFallback({ locale: 'fr' });
 expect(fallback.props).toMatchObject({ enabledFeatures: ['settings/account'], rootAccess: false, userName: 'Person', workspaceName: 'Compte' });
 expect(m.user.mock.calls[0][0].where).toEqual({ id: 'person' }); expect(m.password).not.toHaveBeenCalled();
});
it.each([null, { name: 'Person', disabledAt: new Date() }])('refuses disabled or missing people in the account-only fallback', async user => {
 m.user.mockResolvedValue(user); await expect(PersonKeysAccountFallback({ locale: 'en' })).rejects.toThrow('/sign-in');
});
it('refuses anonymous fallback and propagates unexpected workspace failures', async () => {
 m.session.mockRejectedValueOnce(new Error('expired')); await expect(PersonKeysAccountFallback({ locale: 'en' })).rejects.toThrow('/sign-in');
 expect(m.user).not.toHaveBeenCalled();
 m.viewer.mockRejectedValueOnce(new Error('database failure')); await expect(AccountPage()).rejects.toThrow('database failure');
});
