import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() },
  passkey: { deleteMany: vi.fn() }, recoveryCode: { deleteMany: vi.fn() },
  queryRaw: vi.fn(), executeRaw: vi.fn(), transaction: vi.fn<(callback: (tx: unknown) => unknown, options?: unknown) => unknown>(), runtimeConfig: vi.fn(),
}));
state.transaction.mockImplementation((callback: (tx: unknown) => unknown, options: unknown) => callback({ user: state.user, session: state.session, passkey: state.passkey, recoveryCode: state.recoveryCode, $queryRaw: state.queryRaw, $executeRaw: state.executeRaw }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: state.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));

import { OperationError } from '@/lib/operation-error';
import { rootUserConfirmation, type RootUserAction } from '@/lib/root-user-controls';
import { resetRootUserTwoStep, revokeRootUserSessions, setRootUserDisabled } from '@/server/root/user-controls';

describe('Root account controls', () => {
  it('defines exact confirmations for the shared actions', () => {
    const actions: RootUserAction[] = ['disable', 'enable', 'sign-out', 'reset-two-step'];
    expect(actions.map(action => rootUserConfirmation(action, 'member@example.com'))).toEqual([
      'DISABLE member@example.com', 'ENABLE member@example.com', 'SIGN OUT member@example.com', 'RESET TWO-STEP member@example.com',
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    state.transaction.mockImplementation((callback: (tx: unknown) => unknown, options: unknown) => callback({ user: state.user, session: state.session, passkey: state.passkey, recoveryCode: state.recoveryCode, $queryRaw: state.queryRaw, $executeRaw: state.executeRaw }));
    state.runtimeConfig.mockImplementation(async (key: string) => key.endsWith('TimeoutMs') ? 15000 : 5000);
    state.queryRaw.mockResolvedValue([{ id: 'root' }, { id: 'target' }]);
    state.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'root'
      ? { id: 'root', isInstanceOwner: true, disabledAt: null }
      : { id: 'target', email: 'member@example.com', isInstanceOwner: false, disabledAt: null });
    state.user.updateMany.mockResolvedValue({ count: 1 });
    state.session.deleteMany.mockResolvedValue({ count: 2 });
    state.executeRaw.mockResolvedValue(1);
  });

  it('checks the current active owner and locks both rows before reading the target', async () => {
    const order: string[] = [];
    state.queryRaw.mockImplementation(async () => { order.push('lock'); return [{ id: 'root' }, { id: 'target' }]; });
    state.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      order.push(`read:${where.id}`);
      return where.id === 'root' ? { id: 'root', isInstanceOwner: true, disabledAt: null } : { id: 'target', email: 'member@example.com', isInstanceOwner: false, disabledAt: null };
    });
    await setRootUserDisabled('root', 'target', true, 'DISABLE member@example.com');
    expect(order).toEqual(['lock', 'read:root', 'read:target']);
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable', timeout: 15000, maxWait: 5000 }));
  });

  it.each([
    ['demoted', { id: 'root', isInstanceOwner: false, disabledAt: null }],
    ['disabled', { id: 'root', isInstanceOwner: true, disabledAt: new Date() }],
    ['missing', null],
  ])('rejects a %s actor inside the transaction', async (_label, actor) => {
    state.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'root' ? actor : { id: 'target', email: 'member@example.com', isInstanceOwner: false, disabledAt: null });
    await expect(setRootUserDisabled('root', 'target', true, 'DISABLE member@example.com')).rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    expect(state.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects disabling self and the last active instance owner', async () => {
    state.queryRaw.mockResolvedValue([{ id: 'root' }]);
    await expect(setRootUserDisabled('root', 'root', true, 'DISABLE member@example.com')).rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
    state.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'root'
      ? { id: 'root', isInstanceOwner: true, disabledAt: null }
      : { id: 'target', email: 'owner@example.com', isInstanceOwner: true, disabledAt: null });
    state.queryRaw.mockResolvedValue([{ id: 'root' }, { id: 'target' }]);
    state.user.count.mockResolvedValue(1);
    await expect(setRootUserDisabled('root', 'target', true, 'DISABLE owner@example.com')).rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
    expect(state.user.updateMany).not.toHaveBeenCalled();
  });

  it('requires exact confirmation before changing access', async () => {
    await expect(setRootUserDisabled('root', 'target', true, 'yes')).rejects.toMatchObject({ name: 'OperationError', code: 'invalid_request' });
    expect(state.user.updateMany).not.toHaveBeenCalled();
  });

  it('re-enables a disabled account without creating sessions', async () => {
    state.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'root'
      ? { id: 'root', isInstanceOwner: true, disabledAt: null }
      : { id: 'target', email: 'member@example.com', isInstanceOwner: false, disabledAt: new Date() });
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
    state.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'root'
      ? { id: 'root', isInstanceOwner: true, disabledAt: null }
      : { id: 'target', email: 'owner@example.com', isInstanceOwner: true, disabledAt: null });
    await expect(resetRootUserTwoStep('root', 'target', 'RESET TWO-STEP owner@example.com')).rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    expect(state.user.update).not.toHaveBeenCalled();
  });

  it('maps serializable transaction conflicts to a safe reload error', async () => {
    state.transaction.mockRejectedValueOnce({ code: 'P2034' });
    const serializationFailure = await setRootUserDisabled('root', 'target', true, 'DISABLE member@example.com').catch(error => error);
    expect(serializationFailure).toBeInstanceOf(OperationError);
    expect(serializationFailure).toMatchObject({ code: 'conflict' });
    expect(serializationFailure.message).toMatch(/reload/i);
    const raw = new Error('database password leaked');
    state.transaction.mockRejectedValueOnce(raw);
    await expect(setRootUserDisabled('root', 'target', true, 'DISABLE member@example.com')).rejects.toBe(raw);
    expect(raw).not.toBeInstanceOf(OperationError);
  });

  it('keeps the audit atomic with the account mutation', async () => {
    state.executeRaw.mockRejectedValue(new Error('audit unavailable'));
    await expect(setRootUserDisabled('root', 'target', true, 'DISABLE member@example.com')).rejects.toThrow('audit unavailable');
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });
});
