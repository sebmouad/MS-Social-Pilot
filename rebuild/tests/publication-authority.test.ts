import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  role: 'editor',
  featureDenied: false,
  grants: null as string[] | null,
  grantCall: 0,
  revokeOnSecondCheck: false,
  targetId: '',
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerOperation': 5000, 'publishing.identifierMaxCharacters': 200,
    'publishing.publicationHistoryLimit': 100, 'publishing.publicationUrlMaxCharacters': 2048,
    'data.workspaceOperationTimeoutMs': 300000, 'data.workspaceOperationLockWaitMs': 30000,
  }[key]),
}));
vi.mock('../src/modules/publishing/server/access', () => ({
  authorizePublishing: async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }, feature = 'publishing/posts') => {
    integration.grantCall += 1;
    if (integration.featureDenied) throw Object.assign(new Error('Feature unavailable'), { code: 'forbidden' });
    const allowedTargetIds = integration.revokeOnSecondCheck && integration.grantCall > 1
      ? []
      : integration.grants === null ? actor.allowedTargetIds : integration.grants;
    return { actor: { ...actor, ...(allowedTargetIds === undefined ? {} : { allowedTargetIds }) }, role: integration.role, permissions: {}, entitlements: { feature } };
  },
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async (_workspaceId: string, _entitlements: unknown, allowed?: readonly string[]) =>
    integration.grants ?? (allowed === undefined ? [integration.targetId] : [...allowed]),
  publishingPostVisibilityWhere: (_workspaceId: string, ids: readonly string[]) => ids.length
    ? { targets: { some: { targetId: { in: [...ids] } } } }
    : { id: '__no_currently_selected_publication__' },
}));

import { recordPublicationOutcome } from '../src/modules/publishing/server/publication';

type Fixture = {
  prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetId: string;
  postId: string; postTargetId: string; operationId: string;
  actor: { userId: string; workspaceId: string; allowedTargetIds: string[] };
};

describe.skipIf(!databaseUrl)('publication outcome authority on isolated PostgreSQL', () => {
  let client: PrismaClient;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Publication authority integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
  });

  afterEach(async () => {
    integration.prisma = client;
    integration.role = 'editor';
    integration.featureDenied = false;
    integration.grants = null;
    integration.grantCall = 0;
    integration.revokeOnSecondCheck = false;
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
  });

  afterAll(async () => { await client?.$disconnect(); });

  async function createFixture(): Promise<Fixture> {
    const prefix = `preview_publication_authority_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const fixture: Fixture = {
      prefix, workspaceId: `${prefix}_workspace`, userId: `${prefix}_user`, socialAccountId: `${prefix}_social`,
      targetId: `${prefix}_target`, postId: `${prefix}_post`, postTargetId: `${prefix}_post_target`, operationId: randomUUID(),
      actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [`${prefix}_target`] },
    };
    fixtures.push(fixture);
    integration.targetId = fixture.targetId;
    integration.grants = [fixture.targetId];
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Synthetic authority actor', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'Publication authority fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: {
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`,
        name: 'Synthetic authority source', accessToken: 'synthetic-token', scopes: '',
      } });
      await client.target.create({ data: {
        id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page',
        providerId: `${prefix}_provider_page`, name: 'Synthetic authority destination', accessToken: 'synthetic-token',
        enabled: true, canPublish: true, createdAt: now,
      } });
      await client.post.create({ data: {
        id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic authority post',
        firstComment: null, media: [], status: 'publishing', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
      } });
      await client.postTarget.create({ data: { id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId, status: 'processing' } });
      await client.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason)
        VALUES (${fixture.operationId},${fixture.workspaceId},${fixture.postId},${fixture.postTargetId},${fixture.targetId},'facebook',${fixture.userId},'uncertain','outcome_unknown')`;
      return fixture;
    } catch (error) {
      await cleanup(fixture);
      throw error;
    }
  }

  async function cleanup(fixture: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`;
    await client.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId" = ${fixture.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: fixture.postTargetId } });
    await client.post.deleteMany({ where: { id: fixture.postId } });
    await client.target.deleteMany({ where: { id: fixture.targetId } });
    await client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  const request = (fixture: Fixture, confirmation = `RECORD PUBLICATION ${fixture.operationId} ABSENT`) => ({
    postId: fixture.postId, operationId: fixture.operationId, outcome: 'ABSENT' as const,
    confirmation, verifiedExternally: true as const,
  });

  it('requires the exact operation and outcome confirmation before any write', async () => {
    const fixture = await createFixture();
    await expect(recordPublicationOutcome(fixture.actor, request(fixture, `RECORD PUBLICATION ${fixture.operationId} PUBLISHED`)))
      .rejects.toMatchObject({ code: 'invalid_request' });
    expect(await client.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE id=${fixture.operationId}`)
      .toEqual([{ state: 'uncertain' }]);
  });

  it.each(['contributor', 'root'])('does not grant external outcome authority to %s through the workspace operation', async role => {
    const fixture = await createFixture();
    integration.role = role;
    await expect(recordPublicationOutcome(fixture.actor, request(fixture))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await client.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE id=${fixture.operationId}`)
      .toEqual([{ state: 'uncertain' }]);
  });

  it('rechecks current destination grants after the operation begins', async () => {
    const fixture = await createFixture();
    integration.revokeOnSecondCheck = true;
    await expect(recordPublicationOutcome(fixture.actor, request(fixture))).rejects.toMatchObject({ code: 'forbidden' });
    expect(integration.grantCall).toBeGreaterThanOrEqual(2);
    expect(await client.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE id=${fixture.operationId}`)
      .toEqual([{ state: 'uncertain' }]);
  });

  it('honors current Publishing feature entitlement before recording an outcome', async () => {
    const fixture = await createFixture();
    integration.featureDenied = true;
    await expect(recordPublicationOutcome(fixture.actor, request(fixture))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await client.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE id=${fixture.operationId}`)
      .toEqual([{ state: 'uncertain' }]);
  });
});
