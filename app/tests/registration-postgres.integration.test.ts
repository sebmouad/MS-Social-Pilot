import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Open registration and email verification against the guarded `_preview` database; mail and config are stubbed. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/account-settings', () => ({ accountPasswordPolicy: async () => ({ minLength: 10, maxBytes: 1024 }), validateNewPassword: (p: string, policy: { minLength: number }) => p.length >= policy.minLength }));

import { createRegistrationService } from '../src/modules/settings/server/registration';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('open registration on real PostgreSQL', () => {
  let db: PrismaClient;
  const email = `reg-${randomUUID().slice(0, 8)}@example.invalid`;
  const sent: Array<{ to: string; text: string; template: string }> = [];
  let open = true;
  const service = () => createRegistrationService({
    open: async () => open, ttlMinutes: async () => 60, mailReady: async () => true, mailOrigin: async () => 'http://localhost:3200',
    send: (async (m: { to: string; text: string; template: string }) => { sent.push(m); return { status: 'sent' }; }) as never, now: () => new Date(),
  });
  beforeAll(() => { db = isolated(url!); shared.client = db as unknown as Record<string, unknown>; });
  afterAll(async () => {
    if (!db) return;
    const users = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${email}`;
    for (const { id } of users) {
      const ws = await db.$queryRaw<Array<{ workspaceId: string }>>`SELECT "workspaceId" FROM memberships WHERE "userId" = ${id}`;
      await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${id}`;
      await db.$executeRaw`DELETE FROM email_tokens WHERE "userId" = ${id}`;
      await db.$executeRaw`DELETE FROM memberships WHERE "userId" = ${id}`;
      for (const { workspaceId } of ws) await db.$executeRaw`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await db.$executeRaw`DELETE FROM users WHERE id = ${id}`;
    }
    await db.$disconnect();
  });

  it('creates an unverified account without a workspace, then verification creates the owner workspace once', async () => {
    expect(await service().register({ name: 'Synthetic Registrant', email, password: 'long-enough-pass' })).toEqual({ requested: true });
    const user = (await db.$queryRaw<Array<{ id: string; emailVerifiedAt: Date | null; isInstanceOwner: boolean }>>`SELECT id, "emailVerifiedAt", "isInstanceOwner" FROM users WHERE email = ${email}`)[0]!;
    expect(user.emailVerifiedAt).toBeNull(); expect(user.isInstanceOwner).toBe(false);
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM memberships WHERE "userId" = ${user.id}`).toHaveLength(0);
    const mail = sent.find(m => m.to === email && m.template === 'account.verifyEmail')!;
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);
    const result = await service().verify(token);
    expect(result.verified).toBe(true); expect(result.workspaceId).toBeTruthy();
    const m = await db.$queryRaw<Array<{ role: string }>>`SELECT role::text AS role FROM memberships WHERE "userId" = ${user.id} AND "workspaceId" = ${result.workspaceId}`;
    expect(m[0]!.role).toBe('owner');
    expect((await db.$queryRaw<Array<{ v: Date | null }>>`SELECT "emailVerifiedAt" AS v FROM users WHERE id = ${user.id}`)[0]!.v).not.toBeNull();
    await expect(service().verify(token)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('does not reveal or duplicate an existing address, and refuses when closed', async () => {
    sent.length = 0;
    expect(await service().register({ name: 'Second', email, password: 'long-enough-pass' })).toEqual({ requested: true });
    expect(sent.map(m => m.template)).toEqual(['account.registrationExisting']);
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM users WHERE email = ${email}`).toHaveLength(1);
    open = false;
    await expect(service().register({ name: 'Closed', email: `closed-${email}`, password: 'long-enough-pass' })).rejects.toMatchObject({ code: 'forbidden' });
    open = true;
  });
});
