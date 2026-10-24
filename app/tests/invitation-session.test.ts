import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/secret-crypto';

const state = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  cookieSets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
  session: null as any,
  updateMany: vi.fn(async () => ({ count: 1 })),
  config: new Map<string, unknown>([['settings.invitationSessionMinutes', 30], ['auth.pendingMinutes', 15]]),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => name === 'msp_join' ? (state.cookieValue ? { value: state.cookieValue } : undefined) : name === 'msp_session' ? { value: 'A'.repeat(43) } : undefined,
  set: (name: string, value: string, options: Record<string, unknown>) => { state.cookieSets.push({ name, value, options }); if (name === 'msp_join') state.cookieValue = value; },
}) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => state.config.get(key) }));
vi.mock('@/server/data', () => ({ prisma: { session: { findUnique: async () => state.session, updateMany: state.updateMany } } }));

import { beginInvitationEnrollment, clearInvitationToken, postAuthenticationPath, readInvitationToken, rememberInvitationToken, signedInInvitationAccount } from '@/server/invitation-session';

describe('invitation session continuation', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    state.cookieValue = undefined;
    state.cookieSets = [];
    state.session = null;
    state.updateMany.mockClear();
    state.updateMany.mockResolvedValue({ count: 1 });
    state.config.set('settings.invitationSessionMinutes', 30);
    state.config.set('auth.pendingMinutes', 15);
  });

  it('stores only an encrypted bounded continuation and returns a fixed safe path', async () => {
    const token = 'invite-token_123';
    await rememberInvitationToken(token, new Date(Date.now() + 60 * 60_000));
    expect(state.cookieValue).toBeDefined();
    expect(state.cookieValue).not.toContain(token);
    expect(state.cookieSets.at(-1)).toMatchObject({ name: 'msp_join', options: { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 1800 } });
    expect(await readInvitationToken()).toBe(token);
    expect(await postAuthenticationPath()).toBe('/join');
    await clearInvitationToken();
    expect(await postAuthenticationPath()).toBe('/home');
    expect(state.cookieSets.at(-1)?.options.maxAge).toBe(0);
  });

  it('rejects malformed and expired encrypted cookie payloads', async () => {
    state.cookieValue = encryptSecret(JSON.stringify({ token: 'invite-token', expiresAt: Date.now() - 1 }));
    expect(await readInvitationToken()).toBeNull();
    expect(await postAuthenticationPath()).toBe('/home');
    state.cookieValue = 'invite-token';
    expect(await readInvitationToken()).toBeNull();
    state.cookieValue = encryptSecret(JSON.stringify({ token: '/home?redirect=https://evil.invalid', expiresAt: Date.now() + 60_000 }));
    expect(await postAuthenticationPath()).toBe('/join');
  });

  it('requires a current, active, fully verified account before returning account details', async () => {
    const now = new Date();
    state.session = { id: 'session-1', userId: 'user-1', tokenHash: 'unused', expiresAt: new Date(now.getTime() + 60_000), pending: null,
      user: { id: 'user-1', email: 'member@example.test', disabledAt: null, totpEnabledAt: now, isInstanceOwner: false, _count: { passkeys: 1 } } };
    expect(await signedInInvitationAccount()).toEqual({ id: 'user-1', email: 'member@example.test', sessionId: 'session-1', totpEnabled: true, hasPasskey: true, isInstanceOwner: false });
    state.session.pending = 'verify';
    expect(await signedInInvitationAccount()).toBeNull();
    state.session.pending = null;
    state.session.user.disabledAt = now;
    expect(await signedInInvitationAccount()).toBeNull();
  });

  it('moves only a full factorless session into short enrollment verification', async () => {
    const now = new Date();
    state.session = { id: 'session-1', userId: 'user-1', tokenHash: 'unused', expiresAt: new Date(now.getTime() + 60_000), pending: null,
      user: { id: 'user-1', email: 'member@example.test', disabledAt: null, totpEnabledAt: null, isInstanceOwner: false, _count: { passkeys: 0 } } };
    await beginInvitationEnrollment();
    expect(state.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'session-1', tokenHash: expect.any(String), pending: null, expiresAt: { gt: expect.any(Date) } }, data: { pending: 'enroll', challenge: null, expiresAt: expect.any(Date) } }));
    expect(state.cookieSets.at(-1)).toMatchObject({ name: 'msp_session', options: { maxAge: 900 } });
    state.session.user.totpEnabledAt = now;
    await expect(beginInvitationEnrollment()).rejects.toThrow();
  });
});
