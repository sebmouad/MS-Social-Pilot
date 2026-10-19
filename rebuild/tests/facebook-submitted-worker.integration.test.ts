import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '../generated/client';
import type { RemoteStatus } from '../src/platforms/types';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const workerMocks = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  adapter: null as unknown as {
    id: string; statusPolicyFingerprint: string; canUseCredential: ReturnType<typeof vi.fn>;
    getRemoteStatus: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn>;
    publishFirstComment: ReturnType<typeof vi.fn>; deleteRemote: ReturnType<typeof vi.fn>;
  },
  status: null as unknown as RemoteStatus,
  access: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ get prisma() { return workerMocks.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'platforms.facebook.enabled': true,
    'sync.maxItemsPerJob': 1,
    'sync.resourceOperationTimeoutMs': 60000,
    'sync.resourceOperationMaxWaitMs': 5000,
    'sync.resourceFinalizationGraceMs': 5000,
    'data.workspaceOperationTimeoutMs': 300000,
    'data.workspaceOperationLockWaitMs': 30000,
    'publishing.transactionTimeoutMs': 15000,
    'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerOperation': 100,
    'publishing.identifierMaxCharacters': 2048,
    'publishing.publicationUrlMaxCharacters': 2048,
    'meta.postReadScopes': ['pages_read_engagement'],
  }[key]),
}));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookAdapter: async () => workerMocks.adapter }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: workerMocks.access }));

import { syncFacebookSubmittedPosts } from '../src/platforms/facebook/submitted-jobs';

type Fixture = { prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetId: string; postId: string; postTargetId: string; operationId: string; remoteId: string; remoteTargetId: string };

describe.skipIf(!databaseUrl)('Facebook submitted worker on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let originalCursor: { value: unknown; encrypted: boolean; updatedAt: Date } | null = null;
  const fixtures: Fixture[] = [];
  const cursorKey = 'meta.submittedStatusCursor';

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== databaseUrl) throw new Error('Facebook submitted-worker integration requires DATABASE_URL to exactly match the guarded preview URL.');
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Facebook submitted-worker integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    workerMocks.prisma = client;
    originalCursor = await client.appSetting.findUnique({ where: { key: cursorKey }, select: { value: true, encrypted: true, updatedAt: true } });
    resetAdapter();
  });

  beforeEach(async () => {
    workerMocks.prisma = client;
    workerMocks.access.mockReset().mockResolvedValue(undefined);
    await setCursor('');
    resetAdapter();
  });

  afterEach(async () => {
    workerMocks.prisma = client;
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
    await setCursor('');
  });

  afterAll(async () => {
    if (client) {
      if (originalCursor) await client.appSetting.upsert({ where: { key: cursorKey }, create: { key: cursorKey, ...originalCursor, value: originalCursor.value as Prisma.InputJsonValue }, update: { ...originalCursor, value: originalCursor.value as Prisma.InputJsonValue } });
      else await client.appSetting.deleteMany({ where: { key: cursorKey } });
      await client.$disconnect();
    }
  });

  function resetAdapter() {
    workerMocks.status = { state: 'published', remoteId: 'unset', targetId: 'unset', publishedAt: new Date('2026-10-19T12:00:00.000Z') };
    workerMocks.adapter = {
      id: 'facebook', statusPolicyFingerprint: 'synthetic-status-policy-v1',
      canUseCredential: vi.fn(() => true),
      getRemoteStatus: vi.fn(async () => workerMocks.status),
      publish: vi.fn(), publishFirstComment: vi.fn(), deleteRemote: vi.fn(),
    };
  }

  async function setCursor(value: string) {
    await client.appSetting.upsert({ where: { key: cursorKey }, create: { key: cursorKey, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
  }

  async function positionCursorBefore(f: Fixture) {
    const [row] = await client.$queryRaw<Array<{ updatedAt: Date }>>`SELECT "updatedAt" FROM rebuild_publication_attempts WHERE id=${f.operationId}`;
    if (!row) throw new Error('Submitted fixture was not inserted.');
    await setCursor(JSON.stringify([new Date(row.updatedAt.getTime() - 1).toISOString(), 'before-fixture']));
  }

  async function createSubmittedFixture(remoteId = `remote-${randomUUID()}`): Promise<Fixture> {
    const prefix = `preview_fb_submitted_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const fixture: Fixture = {
      prefix, workspaceId: `${prefix}_workspace`, userId: `${prefix}_user`, socialAccountId: `${prefix}_social`,
      targetId: `${prefix}_target`, postId: `${prefix}_post`, postTargetId: `${prefix}_post_target`,
      operationId: randomUUID(), remoteId, remoteTargetId: `${prefix}_provider_page`,
    };
    fixtures.push(fixture);
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Synthetic worker owner', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'Submitted worker fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: { id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Synthetic Facebook connection', accessToken: 'synthetic-account-token', scopes: 'pages_read_engagement' } });
      await client.target.create({ data: { id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page', providerId: fixture.remoteTargetId, name: 'Synthetic Page', accessToken: 'synthetic-page-token', enabled: true, canPublish: true, createdAt: now } });
      await client.post.create({ data: { id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic held publication', firstComment: 'Never send this comment', format: 'post', media: [], status: 'publishing', createdAt: now, updatedAt: now } });
      await client.postTarget.create({ data: { id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId, status: 'processing' } });
      await client.$executeRaw`INSERT INTO rebuild_publication_attempts
        (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason,"remotePostId","remoteUrl","receiptAt","projectedAt","attestedAt","attestedBy","createdAt","updatedAt")
        VALUES (${fixture.operationId},${fixture.workspaceId},${fixture.postId},${fixture.postTargetId},${fixture.targetId},'facebook',${fixture.userId},'submitted','provider_submission',${fixture.remoteId},${`https://example.test/${encodeURIComponent(fixture.remoteId)}`},${now},NULL,NULL,NULL,${now},${now})`;
      return fixture;
    } catch (error) {
      await cleanup(fixture);
      fixtures.splice(fixtures.indexOf(fixture), 1);
      throw error;
    }
  }

  async function cleanup(f: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${f.workspaceId}`;
    await client.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${f.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: f.postTargetId } });
    await client.post.deleteMany({ where: { id: f.postId } });
    await client.target.deleteMany({ where: { id: f.targetId } });
    await client.socialAccount.deleteMany({ where: { id: f.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: f.workspaceId } });
    await client.workspace.deleteMany({ where: { id: f.workspaceId } });
    await client.user.deleteMany({ where: { id: f.userId } });
  }

  it('projects only an exact published identity and records a system audit without create/comment/delete calls', async () => {
    const f = await createSubmittedFixture();
    await positionCursorBefore(f);
    workerMocks.status = { state: 'published', remoteId: f.remoteId, targetId: f.remoteTargetId, publishedAt: new Date('2026-10-19T12:34:00.000Z') };
    await expect(syncFacebookSubmittedPosts(new Date('2026-10-19T12:35:00.000Z'))).resolves.toMatchObject({ examined: 1, updated: 1, skipped: 0, failed: 0 });
    expect(workerMocks.adapter.getRemoteStatus).toHaveBeenCalledTimes(1);
    expect(workerMocks.adapter.getRemoteStatus).toHaveBeenCalledWith(expect.objectContaining({ remoteId: f.remoteId, target: { id: f.remoteTargetId, name: '', kind: 'page' }, formatId: 'post' }));
    expect(workerMocks.adapter.publish).not.toHaveBeenCalled();
    expect(workerMocks.adapter.publishFirstComment).not.toHaveBeenCalled();
    expect(workerMocks.adapter.deleteRemote).not.toHaveBeenCalled();
    expect(await client.postTarget.findUnique({ where: { id: f.postTargetId }, select: { status: true, remotePostId: true, remoteUrl: true, publishedAt: true } }))
      .toEqual({ status: 'published', remotePostId: f.remoteId, remoteUrl: `https://example.test/${encodeURIComponent(f.remoteId)}`, publishedAt: new Date('2026-10-19T12:34:00.000Z') });
    expect(await client.$queryRaw<Array<{ state: string; reason: string; remotePostId: string; projectedBy: string | null }>>`
      SELECT a.state,a.reason,a."remotePostId",r."actorId" AS "projectedBy" FROM rebuild_publication_attempts a
      JOIN root_activities r ON r.detail->>'operationId'=a.id WHERE a.id=${f.operationId} AND r.action='publishing.publication_verified'`)
      .toEqual([{ state: 'projected', reason: 'provider_receipt', remotePostId: f.remoteId, projectedBy: null }]);
  });

  it.each(['unknown status', 'mismatched remote identity', 'mismatched Page identity'] as const)('keeps the submitted record held for %s', async kind => {
    const f = await createSubmittedFixture();
    await positionCursorBefore(f);
    workerMocks.status = kind === 'unknown status' ? { state: 'unknown' }
      : kind === 'mismatched remote identity' ? { state: 'published', remoteId: 'different-remote', targetId: f.remoteTargetId }
        : { state: 'published', remoteId: f.remoteId, targetId: 'different-page' };
    await expect(syncFacebookSubmittedPosts()).resolves.toMatchObject({ examined: 1, updated: 0, skipped: 1, failed: 0 });
    expect(workerMocks.adapter.getRemoteStatus).toHaveBeenCalledTimes(1);
    expect(workerMocks.adapter.publish).not.toHaveBeenCalled();
    expect(workerMocks.adapter.publishFirstComment).not.toHaveBeenCalled();
    expect(workerMocks.adapter.deleteRemote).not.toHaveBeenCalled();
    expect(await client.$queryRaw<Array<{ state: string; reason: string; remotePostId: string }>>`
      SELECT state,reason,"remotePostId" FROM rebuild_publication_attempts WHERE id=${f.operationId}`)
      .toEqual([{ state: 'submitted', reason: 'provider_submission', remotePostId: f.remoteId }]);
    expect(await client.postTarget.findUnique({ where: { id: f.postTargetId }, select: { status: true, remotePostId: true } }))
      .toEqual({ status: 'processing', remotePostId: null });
  });

  it.each(['format', 'media'] as const)('keeps the receipt held if post %s changes during the status GET', async field => {
    const f = await createSubmittedFixture();
    await positionCursorBefore(f);
    workerMocks.status = { state: 'published', remoteId: f.remoteId, targetId: f.remoteTargetId, publishedAt: new Date() };
    workerMocks.adapter.getRemoteStatus.mockImplementationOnce(async () => {
      await client.post.update({ where: { id: f.postId }, data: field === 'format' ? { format: 'changed-private-format' } : { media: [{ kind: 'video', url: 'https://example.test/video' }] } });
      return workerMocks.status;
    });
    await expect(syncFacebookSubmittedPosts()).resolves.toMatchObject({ examined: 1, updated: 0, skipped: 1, failed: 0 });
    expect(await client.$queryRaw<Array<{ state: string; remotePostId: string }>>`
      SELECT state,"remotePostId" FROM rebuild_publication_attempts WHERE id=${f.operationId}`)
      .toEqual([{ state: 'submitted', remotePostId: f.remoteId }]);
    expect(await client.postTarget.findUnique({ where: { id: f.postTargetId }, select: { status: true, remotePostId: true } }))
      .toEqual({ status: 'processing', remotePostId: null });
    expect(workerMocks.adapter.publish).not.toHaveBeenCalled();
    expect(workerMocks.adapter.publishFirstComment).not.toHaveBeenCalled();
    expect(workerMocks.adapter.deleteRemote).not.toHaveBeenCalled();
  });
});
