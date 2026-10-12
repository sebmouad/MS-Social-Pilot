import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Comment moderation rules (NEXT_PHASES G7): every new comment the sync reads
 * goes through the workspace's rules once; hides and replies can be undone.
 */

const graph = vi.hoisted(() => ({
  hidden: [] as Array<{ id: string; hide: boolean }>,
  replies: [] as Array<{ id: string; text: string }>,
  deleted: [] as string[],
  fail: null as Error | null,
}));
const alerts = vi.hoisted(() => [] as Array<{ rule: string; message: string }>);

vi.mock('../src/lib/facebook/edges', async (original) => ({
  ...(await original<typeof import('../src/lib/facebook/edges')>()),
  setCommentHidden: async (id: string, _token: string, hide: boolean) => {
    if (graph.fail) throw graph.fail;
    graph.hidden.push({ id, hide });
  },
  replyToComment: async (id: string, _token: string, text: string) => {
    if (graph.fail) throw graph.fail;
    graph.replies.push({ id, text });
    return `reply-${id}`;
  },
  deleteComment: async (id: string) => {
    graph.deleted.push(id);
  },
}));

vi.mock('../src/lib/email/notify', async (original) => ({
  ...(await original<typeof import('../src/lib/email/notify')>()),
  notifyModerationAlert: async (options: { rule: string; message: string }) => {
    alerts.push({ rule: options.rule, message: options.message });
  },
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let moderation: typeof import('../src/lib/moderation');
let encryptSecret: typeof import('../src/lib/crypto')['encryptSecret'];

const now = new Date('2026-11-02T09:00:00Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('moderation');
  ({ prisma } = await import('../src/lib/prisma'));
  moderation = await import('../src/lib/moderation');
  ({ encryptSecret } = await import('../src/lib/crypto'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  graph.hidden.length = 0;
  graph.replies.length = 0;
  graph.deleted.length = 0;
  graph.fail = null;
  alerts.length = 0;
  await prisma.moderationAction.deleteMany();
  await prisma.moderationRule.deleteMany();
  await prisma.postComment.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
  const user = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', passwordHash: 'x' } });
  const target = await prisma.target.create({
    data: { workspaceId: workspace.id, type: 'page', providerId: 'page-1', name: 'Client A Page', accessToken: encryptSecret('token') },
  });
  const post = await prisma.post.create({
    data: { workspaceId: workspace.id, authorId: user.id, message: 'Product launch', status: 'published' },
  });
  const postTarget = await prisma.postTarget.create({ data: { postId: post.id, targetId: target.id, status: 'published' } });
  return { workspace, user, target, postTarget };
}

function comment(remoteId: string, message: string, extra: Partial<import('../src/lib/moderation').IncomingComment> = {}) {
  return { remoteId, message, fromId: `user-${remoteId}`, fromName: 'Alex Martin', createdTime: new Date(now.getTime() - 60_000), ...extra };
}

async function store(postTargetId: string, comments: ReturnType<typeof comment>[]) {
  await prisma.postComment.createMany({
    data: comments.map((row) => ({ postTargetId, remoteId: row.remoteId, message: row.message, fromId: row.fromId, fromName: row.fromName, createdTime: row.createdTime })),
  });
}

describe('matchesRule', () => {
  it('finds links, phone numbers and keywords', () => {
    const { matchesRule } = moderation;
    expect(matchesRule({ match: 'links', keywords: [] }, 'see https://example.com/x')).toBe(true);
    expect(matchesRule({ match: 'links', keywords: [] }, 'visit www.example.org now')).toBe(true);
    expect(matchesRule({ match: 'links', keywords: [] }, 'great post, thanks!')).toBe(false);
    expect(matchesRule({ match: 'phones', keywords: [] }, 'call +1 (555) 123-4567')).toBe(true);
    expect(matchesRule({ match: 'phones', keywords: [] }, 'we were 12 people')).toBe(false);
    expect(matchesRule({ match: 'keywords', keywords: ['Giveaway'] }, 'Free GÍVEAWAY here')).toBe(true);
    expect(matchesRule({ match: 'keywords', keywords: ['giveaway'] }, 'nothing to see')).toBe(false);
  });

  it('fills the reply placeholders', () => {
    expect(moderation.fillReply('Hi {first_name}, thanks from {page}!', { name: 'Alex Martin', page: 'Client A' })).toBe(
      'Hi Alex, thanks from Client A!',
    );
    expect(moderation.fillReply('Hi {first_name}, welcome', { name: null, page: 'Client A' })).toBe('Hi, welcome');
  });
});

describe('applyModerationRules', () => {
  it('hides a matching comment once, logs it, and leaves the Page’s own comments alone', async () => {
    const { workspace, postTarget } = await seed();
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Links', match: 'links', action: 'hide' } });
    const comments = [
      comment('c1', 'buy at https://spam.example'),
      comment('c2', 'lovely'),
      comment('c3', 'our site https://example.com', { fromId: 'page-1' }),
    ];
    await store(postTarget.id, comments);

    expect(await moderation.applyModerationRules(postTarget.id, comments, now)).toBe(1);
    expect(graph.hidden).toEqual([{ id: 'c1', hide: true }]);
    expect((await prisma.postComment.findFirst({ where: { remoteId: 'c1' } }))?.isHidden).toBe(true);

    // The next sync sees the same comment again: nothing more happens.
    expect(await moderation.applyModerationRules(postTarget.id, comments, now)).toBe(0);
    expect(graph.hidden).toHaveLength(1);
    expect(await prisma.moderationAction.count()).toBe(1);
  });

  it('ignores old comments, paused rules and rules for other Pages', async () => {
    const { workspace, postTarget } = await seed();
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Paused', match: 'links', action: 'hide', enabled: false } });
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Other', match: 'links', action: 'hide', targetIds: ['elsewhere'] } });
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Words', match: 'keywords', keywords: ['promo'], action: 'alert' } });
    const old = comment('c1', 'promo https://x.example', { createdTime: new Date(now.getTime() - 3 * 86_400_000) });
    const fresh = comment('c2', 'PROMO code inside');

    expect(await moderation.applyModerationRules(postTarget.id, [old, fresh], now)).toBe(1);
    expect(graph.hidden).toHaveLength(0);
    expect(alerts).toEqual([{ rule: 'Words', message: 'PROMO code inside' }]);
  });

  it('replies once per person and stops at the daily cap', async () => {
    const { workspace, postTarget } = await seed();
    await prisma.moderationRule.create({
      data: { workspaceId: workspace.id, name: 'Price', match: 'keywords', keywords: ['price'], action: 'reply', replyText: 'Hi {first_name}, check your messages.', dailyCap: 2 },
    });
    const comments = [
      comment('c1', 'price?', { fromId: 'u1' }),
      comment('c2', 'price please', { fromId: 'u1' }),
      comment('c3', 'price', { fromId: 'u2' }),
      comment('c4', 'price', { fromId: 'u3' }),
    ];
    expect(await moderation.applyModerationRules(postTarget.id, comments, now)).toBe(2);
    expect(graph.replies).toEqual([
      { id: 'c1', text: 'Hi Alex, check your messages.' },
      { id: 'c3', text: 'Hi Alex, check your messages.' },
    ]);
  });

  it('records Facebook’s refusal and stops when the app is over its allowance', async () => {
    const { workspace, postTarget } = await seed();
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Links', match: 'links', action: 'hide' } });
    const { GraphError } = await import('../src/lib/facebook/graph');
    graph.fail = new GraphError({ message: 'Application request limit reached', kind: 'rate_limit', code: 4 });
    const comments = [comment('c1', 'https://a.example'), comment('c2', 'https://b.example')];

    expect(await moderation.applyModerationRules(postTarget.id, comments, now)).toBe(0);
    const actions = await prisma.moderationAction.findMany();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.error).toBeTruthy();
  });
});

describe('undoModerationAction', () => {
  it('unhides a hidden comment and deletes a reply, once', async () => {
    const { workspace, user, postTarget } = await seed();
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Links', match: 'links', action: 'hide' } });
    await prisma.moderationRule.create({ data: { workspaceId: workspace.id, name: 'Hello', match: 'keywords', keywords: ['hello'], action: 'reply', replyText: 'Hi!' } });
    const comments = [comment('c1', 'https://a.example'), comment('c2', 'hello')];
    await store(postTarget.id, comments);
    await moderation.applyModerationRules(postTarget.id, comments, now);

    const hide = await prisma.moderationAction.findFirstOrThrow({ where: { action: 'hide' } });
    const reply = await prisma.moderationAction.findFirstOrThrow({ where: { action: 'reply' } });
    const as = { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.editor };

    expect(await moderation.undoModerationAction({ id: hide.id, ...as, role: WorkspaceRole.contributor })).toEqual({ outcome: 'forbidden' });
    expect(await moderation.undoModerationAction({ id: hide.id, ...as })).toEqual({ outcome: 'ok' });
    expect(graph.hidden.at(-1)).toEqual({ id: 'c1', hide: false });
    expect((await prisma.postComment.findFirst({ where: { remoteId: 'c1' } }))?.isHidden).toBe(false);
    expect((await moderation.undoModerationAction({ id: hide.id, ...as })).outcome).toBe('not_undoable');

    expect(await moderation.undoModerationAction({ id: reply.id, ...as })).toEqual({ outcome: 'ok' });
    expect(graph.deleted).toEqual(['reply-c2']);
    expect(await prisma.activityLog.count({ where: { action: 'moderation.undone' } })).toBe(2);

    expect((await moderation.undoModerationAction({ id: reply.id, ...as, workspaceId: 'other' })).outcome).toBe('not_found');
  });
});
