import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
const policy = vi.hoisted(() => ({
  ownerPolicy: 'any_active_owner' as unknown,
  ownerLimit: 100 as unknown,
  resourceTimeout: 60_000,
  resourceMaxWait: 2_000,
  resourceGrace: 5_000,
  workspaceTimeout: 300_000,
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => {
    if (key === 'jobs.workspaceOwnerPolicy') return policy.ownerPolicy;
    if (key === 'jobs.workspaceOwnerLimit') return policy.ownerLimit;
    if (key === 'sync.resourceOperationTimeoutMs') return policy.resourceTimeout;
    if (key === 'sync.resourceOperationMaxWaitMs') return policy.resourceMaxWait;
    if (key === 'sync.resourceFinalizationGraceMs') return policy.resourceGrace;
    if (key === 'data.workspaceOperationTimeoutMs') return policy.workspaceTimeout;
    throw new Error(`Unexpected runtime setting ${key}.`);
  },
}));

import { OperationError } from '../src/lib/operation-error';
import { assertWorkspaceJobAccess } from '../src/server/jobs/access';
import { withSelectedResourceOperation } from '../src/server/platforms/resource-lock';

type Fixture = { prefix: string; workspaceIds: string[]; userIds: string[]; planIds: string[]; settingKeys: string[] };
const PREVIEW_ROOT_SETTINGS = [
  ['platforms.facebook.enabled', true],
  ['platforms.facebook.includedByDefault', false],
  ['platforms.facebook.planFeatures', ['platform_facebook']],
] as const;
const QUALIFYING_FEATURES = ['product_v2', 'publishing/posts', 'platform_facebook'];
const ROLLBACK = '__rollback_workspace_job_access_fixture__';

describe.skipIf(!databaseUrl)('workspace job authorization and resource locking on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Workspace job access integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
  });

  beforeEach(() => {
    integration.prisma = client;
    policy.ownerPolicy = 'any_active_owner';
    policy.ownerLimit = 100;
    policy.resourceTimeout = 60_000;
    policy.resourceMaxWait = 2_000;
    policy.resourceGrace = 5_000;
    policy.workspaceTimeout = 300_000;
  });

  afterEach(async () => {
    integration.prisma = client;
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
  });

  afterAll(async () => {
    integration.prisma = client;
    await observer?.$disconnect();
    await client?.$disconnect();
  });

  async function createFixture(): Promise<Fixture> {
    const prefix = `preview_workspace_job_access_${randomUUID().replaceAll('-', '')}`;
    const fixture: Fixture = { prefix, workspaceIds: [], userIds: [], planIds: [], settingKeys: [] };
    fixtures.push(fixture);
    await addWorkspace(fixture, 'main');
    return fixture;
  }

  async function addWorkspace(fixture: Fixture, label: string): Promise<string> {
    const workspaceId = `${fixture.prefix}_${label}_workspace`;
    fixture.workspaceIds.push(workspaceId);
    await client.workspace.create({ data: { id: workspaceId, name: `Synthetic ${label} workspace`, slug: workspaceId, timezone: 'UTC' } });
    return workspaceId;
  }

  async function addOwner(fixture: Fixture, workspaceId: string, label: string, features: readonly string[], options: { disabled?: boolean; instanceOwner?: boolean } = {}) {
    const userId = `${fixture.prefix}_${label}_user`;
    const planId = `${fixture.prefix}_${label}_plan`;
    fixture.userIds.push(userId);
    fixture.planIds.push(planId);
    await client.user.create({ data: {
      id: userId, email: `${userId}@example.test`, name: `Synthetic ${label}`, passwordHash: 'unusable',
      disabledAt: options.disabled ? new Date('2026-01-01T00:00:00.000Z') : null,
      isInstanceOwner: options.instanceOwner ?? false,
    } });
    await client.membership.create({ data: { id: `${fixture.prefix}_${label}_membership`, userId, workspaceId, role: 'owner' } });
    await client.$executeRaw`INSERT INTO plans (id, key, name, features, "createdAt", "updatedAt") VALUES (${planId}, ${planId}, ${`Synthetic ${label} plan`}, ${features}::text[], NOW(), NOW())`;
    await client.$executeRaw`UPDATE users SET "planId" = ${planId} WHERE id = ${userId}`;
    return userId;
  }

  async function withRootPolicy<T>(run: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await client.$transaction(async tx => {
        // Force deterministic installation policy only inside this transaction.
        // Existing Root values, if any, are restored by the rollback below.
        await tx.$executeRaw`UPDATE app_settings SET value = 'true'::jsonb, encrypted = false, "updatedAt" = NOW() WHERE key LIKE 'entitlements.modules.%' OR key LIKE 'entitlements.features.%'`;
        for (const [key, value] of PREVIEW_ROOT_SETTINGS) {
          await tx.$executeRaw`INSERT INTO app_settings (key, value, encrypted, "updatedAt") VALUES (${key}, ${JSON.stringify(value)}::jsonb, false, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, encrypted = false, "updatedAt" = NOW()`;
        }
        integration.prisma = tx as unknown as PrismaClient;
        result = await run();
        throw new Error(ROLLBACK);
      });
    } catch (error) {
      integration.prisma = client;
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
    }
    return result as T;
  }

  async function cleanup(fixture: Fixture) {
    if (fixture.settingKeys.length) await client.appSetting.deleteMany({ where: { key: { in: fixture.settingKeys } } });
    await client.membership.deleteMany({ where: { workspaceId: { in: fixture.workspaceIds } } });
    await client.workspace.deleteMany({ where: { id: { in: fixture.workspaceIds } } });
    await client.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    if (fixture.planIds.length) await client.$executeRaw`DELETE FROM plans WHERE id = ANY(${fixture.planIds}::text[])`;
    const [users, workspaces, plans, memberships, settings] = await Promise.all([
      client.user.count({ where: { id: { in: fixture.userIds } } }),
      client.workspace.count({ where: { id: { in: fixture.workspaceIds } } }),
      fixture.planIds.length ? client.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM plans WHERE id = ANY(${fixture.planIds}::text[])` : Promise.resolve([{ count: 0 }]),
      client.membership.count({ where: { workspaceId: { in: fixture.workspaceIds } } }),
      client.appSetting.count({ where: { key: { in: fixture.settingKeys } } }),
    ]);
    expect({ users, workspaces, plans: plans[0]?.count ?? 0, memberships, settings }).toEqual({ users: 0, workspaces: 0, plans: 0, memberships: 0, settings: 0 });
  }

  it('authorizes an active owner whose own plan grants both Facebook and a requested feature', async () => {
    const fixture = await createFixture();
    await addOwner(fixture, fixture.workspaceIds[0]!, 'qualified', QUALIFYING_FEATURES);
    await withRootPolicy(() => assertWorkspaceJobAccess(fixture.workspaceIds[0]!, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }));
  });

  it('does not combine a provider grant and feature grant from different owners', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    await addOwner(fixture, workspaceId, 'provider_only', ['product_v2', 'platform_facebook']);
    await addOwner(fixture, workspaceId, 'feature_only', ['product_v2', 'publishing/posts']);
    await withRootPolicy(async () => {
      await expect(assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }))
        .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    });
  });

  it('uses the selected any/all active-owner policy without authorizing a disabled owner', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    await addOwner(fixture, workspaceId, 'active_qualified', QUALIFYING_FEATURES);
    await addOwner(fixture, workspaceId, 'active_unqualified', ['product_v2', 'publishing/posts']);
    await addOwner(fixture, workspaceId, 'disabled_qualified', QUALIFYING_FEATURES, { disabled: true });

    policy.ownerPolicy = 'any_active_owner';
    await withRootPolicy(() => assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }));
    policy.ownerPolicy = 'all_active_owners';
    await withRootPolicy(async () => {
      await expect(assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }))
        .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    });
  });

  it('does not treat a disabled qualifying owner as the only qualifying active owner', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    await addOwner(fixture, workspaceId, 'active_unqualified_only', ['product_v2', 'publishing/posts']);
    await addOwner(fixture, workspaceId, 'disabled_qualified_only', QUALIFYING_FEATURES, { disabled: true });
    await withRootPolicy(async () => {
      await expect(assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }))
        .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    });
  });

  it('does not borrow a qualifying owner from another workspace', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    const otherWorkspaceId = await addWorkspace(fixture, 'other');
    await addOwner(fixture, workspaceId, 'local_unqualified', ['product_v2', 'publishing/posts']);
    await addOwner(fixture, otherWorkspaceId, 'foreign_qualified', QUALIFYING_FEATURES);
    await withRootPolicy(async () => {
      await expect(assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }))
        .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    });
  });

  it('keeps a suspended workspace denied even when its qualifying owner is the installation owner', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    await addOwner(fixture, workspaceId, 'root_qualified', QUALIFYING_FEATURES, { instanceOwner: true });
    await client.$executeRaw`UPDATE workspaces SET "suspendedAt" = NOW() WHERE id = ${workspaceId}`;
    await withRootPolicy(async () => {
      await expect(assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }))
        .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden' });
    });
  });

  it('refuses a workspace when the active-owner ceiling is exceeded instead of sampling owners', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    await addOwner(fixture, workspaceId, 'qualified_one', QUALIFYING_FEATURES);
    await addOwner(fixture, workspaceId, 'qualified_two', QUALIFYING_FEATURES);
    policy.ownerLimit = 1;
    await withRootPolicy(async () => {
      await expect(assertWorkspaceJobAccess(workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] }))
        .rejects.toMatchObject({ name: 'OperationError', code: 'unavailable' });
    });
  });

  it('serializes two clients on one selected resource and permits the next call after release', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    let entered!: () => void;
    let release!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const firstRun = vi.fn(async () => { entered(); await blocked; return 'first'; });
    integration.prisma = client;
    const first = withSelectedResourceOperation(workspaceId, { kind: 'target', id: `${fixture.prefix}_resource` }, firstRun);
    try {
      await held;
      integration.prisma = observer;
      const conflictingRun = vi.fn(async () => 'must not run');
      await expect(withSelectedResourceOperation(workspaceId, { kind: 'target', id: `${fixture.prefix}_resource` }, conflictingRun))
        .rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
      expect(conflictingRun).not.toHaveBeenCalled();
      expect(firstRun).toHaveBeenCalledTimes(1);
    } finally {
      release();
      integration.prisma = client;
    }
    await expect(first).resolves.toBe('first');
    const nextRun = vi.fn(async () => 'next');
    await expect(withSelectedResourceOperation(workspaceId, { kind: 'target', id: `${fixture.prefix}_resource` }, nextRun)).resolves.toBe('next');
    expect(nextRun).toHaveBeenCalledTimes(1);
  });

  it('rolls back a late transaction-client write after its bounded operation expires', async () => {
    const fixture = await createFixture();
    const workspaceId = fixture.workspaceIds[0]!;
    const settingKey = `${fixture.prefix}_late_sync_write`;
    fixture.settingKeys.push(settingKey);
    const lateWriteClient = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    policy.resourceTimeout = 1_000;
    policy.resourceMaxWait = 1_000;
    policy.resourceGrace = 1_000;
    policy.workspaceTimeout = 10_000;
    integration.prisma = lateWriteClient;
    let lateWriteError: unknown;
    const operation = withSelectedResourceOperation(workspaceId, { kind: 'target', id: `${fixture.prefix}_late_resource` }, async tx => {
      await new Promise(resolve => setTimeout(resolve, 2_200));
      try {
        await tx.appSetting.create({ data: { key: settingKey, value: true, encrypted: false, updatedAt: new Date() } });
      } catch (error) { lateWriteError = error; }
    });
    await expect(operation).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 400));
    integration.prisma = client;
    expect(lateWriteError).toBeDefined();
    expect(await observer.appSetting.findUnique({ where: { key: settingKey } })).toBeNull();
    await lateWriteClient.$disconnect();
  });
});
