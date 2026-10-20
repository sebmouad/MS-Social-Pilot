import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Root connection disconnect (retain) and installation transfer on the guarded `_preview` database. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => { const v = shared.client?.[key as string]; return typeof v === 'function' ? v.bind(shared.client) : v; } }) }));

import { disconnectRootConnection, previewRootConnectionDeletion, rootDisconnectConfirmation, rootDisconnectDeleteConfirmation } from '../src/server/root/legacy/connections';
import { installationTransferConfirmation, transferInstallationOwnership } from '../src/server/root/legacy/transfer';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('Root connection and installation controls on real PostgreSQL', () => {
  let db: PrismaClient; let originalOwners: string[] = [];
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const root = `rootctl_${tag}_root`; const other = `rootctl_${tag}_other`; const ws = `rootctl_${tag}_ws`; const account = `rootctl_${tag}_sa`; const target = `rootctl_${tag}_t`;
  const email = (id: string) => `${id}@example.invalid`;
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    originalOwners = (await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "isInstanceOwner"`).map(r => r.id);
    // The test needs a single synthetic owner; the real preview owner flag is restored in afterAll.
    await db.$executeRaw`UPDATE users SET "isInstanceOwner" = false WHERE "isInstanceOwner"`;
    await db.$executeRaw`INSERT INTO users (id, email, name, "passwordHash", "updatedAt", "isInstanceOwner") VALUES (${root}, ${email(root)}, 'Synthetic root', 'x', NOW(), true), (${other}, ${email(other)}, 'Synthetic next root', 'x', NOW(), false)`;
    await db.workspace.create({ data: { id: ws, name: 'Synthetic root controls', slug: `rootctl-${tag}`, timezone: 'UTC' } });
    await db.$executeRaw`INSERT INTO social_accounts (id, "workspaceId", provider, "providerUserId", name, "accessToken", "createdAt", "updatedAt") VALUES (${account}, ${ws}, 'facebook', ${'u' + tag}, 'Synthetic account', 'not-a-token', NOW(), NOW())`;
    await db.$executeRaw`INSERT INTO targets (id, "workspaceId", "socialAccountId", type, "providerId", name, enabled, "canPublish", "createdAt", "updatedAt") VALUES (${target}, ${ws}, ${account}, 'page', ${'p' + tag}, 'Synthetic page', true, true, NOW(), NOW())`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" IN (${root}, ${other})`;
    await db.$executeRaw`DELETE FROM targets WHERE id = ${target}`;
    await db.$executeRaw`DELETE FROM social_accounts WHERE id = ${account}`;
    await db.$executeRaw`DELETE FROM workspaces WHERE id = ${ws}`;
    await db.$executeRaw`DELETE FROM users WHERE id IN (${root}, ${other})`;
    if (originalOwners.length) await db.$executeRaw`UPDATE users SET "isInstanceOwner" = true WHERE id = ANY(${originalOwners}::text[])`;
    await db.$disconnect();
  });

  it('disconnects a connection for Root in retain mode only, keeping its channel data', async () => {
    await expect(disconnectRootConnection(other, account, rootDisconnectConfirmation(account))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(disconnectRootConnection(root, account, 'DISCONNECT')).rejects.toMatchObject({ code: 'invalid_request' });
    const result = await disconnectRootConnection(root, account, rootDisconnectConfirmation(account));
    expect(result).toMatchObject({ mode: 'retain', providerRevoked: false, workspaceId: ws });
    const sa = (await db.$queryRaw<Array<{ invalidatedAt: Date | null }>>`SELECT "invalidatedAt" FROM social_accounts WHERE id = ${account}`)[0]!;
    expect(sa.invalidatedAt).not.toBeNull();
    const t = (await db.$queryRaw<Array<{ enabled: boolean }>>`SELECT enabled FROM targets WHERE id = ${target}`)[0]!;
    expect(t.enabled).toBe(false);
  });

  it('deletes a connection and its channel records for Root only with the dedicated confirmation', async () => {
    await expect(disconnectRootConnection(other, account, rootDisconnectDeleteConfirmation(account), 'delete')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(disconnectRootConnection(root, account, rootDisconnectConfirmation(account), 'delete')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await previewRootConnectionDeletion(root, account)).toMatchObject({ workspaceId: ws, counts: { channels: 1, scheduledRemote: 0 } });
    expect(await disconnectRootConnection(root, account, rootDisconnectDeleteConfirmation(account), 'delete')).toMatchObject({ mode: 'delete', providerRevoked: false, deleted: { channels: 1 } });
    expect(await db.$queryRaw`SELECT 1 FROM social_accounts WHERE id = ${account}`).toHaveLength(0);
    expect(await db.$queryRaw`SELECT 1 FROM targets WHERE id = ${target}`).toHaveLength(0);
  });

  it('transfers the installation to exactly one new owner and refuses a non-owner', async () => {
    await expect(transferInstallationOwnership(other, { email: email(root), confirmation: installationTransferConfirmation(email(root)) })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(transferInstallationOwnership(root, { email: email(other), confirmation: 'wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await transferInstallationOwnership(root, { email: email(other), confirmation: installationTransferConfirmation(email(other)) })).toMatchObject({ transferred: true, toUserId: other });
    const owners = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "isInstanceOwner"`;
    expect(owners.map(o => o.id)).toEqual([other]);
  });
});
