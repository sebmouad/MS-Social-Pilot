import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole, type PostTargetStatus } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Caption A/B tests (NEXT_PHASES G9): one post per caption, read by the worker
 * from stored insights once every caption has had its time.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let captions: typeof import('../src/lib/caption-test');
let createPostSchema: typeof import('../src/lib/validation')['createPostSchema'];
let encryptSecret: typeof import('../src/lib/crypto')['encryptSecret'];

const now = new Date('2026-11-02T09:00:00Z');
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('caption_tests');
  ({ prisma } = await import('../src/lib/prisma'));
  captions = await import('../src/lib/caption-test');
  ({ createPostSchema } = await import('../src/lib/validation'));
  ({ encryptSecret } = await import('../src/lib/crypto'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.captionTest.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(pages: number) {
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
  const user = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', passwordHash: 'x' } });
  const targets = [];
  for (let index = 0; index < pages; index++) {
    targets.push(
      await prisma.target.create({
        data: { workspaceId: workspace.id, type: 'page', providerId: `page-${index}`, name: `Page ${index + 1}`, accessToken: encryptSecret('token') },
      }),
    );
  }
  const context = { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.owner, requiresApproval: false };
  return { workspace, user, targets, context };
}

/** A finished test: one published post per caption, with insights synced after it was due. */
async function finished(options: { views: [number, number]; engagements: [number, number]; synced?: Date; status?: PostTargetStatus }) {
  const { workspace, user, targets } = await seed(2);
  const test = await prisma.captionTest.create({ data: { workspaceId: workspace.id, name: 'Product launch', hours: 48, minViews: 100 } });
  const publishedAt = new Date(now.getTime() - 72 * HOUR);
  for (const [index, label] of ['A', 'B'].entries()) {
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: `Caption ${label}`,
        status: 'published',
        captionTestId: test.id,
        captionLabel: label,
        targets: {
          create: {
            targetId: targets[index]!.id,
            status: (index === 1 && options.status) || 'published',
            publishedAt,
            insights: { impressions: options.views[index], reactions: options.engagements[index], comments: 0, shares: 0 },
            insightsSyncedAt: options.synced ?? new Date(now.getTime() - HOUR),
          },
        },
      },
    });
  }
  return { workspace, targets, test };
}

describe('planCaptions', () => {
  it('shares the Pages out when there are enough, and spreads over days when not', () => {
    expect(captions.planCaptions(['p1', 'p2', 'p3'], 2)).toEqual([
      { targetIds: ['p1', 'p3'], dayOffset: 0 },
      { targetIds: ['p2'], dayOffset: 0 },
    ]);
    expect(captions.planCaptions(['p1'], 3)).toEqual([
      { targetIds: ['p1'], dayOffset: 0 },
      { targetIds: ['p1'], dayOffset: 1 },
      { targetIds: ['p1'], dayOffset: 2 },
    ]);
  });
});

describe('decide', () => {
  const result = (label: string, views: number, engagements: number) => ({ label, views, engagements, rate: views ? engagements / views : null });

  it('names a winner with its lift only when every caption had enough views', () => {
    expect(captions.decide([result('A', 1000, 50), result('B', 1000, 100)], 500)).toEqual({
      status: 'decided',
      reason: null,
      winnerLabel: 'B',
      lift: 100,
    });
    expect(captions.decide([result('A', 1000, 50), result('B', 200, 100)], 500)).toMatchObject({ status: 'inconclusive', reason: 'not_enough_views' });
    expect(captions.decide([result('A', 1000, 50), result('B', 1000, 50)], 500)).toMatchObject({ status: 'inconclusive', reason: 'tie' });
  });
});

describe('createCaptionTest', () => {
  it('posts each caption on its own day when there is one Page', async () => {
    const { targets, context } = await seed(1);
    const input = createPostSchema.parse({
      message: 'Caption A',
      captionVariants: ['Caption B'],
      testHours: 24,
      targetIds: [targets[0]!.id],
      publishMode: 'worker',
      scheduledAtLocal: '2026-11-05T10:00',
      timezone: 'UTC',
    });
    const result = await captions.createCaptionTest(context, input, now);
    expect(result.posts).toBe(2);

    const test = await prisma.captionTest.findUniqueOrThrow({ where: { id: result.captionTestId }, include: { posts: { orderBy: { captionLabel: 'asc' } } } });
    expect(test.hours).toBe(24);
    expect(test.posts.map((post) => [post.captionLabel, post.message, post.scheduledAt?.toISOString()])).toEqual([
      ['A', 'Caption A', '2026-11-05T10:00:00.000Z'],
      ['B', 'Caption B', '2026-11-06T10:00:00.000Z'],
    ]);
  });

  it('refuses a test saved as a draft', () => {
    expect(() =>
      createPostSchema.parse({ message: 'A', captionVariants: ['B'], targetIds: ['x'], publishMode: 'worker', saveAsDraft: true, timezone: 'UTC' }),
    ).toThrow();
  });
});

describe('evaluateCaptionTests', () => {
  it('waits for fresh insights, then records the winner once', async () => {
    const { test } = await finished({ views: [1000, 1000], engagements: [20, 60], synced: new Date(now.getTime() - 48 * HOUR) });
    expect(await captions.evaluateCaptionTests(now)).toBe(0);

    await prisma.postTarget.updateMany({ data: { insightsSyncedAt: new Date(now.getTime() - HOUR) } });
    expect(await captions.evaluateCaptionTests(now)).toBe(1);
    expect(await captions.evaluateCaptionTests(now)).toBe(0);

    const decided = await prisma.captionTest.findUniqueOrThrow({ where: { id: test.id } });
    expect(decided).toMatchObject({ status: 'decided', winnerLabel: 'B' });
    expect(decided.lift).toBeCloseTo(200);
  });

  it('gives no winner when a caption had too few views or did not go out', async () => {
    const few = await finished({ views: [1000, 50], engagements: [20, 10] });
    await captions.evaluateCaptionTests(now);
    expect(await prisma.captionTest.findUniqueOrThrow({ where: { id: few.test.id } })).toMatchObject({ status: 'inconclusive', reason: 'not_enough_views' });

    await prisma.postTarget.deleteMany();
    await prisma.post.deleteMany();
    await prisma.captionTest.deleteMany();
    const failed = await finished({ views: [1000, 1000], engagements: [20, 10], status: 'failed' });
    await captions.evaluateCaptionTests(now);
    expect(await prisma.captionTest.findUniqueOrThrow({ where: { id: failed.test.id } })).toMatchObject({ status: 'inconclusive', reason: 'not_published' });
  });
});

describe('saveLearning', () => {
  it('adds the winning caption to the Pages’ voice once', async () => {
    const { workspace, targets, test } = await finished({ views: [1000, 1000], engagements: [20, 60] });
    await prisma.target.update({ where: { id: targets[0]!.id }, data: { brandVoice: 'Friendly.' } });
    await captions.evaluateCaptionTests(now);

    expect(await captions.saveLearning({ id: test.id, workspaceId: workspace.id })).toBe('ok');
    expect(await captions.saveLearning({ id: test.id, workspaceId: workspace.id })).toBe('already');
    expect(await captions.saveLearning({ id: test.id, workspaceId: 'another' })).toBe('not_found');

    const voices = await prisma.target.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: 'asc' }, select: { brandVoice: true } });
    expect(voices[0]!.brandVoice).toMatch(/^Friendly\.\n.*Caption B.*Caption A/);
    expect(voices[1]!.brandVoice).toContain('Caption B');
  });
});
