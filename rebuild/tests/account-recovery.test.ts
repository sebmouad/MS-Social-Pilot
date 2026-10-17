import { describe, expect, it, vi } from 'vitest';
import { createAccountRecoveryService } from '@/modules/settings/server/account-recovery';
import type { TransactionalMailInput } from '@/server/mail';

const active = { userId: 'user-1', email: 'member@example.test', token: Buffer.alloc(32, 7).toString('base64url') };
function service(overrides: Record<string, unknown> = {}) {
  const deps = {
    issue: vi.fn(async (email: string) => email === active.email ? active : null),
    tokenIsUsable: vi.fn(async () => true),
    consume: vi.fn(async (_token: string, _passwordHash: string, _now: Date) => true),
    passwordPolicy: vi.fn(async () => ({ minLength: 12, maxBytes: 800 })),
    ttlMinutes: vi.fn(async () => 60),
    mailReady: vi.fn(async () => true),
    mailOrigin: vi.fn(async () => 'https://social.example'),
    send: vi.fn(async (_input: TransactionalMailInput) => ({ status: 'sent' as const, deliveryId: 'delivery-1' })),
    now: () => new Date('2026-10-17T12:00:00Z'),
    ...overrides,
  };
  return { app: createAccountRecoveryService(deps as never), deps };
}

describe('account recovery', () => {
  it('gives active and unknown email addresses the same public request receipt', async () => {
    const { app, deps } = service();
    const activeReceipt = await app.request(active.email);
    const unknownReceipt = await app.request('nobody@example.test');
    expect(activeReceipt).toEqual({ requested: true });
    expect(unknownReceipt).toEqual(activeReceipt);
    expect(deps.send).toHaveBeenCalledOnce();
  });

  it('sends the one-use token only in a fragment link and treats mail failure as non-enumerating', async () => {
    const { app, deps } = service({ send: vi.fn(async (_input: TransactionalMailInput) => { throw new Error('secret SMTP response'); }) });
    await expect(app.request(active.email)).resolves.toEqual({ requested: true });
    const mail = vi.mocked(deps.send).mock.calls[0]?.[0];
    expect(mail?.text).toContain(`/password-recovery#token=${active.token}`);
    expect(JSON.stringify({ result: await app.request('unknown@example.test') })).not.toContain(active.token);
  });

  it('enforces the shared password policy and consumes a valid reset once without issuing a session', async () => {
    const { app, deps } = service();
    await expect(app.reset(active.token, 'short')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(deps.consume).not.toHaveBeenCalled();
    await expect(app.reset(active.token, 'a sufficiently long password')).resolves.toEqual({ reset: true });
    expect(deps.consume).toHaveBeenCalledOnce();
    const [, passwordHash, now] = vi.mocked(deps.consume).mock.calls[0]!;
    expect(passwordHash).toMatch(/^scrypt:16384:/);
    expect(now).toEqual(new Date('2026-10-17T12:00:00Z'));
  });

  it('does not expose persistence errors or treat an unknown/expired token as success', async () => {
    const broken = service({ consume: vi.fn(async (_token: string, _passwordHash: string, _now: Date) => { throw new Error('database credentials'); }) });
    await expect(broken.app.reset(active.token, 'a sufficiently long password')).rejects.toMatchObject({ code: 'unavailable', message: expect.not.stringContaining('database credentials') });
  });

  it('checks token state before password policy or scrypt work', async () => {
    const { app, deps } = service({ tokenIsUsable: vi.fn(async () => false) });
    await expect(app.reset(active.token, 'a sufficiently long password')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(deps.passwordPolicy).not.toHaveBeenCalled();
    expect(deps.consume).not.toHaveBeenCalled();
  });

  it('keeps requests generic when token TTL or public mail origin is unavailable', async () => {
    const ttl = service({ ttlMinutes: vi.fn(async () => 0) });
    await expect(ttl.app.request(active.email)).resolves.toEqual({ requested: true });
    expect(ttl.deps.issue).not.toHaveBeenCalled();
    const origin = service({ mailOrigin: vi.fn(async () => '') });
    await expect(origin.app.request(active.email)).resolves.toEqual({ requested: true });
    expect(origin.deps.issue).not.toHaveBeenCalled();
    expect(origin.deps.send).not.toHaveBeenCalled();
    const disabledMail = service({ mailReady: vi.fn(async () => false) });
    await expect(disabledMail.app.request(active.email)).resolves.toEqual({ requested: true });
    expect(disabledMail.deps.issue).not.toHaveBeenCalled();
  });
});
