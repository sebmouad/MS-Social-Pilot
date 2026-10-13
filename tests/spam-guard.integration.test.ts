import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Spam-risk guard: the same link or text on many Pages at
 * once is spotted before scheduling, and the offered fix — one Page at a time,
 * optionally reworded — creates one post per Page, the right distance apart.
 */

vi.mock('../src/lib/ai', async (original) => ({
  ...(await original<typeof import('../src/lib/ai')>()),
  aiAvailable: () => true,
  improveCaption: async (options: { draft: string; brandVoice?: string | null }) => ({
    text: `${options.draft} [${options.brandVoice ?? 'plain'}]`,
    model: 'test',
    inputTokens: 0,
    outputTokens: 0,
  }),
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let guard: typeof import('../src/lib/spam-guard');
let stagger: typeof import('../src/lib/stagger');

const at = new Date('2026-11-02T09:00:00Z');
const CAPTION = 'Our spring product launch is live today with free delivery for everyone';

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('spam_guard');
  ({ prisma } = await import('../src/lib/prisma'));
  guard = await import('../src/lib/spam-guard');
  stagger = await import('../src/lib/stagger');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(pages = 4) {
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
  const user = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', passwordHash: 'x' } });
  const targets = [];
  for (let index = 0; index < pages; index += 1) {
    targets.push(
      await prisma.target.create({
        data: {
          workspaceId: workspace.id,
          type: 'page',
          providerId: `${1000 + index}`,
          name: `Page ${index + 1}`,
          brandVoice: index === 0 ? null : `voice ${index + 1}`,
        },
      }),
    );
  }
  return { workspace, user, targets };
}

async function plan(workspaceId: string, authorId: string, targetIds: string[], message: string, scheduledAt: Date, link: string | null = null) {
  await prisma.post.create({
    data: {
      workspaceId,
      authorId,
      message,
      link,
      status: PostStatus.scheduled,
      scheduledAt,
      targets: { create: targetIds.map((targetId) => ({ targetId })) },
    },
  });
}

describe('comparing content', () => {
  it('treats a link with other tracking tags as the same link', () => {
    expect(guard.linkKey('https://www.example.com/launch/?utm_source=a')).toBe(guard.linkKey('https://example.com/launch'));
    expect([...guard.linksOf('Read https://example.com/launch?x=1 now', null)]).toEqual(['example.com/launch']);
  });

  it('finds near-identical text and ignores short or different text', () => {
    const a = guard.wordsOf(CAPTION);
    expect(guard.similarText(a, guard.wordsOf(`${CAPTION}!`))).toBe(true);
    expect(guard.similarText(a, guard.wordsOf('A completely different message about our opening hours this week'))).toBe(false);
    expect(guard.similarText(guard.wordsOf('Hello there'), guard.wordsOf('Hello there'))).toBe(false);
  });

  it('moves a typed time across midnight', () => {
    expect(guard.shiftLocalInput('2026-11-02T23:50', 20)).toBe('2026-11-03T00:10');
  });
});

describe('spamRisk', () => {
  it('warns for one post to three Pages of one network at once', async () => {
    const { workspace, targets } = await seed(3);
    const risk = await guard.spamRisk(workspace.id, { message: CAPTION, targetIds: targets.map((t) => t.id), at });
    expect(risk).toMatchObject({ pages: 3, ownPages: 3, otherPosts: 0, network: 'page', gapMinutes: 20 });
  });

  it('stays quiet for two Pages, or when the workspace turned it off', async () => {
    const { workspace, targets } = await seed(3);
    expect(await guard.spamRisk(workspace.id, { message: CAPTION, targetIds: [targets[0]!.id, targets[1]!.id], at })).toBeNull();

    await prisma.workspace.update({ where: { id: workspace.id }, data: { spamGapMinutes: 0 } });
    expect(await guard.spamRisk(workspace.id, { message: CAPTION, targetIds: targets.map((t) => t.id), at })).toBeNull();
  });

  it('counts planned posts with the same link within the gap, not outside it', async () => {
    const { workspace, user, targets } = await seed(4);
    const [a, b, c, d] = targets.map((t) => t.id) as [string, string, string, string];
    await plan(workspace.id, user.id, [c], 'Something else entirely', new Date(at.getTime() + 10 * 60_000), 'https://example.com/launch?utm_source=x');
    await plan(workspace.id, user.id, [d], 'Something else entirely', new Date(at.getTime() + 60 * 60_000), 'https://example.com/launch');

    const risk = await guard.spamRisk(workspace.id, { message: 'New today', link: 'https://example.com/launch', targetIds: [a, b], at });
    expect(risk).toMatchObject({ pages: 3, ownPages: 2, otherPosts: 1 });
  });
});

describe('createStaggered', () => {
  it('makes one post per Page, the gap apart, reworded after the first', async () => {
    const { workspace, user, targets } = await seed(3);
    const result = await stagger.createStaggered(
      { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.owner, requiresApproval: false, locale: 'en' },
      {
        message: CAPTION,
        targetIds: targets.map((t) => t.id),
        media: [],
        publishMode: 'worker',
        scheduledAtLocal: '2026-11-02T09:00',
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
        staggerMinutes: 20,
        aiVariants: true,
      },
      new Date('2026-11-01T09:00:00Z'),
    );
    expect(result.posts).toBe(3);

    const posts = await prisma.post.findMany({ include: { targets: true }, orderBy: { scheduledAt: 'asc' } });
    expect(posts.map((post) => post.scheduledAt!.toISOString())).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-02T09:20:00.000Z',
      '2026-11-02T09:40:00.000Z',
    ]);
    expect(posts.map((post) => post.targets.map((row) => row.targetId))).toEqual(targets.map((t) => [t.id]));
    expect(posts.map((post) => post.message)).toEqual([CAPTION, `${CAPTION} [voice 2]`, `${CAPTION} [voice 3]`]);
  });

  it('sends together when there is no stagger', async () => {
    const { workspace, user, targets } = await seed(3);
    const result = await stagger.createStaggered(
      { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.owner, requiresApproval: false, locale: 'en' },
      {
        message: CAPTION,
        targetIds: targets.map((t) => t.id),
        media: [],
        publishMode: 'worker',
        scheduledAtLocal: '2026-11-02T09:00',
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
      },
      new Date('2026-11-01T09:00:00Z'),
    );
    expect(result.posts).toBe(1);
    expect(await prisma.postTarget.count({ where: { postId: result.postId } })).toBe(3);
  });
});
