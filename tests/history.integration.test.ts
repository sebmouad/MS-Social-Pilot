import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Reading the audit trail.
 *
 * Both tables were written from the beginning and read by nothing except the
 * sweeper that deletes them. These check the two things that make the reading
 * worth having: that an entry survives the person who made it, and that one
 * client's history is not another's.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let history: typeof import('../src/lib/history');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('history');

  ({ prisma } = await import('../src/lib/prisma'));
  history = await import('../src/lib/history');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(label = 'client') {
  const suffix = randomBytes(3).toString('hex');

  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.com`, name: 'Wren Halloway', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: label,
      slug: `${label}-${suffix}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: WorkspaceRole.owner } },
    },
  });

  return { user, workspace };
}

describe('reading the activity log', () => {
  it('puts a name to who did it', async () => {
    const { user, workspace } = await seed();
    await prisma.activityLog.create({
      data: { workspaceId: workspace.id, actorId: user.id, action: 'post.created' },
    });

    const rows = await history.readActivity({ workspaceId: workspace.id });

    expect(rows[0]?.actorName).toBe('Wren Halloway');
  });

  it('keeps the entry when the person who made it is gone', async () => {
    const { user, workspace } = await seed();
    await prisma.activityLog.create({
      data: { workspaceId: workspace.id, actorId: user.id, action: 'comment.deleted' },
    });

    // Someone leaving the agency does not un-delete the comment they deleted.
    // `actorId` is a plain column rather than a relation for exactly this: a
    // foreign key would have had to cascade or block, and both are wrong.
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const rows = await history.readActivity({ workspaceId: workspace.id });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('comment.deleted');
    expect(rows[0]?.actorName).toBeNull();
  });

  it('distinguishes the app acting on its own from a person', async () => {
    const { workspace } = await seed();
    await prisma.activityLog.create({
      data: { workspaceId: workspace.id, actorId: null, action: 'post.recycled' },
    });

    const rows = await history.readActivity({ workspaceId: workspace.id });

    expect(rows[0]?.actorName).toBeNull();
  });

  it('keeps what was deleted, because Facebook does not', async () => {
    const { user, workspace } = await seed();
    await prisma.activityLog.create({
      data: {
        workspaceId: workspace.id,
        actorId: user.id,
        action: 'comment.deleted',
        detail: { author: 'Ada Byron', message: 'Not impressed' },
      },
    });

    const rows = await history.readActivity({ workspaceId: workspace.id });

    expect(rows[0]?.detail).toMatchObject({ author: 'Ada Byron', message: 'Not impressed' });
  });

  it('newest first', async () => {
    const { workspace } = await seed();
    await prisma.activityLog.create({
      data: {
        workspaceId: workspace.id,
        action: 'post.created',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.activityLog.create({
      data: {
        workspaceId: workspace.id,
        action: 'post.updated',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    });

    const rows = await history.readActivity({ workspaceId: workspace.id });

    expect(rows.map((row) => row.action)).toEqual(['post.updated', 'post.created']);
  });

  it('cannot see another client’s history', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');
    await prisma.activityLog.create({
      data: { workspaceId: theirs.workspace.id, action: 'post.created' },
    });

    expect(await history.readActivity({ workspaceId: mine.workspace.id })).toEqual([]);
  });
});

describe('reading the email log', () => {
  async function seedEmails(workspaceId: string) {
    await prisma.emailLog.createMany({
      data: [
        { workspaceId, to: 'a@example.com', template: 'invitation', subject: 'You are invited', status: 'sent' },
        { workspaceId, to: 'b@example.com', template: 'failure', subject: 'A post failed', status: 'failed', error: 'Domain not verified' },
        { workspaceId, to: 'c@example.com', template: 'failure', subject: 'A post failed', status: 'skipped' },
      ],
    });
  }

  it('shows everything by default', async () => {
    const { workspace } = await seed();
    await seedEmails(workspace.id);

    expect(await history.readEmailLog({ workspaceId: workspace.id })).toHaveLength(3);
  });

  it('can show only what did not arrive', async () => {
    const { workspace } = await seed();
    await seedEmails(workspace.id);

    const rows = await history.readEmailLog({ workspaceId: workspace.id, failuresOnly: true });

    // "Skipped" counts: no provider configured means the notification was not
    // sent, which is the same outcome for the person expecting it.
    expect(rows.map((row) => row.status).sort()).toEqual(['failed', 'skipped']);
  });

  it('keeps the reason it failed', async () => {
    const { workspace } = await seed();
    await seedEmails(workspace.id);

    const failed = (await history.readEmailLog({ workspaceId: workspace.id })).find(
      (row) => row.status === 'failed',
    );

    expect(failed?.error).toBe('Domain not verified');
  });

  it('counts recent failures for the banner, ignoring old ones', async () => {
    const { workspace } = await seed();
    await prisma.emailLog.createMany({
      data: [
        {
          workspaceId: workspace.id,
          to: 'a@example.com',
          template: 'failure',
          subject: 'Recent',
          status: 'failed',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
        {
          workspaceId: workspace.id,
          to: 'b@example.com',
          template: 'failure',
          subject: 'Ancient',
          status: 'failed',
          createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    const count = await history.countRecentEmailFailures({
      workspaceId: workspace.id,
      since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    expect(count).toBe(1);
  });
});

describe('paging through a long history', () => {
  it('shows every entry exactly once across the pages', async () => {
    const { workspace } = await seed();

    // Same timestamp on purpose. Postgres guarantees nothing about the order
    // of rows whose sort keys are equal, so paging over them without a unique
    // tiebreaker can show one row twice and another never.
    //
    // Worth being straight about what this test does and does not prove: on a
    // small, freshly-inserted table Postgres returns them in physical order,
    // which is stable, so this passes with the tiebreaker removed. It fails
    // once a plan changes — a parallel scan, dead tuples after updates, a
    // different index — which is exactly the kind of thing that changes in
    // production and not in a test. The tiebreaker is there because the
    // guarantee does not exist, not because this test forces the issue.
    const when = new Date('2026-03-01T09:00:00Z');
    await prisma.activityLog.createMany({
      data: Array.from({ length: 25 }, () => ({
        workspaceId: workspace.id,
        action: 'post.created',
        createdAt: when,
      })),
    });

    const seen = new Set<string>();
    for (let page = 0; page < 3; page += 1) {
      const rows = await history.readActivity({
        workspaceId: workspace.id,
        skip: page * 10,
        limit: 10,
      });
      for (const row of rows) seen.add(row.id);
    }

    expect(seen.size).toBe(25);
  });

  it('counts what there is to page through', async () => {
    const { workspace } = await seed();
    await prisma.activityLog.createMany({
      data: Array.from({ length: 7 }, () => ({
        workspaceId: workspace.id,
        action: 'post.updated',
      })),
    });

    expect(await history.countActivity(workspace.id)).toBe(7);
  });

  it('counts only the failures when that is what is being shown', async () => {
    const { workspace } = await seed();
    await prisma.emailLog.createMany({
      data: [
        { workspaceId: workspace.id, to: 'a@example.com', template: 'x', subject: 'ok', status: 'sent' },
        { workspaceId: workspace.id, to: 'b@example.com', template: 'x', subject: 'no', status: 'failed' },
      ],
    });

    expect(await history.countEmailLog({ workspaceId: workspace.id })).toBe(2);
    expect(await history.countEmailLog({ workspaceId: workspace.id, failuresOnly: true })).toBe(1);
  });
})
