import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Negative-comment alert: new comments' mood is read in one
 * AI batch, the Page's own replies and hidden comments are skipped, and the
 * team hears once when a Page's negative comments spike.
 */

const sent: string[][] = [];
const alerts: Array<{ page: string; count: number }> = [];

vi.mock('../src/lib/ai', async (original) => ({
  ...(await original<typeof import('../src/lib/ai')>()),
  aiAvailable: () => true,
  readCommentSentiments: async (options: { comments: string[] }) => {
    sent.push(options.comments);
    return options.comments.map((text) => (text.includes('awful') ? 'negative' : 'positive'));
  },
}));

vi.mock('../src/lib/email/notify', async (original) => ({
  ...(await original<typeof import('../src/lib/email/notify')>()),
  notifyNegativeSpike: async (options: { page: string; count: number }) => {
    alerts.push({ page: options.page, count: options.count });
  },
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let watch: typeof import('../src/lib/negative-comments');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('negative_comments');
  ({ prisma } = await import('../src/lib/prisma'));
  watch = await import('../src/lib/negative-comments');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('spike rule', () => {
  it('needs a few negative comments and twice the usual', async () => {
    const { isNegativeSpike } = await import('../src/lib/negative-comments');
    expect(isNegativeSpike(2, 0)).toBe(false);
    expect(isNegativeSpike(3, 0)).toBe(true);
    expect(isNegativeSpike(5, 3)).toBe(false);
    expect(isNegativeSpike(6, 3)).toBe(true);
  });
});

describe('reading the model', () => {
  it('keeps only known words, one per comment', async () => {
    const { parseSentiments } = await import('../src/lib/ai');
    expect(parseSentiments('Here: ["negative","happy","positive"]', 3)).toEqual(['negative', null, 'positive']);
    expect(parseSentiments('["negative"]', 2)).toEqual([null, null]);
    expect(parseSentiments('not json', 1)).toEqual([null]);
  });
});

describe('negative-comment alert', () => {
  it('reads new comments once, skips the Page and hidden ones, and alerts once a day', async () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', watchNegativeComments: true } });
    const quiet = await prisma.workspace.create({ data: { name: 'Client B', slug: 'client-b' } });
    const user = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner', passwordHash: 'x' } });
    await prisma.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.owner } });
    await prisma.membership.create({ data: { workspaceId: quiet.id, userId: user.id, role: WorkspaceRole.owner } });

    const seed = async (workspaceId: string, providerId: string) => {
      const target = await prisma.target.create({ data: { workspaceId, type: 'page', providerId, name: `Page ${providerId}`, accessToken: 'x' } });
      const post = await prisma.post.create({ data: { workspaceId, authorId: user.id, message: 'Product launch', status: 'published' } });
      const postTarget = await prisma.postTarget.create({ data: { postId: post.id, targetId: target.id, status: 'published' } });
      return { target, postTarget };
    };
    const a = await seed(workspace.id, 'page-a');
    const b = await seed(quiet.id, 'page-b');
    const comment = (postTargetId: string, id: string, message: string, extra: object = {}) =>
      prisma.postComment.create({
        data: { postTargetId, remoteId: id, message, fromId: 'person', createdTime: new Date(now.getTime() - 60 * 60 * 1000), ...extra },
      });
    for (const index of [1, 2, 3, 4]) await comment(a.postTarget.id, `bad-${index}`, `This was awful ${index}`);
    await comment(a.postTarget.id, 'good', 'Lovely, thank you');
    await comment(a.postTarget.id, 'hidden', 'awful spam link', { isHidden: true });
    await comment(a.postTarget.id, 'own', 'Sorry to hear that, we will call you', { fromId: 'page-a' });
    await comment(b.postTarget.id, 'other', 'awful too');

    expect(await watch.watchNegativeComments(now)).toEqual({ read: 5, alerted: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('awful spam link');
    expect(sent[0]).not.toContain('awful too');
    expect(alerts).toEqual([{ page: 'Page page-a', count: 4 }]);
    expect(await prisma.postComment.findUnique({ where: { postTargetId_remoteId: { postTargetId: a.postTarget.id, remoteId: 'own' } } })).toMatchObject({ sentiment: 'neutral' });
    expect(await prisma.postComment.findUnique({ where: { postTargetId_remoteId: { postTargetId: a.postTarget.id, remoteId: 'hidden' } } })).toMatchObject({ sentiment: null });

    // An hour later: nothing new to read, and no second alert the same day.
    expect(await watch.watchNegativeComments(new Date(now.getTime() + 60 * 60 * 1000))).toEqual({ read: 0, alerted: 0 });
    expect(sent).toHaveLength(1);
  });
});
