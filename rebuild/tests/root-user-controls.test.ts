import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() },
  passkey: { deleteMany: vi.fn() }, recoveryCode: { deleteMany: vi.fn() },
  executeRaw: vi.fn(), transaction: vi.fn(),
}));
state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ user: state.user, session: state.session, passkey: state.passkey, recoveryCode: state.recoveryCode, $executeRaw: state.executeRaw }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: state.transaction } }));

import { resetRootUserTwoStep, revokeRootUserSessions, setRootUserDisabled } from '@/server/root/user-controls';

describe('Root account controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ user: state.user, session: state.session, passkey: state.passkey, recoveryCode: state.recoveryCode, $executeRaw: state.executeRaw }));
    state.user.findUnique.mockResolvedValue({ id: 'target', email: 'member@example.com', isInstanceOwner: false, disabledAt: null });
    state.user.updateMany.mockResolvedValue({ count: 1 });
    state.session.deleteMany.mockResolvedValue({ count: 2 });
    state.executeRaw.mockResolvedValue(1);
  });

  it('disables account, revokes all sessions and audits in one transaction', async () => {
    await expect(setRootUserDisabled('root', 'target', true, 'DISABLE member@example.com')).resolves.toEqual({ changed: true, sessionsRevoked: 2 });
    expect(state.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'target', disabledAt: null } }));
    expect(state.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
    expect(state.executeRaw).toHaveBeenCalledOnce();
  });

  it('rejects disabling self and the last active instance owner', async () => {
    await expect(setRootUserDisabled('target', 'target', true, 'DISABLE member@example.com')).rejects.toThrow(/own account/);
    state.user.findUnique.mockResolvedValue({ id: 'target', email: 'owner@example.com', isInstanceOwner: true, disabledAt: null });
    state.user.count.mockResolvedValue(1);
    await expect(setRootUserDisabled('root', 'target', true, 'DISABLE owner@example.com')).rejects.toThrow(/last active instance owner/);
    expect(state.user.updateMany).not.toHaveBeenCalled();
  });

  it('requires exact confirmation before changing access', async () => {
    await expect(setRootUserDisabled('root', 'target', true, 'yes')).rejects.toThrow(/confirmation/);
    expect(state.user.updateMany).not.toHaveBeenCalled();
  });

  it('re-enables a disabled account without creating sessions', async () => {
    state.user.findUnique.mockResolvedValue({ id: 'target', email: 'member@example.com', isInstanceOwner: false, disabledAt: new Date() });
    await expect(setRootUserDisabled('root', 'target', false, 'ENABLE member@example.com')).resolves.toEqual({ changed: true, sessionsRevoked: 0 });
    expect(state.session.deleteMany).not.toHaveBeenCalled();
    expect(state.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { disabledAt: null } }));
  });

  it('revokes all sessions for another account and audits the action', async () => {
    await expect(revokeRootUserSessions('root', 'target', 'SIGN OUT member@example.com')).resolves.toEqual({ sessionsRevoked: 2 });
    expect(state.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
    expect(state.executeRaw).toHaveBeenCalledOnce();
  });

  it('resets non-root second factors, recovery codes and sessions together', async () => {
    state.passkey.deleteMany.mockResolvedValue({ count: 1 });
    state.recoveryCode.deleteMany.mockResolvedValue({ count: 3 });
    await expect(resetRootUserTwoStep('root', 'target', 'RESET TWO-STEP member@example.com')).resolves.toEqual({ sessionsRevoked: 2 });
    expect(state.user.update).toHaveBeenCalledWith({ where: { id: 'target' }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } });
    expect(state.passkey.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
    expect(state.recoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
    expect(state.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
  });

  it('never resets second factors of an instance owner through the browser', async () => {
    state.user.findUnique.mockResolvedValue({ id: 'target', email: 'owner@example.com', isInstanceOwner: true, disabledAt: null });
    await expect(resetRootUserTwoStep('root', 'target', 'RESET TWO-STEP owner@example.com')).rejects.toThrow(/instance owner/);
    expect(state.user.update).not.toHaveBeenCalled();
  });
});
