import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Content mix: the worker fills a Page's week from labelled
 * drafts when the workspace allows it, never sends a draft that still needs
 * approval, and tells admins once when a label runs dry.
 */

const dryNotices: Array<{ targetId: string; labelId: string }> = [];
vi.mock('../src/lib/email/notify', async (original) => ({
  ...(await original<typeof import('../src/lib/email/notify')>()),
  notifyMixDry: async (options: { targetId: string; labelId: string }) => {
    dryNotices.push({ targetId: options.targetId, labelId: options.labelId });
  },
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let mix: typeof import('../src/lib/content-mix');

// A Monday morning; the workspace posts at 10:00 and 15:00 every day.
const now = new Date('2026-11-02T08:00:00Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('content_mix');
  ({ prisma } = await import('../src/lib/prisma'));
  mix = await import('../src/lib/content-mix');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  dryNotices.length = 0;
  await prisma.post.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

async function seed(options: { autoFill: boolean; requiresApproval?: boolean }) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Client A',
      slug: `client-a-${stamp}`,
      timezone: 'UTC',
      mixAutoFill: options.autoFill,
      requiresApproval: options.requiresApproval ?? false,
    },
  });
  const owner = await prisma.user.create({ data: { email: `owner-${stamp}@example.test`, name: 'Owner', passwordHash: 'x' } });
  const contributor = await prisma.user.create({ data: { email: `writer-${stamp}@example.test`, name: 'Writer', passwordHash: 'x' } });
  await prisma.membership.createMany({
    data: [
      { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner },
      { workspaceId: workspace.id, userId: contributor.id, role: WorkspaceRole.contributor },
    ],
  });
  const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `p-${stamp}`, name: 'Page 1' } });
  const label = await prisma.label.create({ data: { workspaceId: workspace.id, name: 'Product launch' } });
  const group = await prisma.pageGroup.create({ data: { workspaceId: workspace.id, name: 'Client A pages', pages: { create: { targetId: page.id } } } });
  for (let day = 0; day < 7; day += 1) {
    await prisma.queueSlot.createMany({
      data: [
        { workspaceId: workspace.id, dayOfWeek: day, hour: 10, minute: 0 },
        { workspaceId: workspace.id, dayOfWeek: day, hour: 15, minute: 0 },
      ],
    });
  }
  return { workspace, owner, contributor, page, label, group };
}

async function draft(workspaceId: string, authorId: string, pageId: string, labelId: string, approvalStatus: ApprovalStatus = ApprovalStatus.not_required) {
  return prisma.post.create({
    data: {
      workspaceId,
      authorId,
      message: 'A labelled draft',
      status: PostStatus.draft,
      approvalStatus,
      targets: { create: { targetId: pageId } },
      labels: { create: { labelId } },
    },
  });
}

describe('content mix', () => {
  it('rejects a Page, group or label from another workspace', async () => {
    const mine = await seed({ autoFill: false });
    const theirs = await seed({ autoFill: false });
    await expect(
      mix.saveMix(mine.workspace.id, { scope: { targetId: theirs.page.id }, rules: [{ labelId: mine.label.id, perWeek: 2 }] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      mix.saveMix(mine.workspace.id, { scope: { groupId: mine.group.id }, rules: [{ labelId: theirs.label.id, perWeek: 2 }] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reports the week without touching drafts when auto-fill is off', async () => {
    const { workspace, owner, page, label, group } = await seed({ autoFill: false });
    await mix.saveMix(workspace.id, { scope: { groupId: group.id }, rules: [{ labelId: label.id, perWeek: 2 }] });
    await draft(workspace.id, owner.id, page.id, label.id);

    expect(await mix.runContentMix(now)).toEqual({ scheduled: 0, dry: 0 });
    expect(await mix.mixStatus(workspace.id, now)).toEqual([
      { targetId: page.id, lines: [{ labelId: label.id, perWeek: 2, planned: 0, drafts: 1 }] },
    ]);
    expect(await prisma.post.count({ where: { status: PostStatus.draft } })).toBe(1);
  });

  it('schedules drafts into free queue times up to the mix, then says once that the label ran dry', async () => {
    const { workspace, owner, page, label } = await seed({ autoFill: true });
    await mix.saveMix(workspace.id, { scope: { targetId: page.id }, rules: [{ labelId: label.id, perWeek: 3 }] });
    await draft(workspace.id, owner.id, page.id, label.id);
    await draft(workspace.id, owner.id, page.id, label.id);

    expect(await mix.runContentMix(now)).toEqual({ scheduled: 2, dry: 1 });
    const scheduled = await prisma.post.findMany({ where: { status: PostStatus.scheduled }, orderBy: { scheduledAt: 'asc' } });
    expect(scheduled.map((post) => post.scheduledAt?.toISOString())).toEqual(['2026-11-02T10:00:00.000Z', '2026-11-02T15:00:00.000Z']);
    expect(dryNotices).toEqual([{ targetId: page.id, labelId: label.id }]);
    expect(await prisma.activityLog.count({ where: { workspaceId: workspace.id, action: 'queue.mixScheduled' } })).toBe(2);

    // Still dry an hour later: no second email.
    expect(await mix.runContentMix(new Date(now.getTime() + 3_600_000))).toEqual({ scheduled: 0, dry: 0 });
    expect(dryNotices).toHaveLength(1);

    // A new draft fills the gap and clears the episode, so the next dry spell is told again.
    await draft(workspace.id, owner.id, page.id, label.id);
    expect(await mix.runContentMix(new Date(now.getTime() + 7_200_000))).toEqual({ scheduled: 1, dry: 0 });
    expect(await prisma.contentMixRule.findFirst({ where: { workspaceId: workspace.id } })).toMatchObject({ dryNotifiedAt: null });
  });

  it('leaves a contributor’s draft alone while the workspace requires approval', async () => {
    const { workspace, owner, contributor, page, label } = await seed({ autoFill: true, requiresApproval: true });
    await mix.saveMix(workspace.id, { scope: { targetId: page.id }, rules: [{ labelId: label.id, perWeek: 3 }] });
    const pending = await draft(workspace.id, contributor.id, page.id, label.id);
    const approved = await draft(workspace.id, contributor.id, page.id, label.id, ApprovalStatus.approved);
    const own = await draft(workspace.id, owner.id, page.id, label.id);

    expect(await mix.runContentMix(now)).toMatchObject({ scheduled: 2 });
    const status = new Map((await prisma.post.findMany({ select: { id: true, status: true } })).map((post) => [post.id, post.status]));
    expect(status.get(pending.id)).toBe(PostStatus.draft);
    expect(status.get(approved.id)).toBe(PostStatus.scheduled);
    expect(status.get(own.id)).toBe(PostStatus.scheduled);
  });
});
