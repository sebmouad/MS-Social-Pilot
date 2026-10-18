import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.operationTimeoutMs': 60000,
    'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000,
    'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerPost': 100,
    'publishing.maxTargetsPerOperation': 5000,
    'publishing.identifierMaxCharacters': 200,
    'publishing.maxMessageCharacters': 10000,
    'publishing.maxRemoteMediaPerPost': 4,
    'publishing.maxImageAltCharacters': 500,
    'publishing.collab.versionRetention': 50,
    'data.workspaceOperationTimeoutMs': 300000,
    'data.workspaceOperationLockWaitMs': 30000,
  }[key]),
}));
// Outer authority is stubbed so the test isolates the local transaction; the
// transaction, post writes, participant writes and audit row are all real.
vi.mock('../src/modules/publishing/server/access', () => ({
  authorizePublishing: async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }) => ({
    actor, role: 'editor', permissions: {}, entitlements: {},
  }),
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({ supportsTargetKind: () => true }) }));

import { OperationError } from '../src/lib/operation-error';
import { reviewPost, type ReviewParticipant } from '../src/server/publishing/lifecycle';

type Fixture = {
  prefix: string;
  workspaceId: string;
  reviewerId: string;
  authorId: string;
  socialAccountId: string;
  targetId: string;
  postId: string;
  postTargetId: string;
  shareLinkId: string;
  expiredShareLinkId: string;
  actor: { userId: string; workspaceId: string; allowedTargetIds: string[] };
};

/** Real domain participant: locks a live review link, then records the client's decision, both on the review's `tx`. */
function reviewLinkParticipant(fixture: Fixture, hooks: { afterInsert?: () => Promise<void>; shareLinkId?: string } = {}): ReviewParticipant {
  const shareLinkId = hooks.shareLinkId ?? fixture.shareLinkId;
  return {
    async before(tx) {
      const live = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM share_links WHERE id = ${shareLinkId} AND "workspaceId" = ${fixture.workspaceId} AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > NOW()) FOR UPDATE`;
      if (live.length !== 1) throw new OperationError('conflict', 'This review link is no longer active.');
    },
    async after(tx, context) {
      await tx.$executeRaw`INSERT INTO review_decisions (id, "shareLinkId", "postId", decision, comment, "authorName") VALUES (${randomUUID()}, ${shareLinkId}, ${context.postId}, ${context.decision === 'approve' ? 'approved' : 'rejected'}, ${context.note ?? null}, ${'Synthetic participant'})`;
      await hooks.afterInsert?.();
    },
  };
}

describe.skipIf(!databaseUrl)('publishing review participant on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Review participant integration writes require an isolated loopback _preview database.');
    }
    if (process.env.DATABASE_URL !== databaseUrl) throw new Error('DATABASE_URL must match REBUILD_PREVIEW_DATABASE_URL for review participant integration.');
    if (process.env.NODE_ENV === 'production') throw new Error('Review participant integration must not run against production.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
  });

  afterAll(async () => {
    await observer?.$disconnect();
    await client?.$disconnect();
  });

  async function createFixture(): Promise<Fixture> {
    const prefix = `preview_review_participant_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const fixture: Fixture = {
      prefix,
      workspaceId: `${prefix}_workspace`,
      reviewerId: `${prefix}_reviewer`,
      authorId: `${prefix}_author`,
      socialAccountId: `${prefix}_social`,
      targetId: `${prefix}_target`,
      postId: `${prefix}_post`,
      postTargetId: `${prefix}_post_target`,
      shareLinkId: `${prefix}_link`,
      expiredShareLinkId: `${prefix}_expired_link`,
      actor: { userId: `${prefix}_reviewer`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [`${prefix}_target`] },
    };
    try {
      await client.user.create({ data: { id: fixture.reviewerId, email: `${prefix}_reviewer@example.test`, name: 'Synthetic reviewer', passwordHash: 'unusable' } });
      await client.user.create({ data: { id: fixture.authorId, email: `${prefix}_author@example.test`, name: 'Synthetic author', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'Review participant fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_reviewer_membership`, userId: fixture.reviewerId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.membership.create({ data: { id: `${prefix}_author_membership`, userId: fixture.authorId, workspaceId: fixture.workspaceId, role: 'contributor' } });
      await client.socialAccount.create({ data: {
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`,
        name: 'Synthetic review source', accessToken: 'synthetic-token', scopes: '',
      } });
      await client.target.create({ data: {
        id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page',
        providerId: `${prefix}_provider_page`, name: 'Synthetic review destination', accessToken: 'synthetic-token',
        enabled: true, canPublish: true, createdAt: now,
      } });
      await client.post.create({ data: {
        id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.authorId, message: 'Synthetic review participant post',
        firstComment: null, media: [], status: 'pending_approval', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
      } });
      await client.$executeRaw`UPDATE posts SET "approvalStatus" = 'pending', "submittedById" = ${fixture.authorId}, "submittedAt" = NOW() WHERE id = ${fixture.postId}`;
      await client.postTarget.create({ data: { id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId, status: 'pending' } });
      const insertLink = (id: string, tokenHash: string, expiresAt: Date) => client.$executeRaw`INSERT INTO share_links (id, "workspaceId", kind, "tokenHash", title, decides, "expiresAt", "createdById") VALUES (${id}, ${fixture.workspaceId}, 'review', ${tokenHash}, 'Synthetic review link', true, ${expiresAt}, ${fixture.authorId})`;
      await insertLink(fixture.shareLinkId, `${prefix}_hash`, new Date(now.getTime() + 3_600_000));
      await insertLink(fixture.expiredShareLinkId, `${prefix}_expired_hash`, new Date(now.getTime() - 3_600_000));
      return fixture;
    } catch (error) {
      await cleanup(fixture).catch(() => undefined);
      throw error;
    }
  }

  /** Every step is idempotent, so partial setup is safe; a failing step does not skip later ones. */
  async function cleanup(fixture: Fixture) {
    const steps: Array<() => Promise<unknown>> = [
      () => client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`,
      () => client.$executeRaw`DELETE FROM review_decisions WHERE "postId" = ${fixture.postId} OR "shareLinkId" IN (${fixture.shareLinkId}, ${fixture.expiredShareLinkId})`,
      () => client.$executeRaw`DELETE FROM share_links WHERE "workspaceId" = ${fixture.workspaceId}`,
      () => client.postTarget.deleteMany({ where: { id: fixture.postTargetId } }),
      () => client.post.deleteMany({ where: { id: fixture.postId } }),
      () => client.target.deleteMany({ where: { id: fixture.targetId } }),
      () => client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } }),
      () => client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } }),
      () => client.workspace.deleteMany({ where: { id: fixture.workspaceId } }),
      () => client.user.deleteMany({ where: { id: { in: [fixture.reviewerId, fixture.authorId] } } }),
    ];
    const failures: unknown[] = [];
    for (const step of steps) await step().catch(error => { failures.push(error); });
    if (failures.length) throw failures[0];
  }

  async function postState(fixture: Fixture) {
    const rows = await observer.$queryRaw<Array<{ status: string; approval: string; reviewedById: string | null; reviewNote: string | null }>>`SELECT status::text AS status, "approvalStatus"::text AS approval, "reviewedById", "reviewNote" FROM posts WHERE id = ${fixture.postId}`;
    return rows[0];
  }
  const decisions = (fixture: Fixture) => observer.$queryRaw<Array<{ shareLinkId: string; decision: string; comment: string | null }>>`SELECT "shareLinkId", decision, comment FROM review_decisions WHERE "postId" = ${fixture.postId} ORDER BY "createdAt"`;
  const audits = (fixture: Fixture) => observer.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId} ORDER BY "createdAt"`;
  const pendingState = { status: 'pending_approval', approval: 'pending', reviewedById: null, reviewNote: null };

  async function expectUntouched(fixture: Fixture) {
    expect(await postState(fixture)).toEqual(pendingState);
    expect(await decisions(fixture)).toEqual([]);
    expect(await audits(fixture)).toEqual([]);
  }

  it('persists the participant decision, approval and audit together on success', async () => {
    const fixture = await createFixture();
    try {
      await expect(reviewPost(fixture.actor, fixture.postId, 'approve', ' Looks good ', reviewLinkParticipant(fixture))).resolves.toBeUndefined();
      expect(await postState(fixture)).toEqual({ status: 'draft', approval: 'approved', reviewedById: fixture.reviewerId, reviewNote: 'Looks good' });
      expect(await decisions(fixture)).toEqual([{ shareLinkId: fixture.shareLinkId, decision: 'approved', comment: 'Looks good' }]);
      expect(await audits(fixture)).toEqual([{ action: 'publishing.post_approved' }]);
    } finally {
      await cleanup(fixture);
    }
  });

  it('changes nothing when the before callback refuses against the database state', async () => {
    const fixture = await createFixture();
    try {
      await expect(reviewPost(fixture.actor, fixture.postId, 'approve', undefined, reviewLinkParticipant(fixture, { shareLinkId: fixture.expiredShareLinkId })))
        .rejects.toMatchObject({ code: 'conflict' });
      await expectUntouched(fixture);
    } finally {
      await cleanup(fixture);
    }
  });

  it('rolls back post status, approval, participant row and audit when the after callback fails', async () => {
    const fixture = await createFixture();
    const inserted = { count: 0 };
    try {
      const participant = reviewLinkParticipant(fixture, { afterInsert: async () => {
        // The domain row exists inside the transaction before the failure.
        const [row] = await client.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM review_decisions WHERE "postId" = ${fixture.postId}`;
        inserted.count = row.count;
        throw new Error('Synthetic participant failure after domain write');
      } });
      await expect(reviewPost(fixture.actor, fixture.postId, 'reject', 'Needs work', participant)).rejects.toThrow('Synthetic participant failure');
      // `client` is a different connection than the open transaction, so it must not see the uncommitted row.
      expect(inserted.count).toBe(0);
      await expectUntouched(fixture);
    } finally {
      await cleanup(fixture);
    }
  });

  it('serializes simultaneous reviews: a concurrent attempt cannot apply while the first holds the post', async () => {
    const fixture = await createFixture();
    let entered!: () => void;
    let release!: () => void;
    const hasEntered = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first: Promise<void> | undefined;
    try {
      first = reviewPost(fixture.actor, fixture.postId, 'approve', undefined, reviewLinkParticipant(fixture, { afterInsert: async () => { entered(); await gate; } }));
      await hasEntered;
      // Uncommitted work is invisible while the first review is open.
      await expectUntouched(fixture);
      await expect(reviewPost(fixture.actor, fixture.postId, 'reject', undefined, reviewLinkParticipant(fixture))).rejects.toMatchObject({ code: 'conflict' });
      await expectUntouched(fixture);
      release();
      await expect(first).resolves.toBeUndefined();
      expect(await postState(fixture)).toMatchObject({ status: 'draft', approval: 'approved' });
      expect(await decisions(fixture)).toEqual([{ shareLinkId: fixture.shareLinkId, decision: 'approved', comment: null }]);
      expect(await audits(fixture)).toEqual([{ action: 'publishing.post_approved' }]);
      // A later review sees the settled state and is refused without a second decision.
      await expect(reviewPost(fixture.actor, fixture.postId, 'reject', undefined, reviewLinkParticipant(fixture))).rejects.toMatchObject({ code: 'conflict' });
      expect(await decisions(fixture)).toHaveLength(1);
    } finally {
      release();
      await first?.catch(() => undefined);
      await cleanup(fixture);
    }
  });

  it('applies exactly one of two unsynchronized approve and reject reviews', async () => {
    const fixture = await createFixture();
    try {
      const results = await Promise.allSettled([
        reviewPost(fixture.actor, fixture.postId, 'approve', undefined, reviewLinkParticipant(fixture)),
        reviewPost(fixture.actor, fixture.postId, 'reject', undefined, reviewLinkParticipant(fixture)),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ code: 'conflict' });
      const rows = await decisions(fixture);
      expect(rows).toHaveLength(1);
      const state = await postState(fixture);
      expect(state).toMatchObject(rows[0].decision === 'approved' ? { status: 'draft', approval: 'approved' } : { status: 'rejected', approval: 'rejected' });
      expect(await audits(fixture)).toHaveLength(1);
    } finally {
      await cleanup(fixture);
    }
  });
});
