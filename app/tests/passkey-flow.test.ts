import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), updateMany: vi.fn() },
  passkey: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  user: { findUniqueOrThrow: vi.fn() },
  recoveryCode: { updateMany: vi.fn() },
  cookies: { get: vi.fn(), set: vi.fn() },
  generate: vi.fn(), verify: vi.fn(),
  config: vi.fn(),
  storedChallenge: '',
}));
vi.mock('next/headers', () => ({ cookies: async () => state.cookies }));
vi.mock('../src/server/data', () => ({ prisma: { session: state.session, passkey: state.passkey, user: state.user, recoveryCode: state.recoveryCode, $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ session: state.session, passkey: state.passkey, user: state.user, recoveryCode: state.recoveryCode }) } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('@simplewebauthn/server', () => ({ generateAuthenticationOptions: state.generate, verifyAuthenticationResponse: state.verify }));

import { beginPasskeyVerification, verifyPasskeySecondStep } from '../src/server/two-step';

beforeEach(() => {
  vi.clearAllMocks();
  state.storedChallenge = JSON.stringify({ challenge: 'challenge-1', issuedAt: Date.now() });
  state.cookies.get.mockReturnValue({ value: 'A'.repeat(43) });
  state.session.findUnique.mockImplementation(async ({ select }: { select: { challenge?: boolean } }) => select?.challenge
    ? { challenge: state.storedChallenge }
    : { id: 'session-1', userId: 'user-1', pending: 'verify', expiresAt: new Date(Date.now() + 60_000), user: { id: 'user-1', disabledAt: null } });
  state.session.updateMany.mockResolvedValue({ count: 1 });
  state.passkey.findMany.mockResolvedValue([{ credentialId: 'credential-1', transports: ['internal'] }]);
  state.passkey.findUnique.mockResolvedValue({ id: 'passkey-1', userId: 'user-1', credentialId: 'credential-1', publicKey: Buffer.from([1, 2]), counter: 1, transports: ['internal'] });
  state.passkey.updateMany.mockResolvedValue({ count: 1 });
  state.generate.mockResolvedValue({ challenge: 'challenge-1' });
  state.verify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 2 } });
  state.config.mockImplementation(async (key: string) => key === 'auth.passkeyOrigin' ? 'https://social.example.test' : key === 'auth.passkeyChallengeMinutes' ? 5 : 30);
});

describe('pending passkey verification', () => {
  it('issues a challenge bound to the current pending session and configured origin', async () => {
    expect(await beginPasskeyVerification()).toEqual({ challenge: 'challenge-1' });
    expect(state.generate).toHaveBeenCalledWith(expect.objectContaining({ rpID: 'social.example.test', allowCredentials: [{ id: 'credential-1', transports: ['internal'] }] }));
    expect(state.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'session-1', pending: 'verify' }), data: { challenge: expect.stringContaining('"challenge":"challenge-1"') } }));
  });

  it('consumes the challenge once, verifies origin and owner, then completes the session', async () => {
    await verifyPasskeySecondStep({ id: 'credential-1' } as never);
    expect(state.session.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ challenge: state.storedChallenge }), data: { challenge: null } }));
    expect(state.verify).toHaveBeenCalledWith(expect.objectContaining({ expectedChallenge: 'challenge-1', expectedOrigin: 'https://social.example.test', expectedRPID: 'social.example.test' }));
    expect(state.passkey.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'passkey-1', counter: 1 }, data: expect.objectContaining({ counter: 2 }) }));
    expect(state.session.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ pending: null, challenge: null }) }));
    expect(state.cookies.set).toHaveBeenCalled();
  });

  it('rejects replayed challenges and credentials owned by another user', async () => {
    state.session.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(verifyPasskeySecondStep({ id: 'credential-1' } as never)).rejects.toThrow(/expired/);
    expect(state.verify).not.toHaveBeenCalled();
    state.session.updateMany.mockResolvedValue({ count: 1 });
    state.passkey.findUnique.mockResolvedValue({ id: 'passkey-1', userId: 'other-user' });
    await expect(verifyPasskeySecondStep({ id: 'credential-1' } as never)).rejects.toThrow(/could not be verified/);
    expect(state.verify).not.toHaveBeenCalled();
  });

  it('rejects an expired challenge before consuming it or checking a credential', async () => {
    state.storedChallenge = JSON.stringify({ challenge: 'challenge-1', issuedAt: Date.now() - 6 * 60_000 });
    await expect(verifyPasskeySecondStep({ id: 'credential-1' } as never)).rejects.toThrow(/expired/);
    expect(state.session.updateMany).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
  });
});
