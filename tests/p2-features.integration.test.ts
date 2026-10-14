import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubReportEmailProvider } from './helpers/report-email';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Client links, whole-queue actions and emailed reports, against a real database. */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let share: typeof import('../src/lib/share-links');
let queue: typeof import('../src/lib/queue-actions');
let reports: typeof import('../src/lib/report-schedules');

const now = new Date('2026-10-01T06:00:00Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('p2features');
  ({ prisma } = await import('../src/lib/prisma'));
  share = await import('../src/lib/share-links');
  queue = await import('../src/lib/queue-actions');
  reports = await import('../src/lib/report-schedules');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.reviewDecision.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.reportSchedule.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const owner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Agency',
      slug: 'agency',
      timezone: 'UTC',
      memberships: { create: [{ userId: owner.id, role: WorkspaceRole.owner }] },
    },
  });
  const page = (name: string) =>
    prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: name, name, accessToken: null } });
  const [bakery, garage] = await Promise.all([page('Bakery'), page('Garage')]);
  return { owner, workspace, bakery, garage };
}

async function scheduled(workspaceId: string, userId: string, targetId: string, at: string, message: string) {
  return prisma.post.create({
    data: {
      workspaceId,
      authorId: userId,
      message,
      status: 'scheduled',
      publishMode: 'worker',
      scheduledAt: new Date(at),
      targets: { create: [{ targetId }] },
    },
  });
}

describe('client links', () => {
  it('open with the token only once made, and stop at revocation', async () => {
    const { owner, workspace, bakery } = await seed();
    const made = await share.createShareLink(workspace.id, owner.id, {
      kind: 'review',
      title: 'October',
      targetIds: [bakery.id, 'not-ours'],
      daysBack: 7,
      daysAhead: 30,
      allowComments: true,
      decides: false,
    });
    const token = made.url.split('/share/')[1]!;
    const link = await share.openShareLink(token);
    expect(link?.pageIds).toEqual([bakery.id]);
    // The token itself is never stored.
    const row = await prisma.shareLink.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.tokenHash).not.toContain(token);

    expect(await share.openShareLink('wrong-token-but-long-enough')).toBeNull();
    await prisma.shareLink.update({ where: { id: made.id }, data: { revokedAt: new Date() } });
    expect(await share.openShareLink(token)).toBeNull();
  });

  it('show only the Pages they name', async () => {
    const { owner, workspace, bakery, garage } = await seed();
    await scheduled(workspace.id, owner.id, bakery.id, '2026-10-05T09:00:00Z', 'Bread');
    await scheduled(workspace.id, owner.id, garage.id, '2026-10-05T09:00:00Z', 'Tyres');
    const where = share.sharedPostWhere({ workspaceId: workspace.id, pageIds: [bakery.id] });
    const visible = await prisma.post.findMany({ where });
    expect(visible.map((post) => post.message)).toEqual(['Bread']);
  });
});

describe('the whole queue', () => {
  it('shuffles the posts among the same times', async () => {
    const { owner, workspace, bakery } = await seed();
    const times = ['2026-10-05T09:00:00Z', '2026-10-06T09:00:00Z', '2026-10-07T09:00:00Z'];
    for (const [index, at] of times.entries()) await scheduled(workspace.id, owner.id, bakery.id, at, `Post ${index}`);
    const moved = await queue.shuffleQueue({ workspaceId: workspace.id, userId: owner.id, targetIds: null, now, random: () => 0 });
    expect(moved).toBe(3);
    const after = await prisma.post.findMany({ orderBy: { scheduledAt: 'asc' } });
    expect(after.map((post) => post.scheduledAt!.toISOString())).toEqual(times.map((at) => new Date(at).toISOString()));
    expect(after.map((post) => post.message)).not.toEqual(['Post 0', 'Post 1', 'Post 2']);
  });

  it('clears one Page back to drafts and leaves the other alone', async () => {
    const { owner, workspace, bakery, garage } = await seed();
    await scheduled(workspace.id, owner.id, bakery.id, '2026-10-05T09:00:00Z', 'Bread');
    await scheduled(workspace.id, owner.id, garage.id, '2026-10-05T09:00:00Z', 'Tyres');
    expect(await queue.clearQueue({ workspaceId: workspace.id, userId: owner.id, targetIds: [bakery.id], now })).toBe(1);
    const posts = await prisma.post.findMany({ orderBy: { message: 'asc' } });
    expect(posts.map((post) => [post.message, post.status, post.scheduledAt === null])).toEqual([
      ['Bread', 'draft', true],
      ['Tyres', 'scheduled', false],
    ]);
  });
});

describe('a Page’s drafts', () => {
  it('are deleted only when written for that Page alone', async () => {
    const { owner, workspace, bakery, garage } = await seed();
    const draft = (targetIds: string[], message: string) =>
      prisma.post.create({
        data: { workspaceId: workspace.id, authorId: owner.id, message, status: 'draft', targets: { create: targetIds.map((targetId) => ({ targetId })) } },
      });
    await draft([bakery.id], 'Mine');
    await draft([bakery.id, garage.id], 'Shared');
    await draft([garage.id], 'Theirs');
    expect(await queue.clearDrafts({ workspaceId: workspace.id, userId: owner.id, targetId: bakery.id })).toBe(1);
    const left = await prisma.post.findMany({ orderBy: { message: 'asc' } });
    expect(left.map((post) => post.message)).toEqual(['Shared', 'Theirs']);
  });
});

describe('taking a published post down', () => {
  it('deletes a draft record and its destinations without a remote request', async () => {
    const { owner, workspace, bakery } = await seed();
    const post = await prisma.post.create({ data: {
      workspaceId: workspace.id, authorId: owner.id, message: 'Old draft',
      targets: { create: [{ targetId: bakery.id }] },
    } });
    const posts = await import('../src/lib/posts');
    expect(await posts.deletePostRecord({ workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner }, post.id, false)).toEqual({ deleted: true, removedRemote: 0 });
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    expect(await prisma.postTarget.count({ where: { postId: post.id } })).toBe(0);
  });

  it('keeps a published record when remote removal cannot be confirmed', async () => {
    const { owner, workspace, bakery } = await seed();
    const post = await prisma.post.create({ data: {
      workspaceId: workspace.id, authorId: owner.id, message: 'Still live', status: 'published',
      targets: { create: [{ targetId: bakery.id, status: 'published', remotePostId: '1_9' }] },
    } });
    const posts = await import('../src/lib/posts');
    await expect(posts.deletePostRecord({ workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner }, post.id, true)).rejects.toMatchObject({ key: 'errors.remoteDeleteFailed' });
    expect(await prisma.post.findUnique({ where: { id: post.id } })).not.toBeNull();
    expect(await posts.deletePostRecord({ workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner }, post.id, false)).toEqual({ deleted: true, removedRemote: 0 });
  });

  it('deletes it on Facebook and marks each Page with when', async () => {
    const { owner, workspace, bakery } = await seed();
    const { encryptSecret } = await import('../src/lib/crypto');
    await prisma.target.update({ where: { id: bakery.id }, data: { accessToken: encryptSecret('page-token') } });
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Live',
        status: 'published',
        targets: { create: [{ targetId: bakery.id, status: 'published', remotePostId: '1_2', remoteUrl: 'https://facebook.com/1_2', publishedAt: now }] },
      },
    });
    const calls: Array<{ url: string; method: string }> = [];
    const { vi } = await import('vitest');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ success: true }), { headers: { 'content-type': 'application/json' } });
    }));
    const posts = await import('../src/lib/posts');
    const result = await posts.removePublishedPost({ workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner }, post.id);
    vi.unstubAllGlobals();
    expect(result).toEqual({ removed: 1, failures: [] });
    expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('1_2'))).toBe(true);
    const row = await prisma.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    expect(row.removedAt).not.toBeNull();
    // Twice is harmless: nothing is left to take down.
    expect(await posts.removePublishedPost({ workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner }, post.id)).toEqual({ removed: 0, failures: [] });
  });
});

describe('emailed reports', () => {
  beforeEach(stubReportEmailProvider);
  afterEach(() => vi.restoreAllMocks());
  it('go to every recipient when due, then move to the next run', async () => {
    const { workspace, bakery } = await seed();
    const schedule = await reports.createReportSchedule(workspace.id, {
      targetId: bakery.id,
      frequency: 'weekly',
      recipients: ['client@example.test', 'boss@example.test'],
    });
    expect(schedule.nextRunAt.getUTCDay()).toBe(1);

    // Not due yet: nothing goes.
    expect(await reports.sendDueReports(new Date(schedule.nextRunAt.getTime() - 1000))).toEqual({ sent: 0, failed: 0 });

    const result = await reports.sendDueReports(schedule.nextRunAt);
    expect(result).toEqual({ sent: 1, failed: 0 });
    const logs = await prisma.emailLog.findMany({ where: { template: 'scheduledReport' } });
    expect(logs.map((log) => log.to).sort()).toEqual(['boss@example.test', 'client@example.test']);
    expect(logs[0]!.subject).toContain('Bakery');

    const after = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(after.nextRunAt.getTime() - schedule.nextRunAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(after.lastError).toBeNull();
  });

  it('refuse a Page from another workspace', async () => {
    const { workspace } = await seed();
    const other = await prisma.workspace.create({ data: { name: 'Other', slug: 'other' } });
    const stranger = await prisma.target.create({
      data: { workspaceId: other.id, type: 'page', providerId: 'x', name: 'X', accessToken: null },
    });
    await expect(
      reports.createReportSchedule(workspace.id, { targetId: stranger.id, frequency: 'monthly', recipients: ['a@example.test'] }),
    ).rejects.toThrow();
  });
});
