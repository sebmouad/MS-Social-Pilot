import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Deleting media that a post still needs.
 *
 * A post's media is a Json array holding the storage key, not a foreign key, so
 * the database will happily let a file be deleted out from under a scheduled
 * post. The failure then surfaces hours later at publish time as a Graph error
 * nobody can connect back to a deletion — which is why the check lives here
 * rather than being left to the database.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let media: typeof import('../src/lib/media');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('media');

  ({ prisma } = await import('../src/lib/prisma'));
  media = await import('../src/lib/media');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.media.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(label = 'client') {
  const suffix = randomBytes(3).toString('hex');

  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: label,
      slug: `${label}-${suffix}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: WorkspaceRole.owner } },
    },
  });
  const file = await prisma.media.create({
    data: {
      workspaceId: workspace.id,
      kind: 'image',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      storageKey: `uploads/${suffix}.jpg`,
      url: `/api/media/${suffix}/raw`,
    },
  });

  return { user, workspace, file };
}

/**
 * A post carrying one media reference, in whatever state.
 *
 * Written through `mediaColumns`, the same helper the application uses, because
 * the payload and the indexed key array must never be written apart — a fixture
 * that set only one of them would be testing a state the app cannot produce.
 */
async function postWith(
  workspaceId: string,
  userId: string,
  status: 'draft' | 'scheduled' | 'published' | 'cancelled' | 'pending_approval',
  item: { id: string; storageKey?: string },
) {
  const { mediaColumns } = await import('../src/lib/json');

  return prisma.post.create({
    data: {
      workspaceId,
      authorId: userId,
      message: `A ${status} post`,
      status,
      ...mediaColumns([
        {
          id: item.id,
          kind: 'image',
          url: '/x.jpg',
          ...(item.storageKey ? { storageKey: item.storageKey } : {}),
        },
      ]),
    },
  });
}

describe('postsUsingMedia', () => {
  it('finds nothing when the file is unused', async () => {
    const { workspace, file } = await seed();

    expect(
      await media.postsUsingMedia({
        workspaceId: workspace.id,
        mediaId: file.id,
        storageKey: file.storageKey,
      }),
    ).toEqual([]);
  });

  it('finds a scheduled post that still needs the file', async () => {
    const { workspace, user, file } = await seed();
    const post = await postWith(workspace.id, user.id, 'scheduled', {
      id: file.id,
      storageKey: file.storageKey!,
    });

    const inUse = await media.postsUsingMedia({
      workspaceId: workspace.id,
      mediaId: file.id,
      storageKey: file.storageKey,
    });

    expect(inUse.map((entry) => entry.id)).toEqual([post.id]);
  });

  it('matches on the storage key even when the media id has changed', async () => {
    // A re-upload of the same bytes reuses the key; the reference in an older
    // post may still carry the previous row's id.
    const { workspace, user, file } = await seed();
    await postWith(workspace.id, user.id, 'draft', {
      id: 'some-older-id',
      storageKey: file.storageKey!,
    });

    expect(
      (
        await media.postsUsingMedia({
          workspaceId: workspace.id,
          mediaId: file.id,
          storageKey: file.storageKey,
        })
      ).length,
    ).toBe(1);
  });

  it('counts drafts and posts awaiting approval, not only scheduled ones', async () => {
    const { workspace, user, file } = await seed();
    await postWith(workspace.id, user.id, 'draft', { id: file.id });
    await postWith(workspace.id, user.id, 'pending_approval', { id: file.id });

    expect(
      (
        await media.postsUsingMedia({
          workspaceId: workspace.id,
          mediaId: file.id,
          storageKey: file.storageKey,
        })
      ).length,
    ).toBe(2);
  });

  it('ignores a post that has already gone out', async () => {
    // Facebook holds its own copy by then, so deleting ours changes nothing.
    const { workspace, user, file } = await seed();
    await postWith(workspace.id, user.id, 'published', { id: file.id });

    expect(
      await media.postsUsingMedia({
        workspaceId: workspace.id,
        mediaId: file.id,
        storageKey: file.storageKey,
      }),
    ).toEqual([]);
  });

  it('ignores a cancelled post', async () => {
    const { workspace, user, file } = await seed();
    await postWith(workspace.id, user.id, 'cancelled', { id: file.id });

    expect(
      await media.postsUsingMedia({
        workspaceId: workspace.id,
        mediaId: file.id,
        storageKey: file.storageKey,
      }),
    ).toEqual([]);
  });

  it('does not see another workspace’s posts', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');
    await postWith(theirs.workspace.id, theirs.user.id, 'scheduled', { id: theirs.file.id });

    expect(
      await media.postsUsingMedia({
        workspaceId: mine.workspace.id,
        mediaId: theirs.file.id,
        storageKey: theirs.file.storageKey,
      }),
    ).toEqual([]);
  });

  it('survives a post whose media column is malformed', async () => {
    // Rows written by an older version must degrade, not crash the library.
    const { workspace, user, file } = await seed();
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Odd row',
        status: 'draft',
        media: ['not-an-object', { kind: 'image' }] as never,
        mediaKeys: [],
      },
    });

    await expect(
      media.postsUsingMedia({
        workspaceId: workspace.id,
        mediaId: file.id,
        storageKey: file.storageKey,
      }),
    ).resolves.toEqual([]);
  });
});

describe('deleteUnusedMedia', () => {
  const now = new Date('2026-09-01T10:00:00Z');
  const old = new Date('2026-07-01T10:00:00Z');

  async function age(id: string, when: Date) {
    await prisma.media.update({ where: { id }, data: { createdAt: when } });
  }

  it('removes an upload nobody ever used', async () => {
    const { workspace, file } = await seed();
    await age(file.id, old);

    const result = await media.deleteUnusedMedia({
      workspaceId: workspace.id,
      olderThanDays: 30,
      now,
    });

    expect(result.removed).toBe(1);
    expect(result.bytes).toBe(1024);
    expect(await prisma.media.count()).toBe(0);
  });

  it('keeps an upload that is still young', async () => {
    // Someone may be part-way through composing with it.
    const { workspace, file } = await seed();
    await age(file.id, new Date('2026-08-30T10:00:00Z'));

    expect(
      (await media.deleteUnusedMedia({ workspaceId: workspace.id, olderThanDays: 30, now })).removed,
    ).toBe(0);
  });

  it('keeps a file a published post still shows', async () => {
    // Facebook has its own copy, but our post detail view renders ours, and
    // deleting it would turn history into broken images.
    const { workspace, user, file } = await seed();
    await age(file.id, old);
    await postWith(workspace.id, user.id, 'published', {
      id: file.id,
      storageKey: file.storageKey!,
    });

    expect(
      (await media.deleteUnusedMedia({ workspaceId: workspace.id, olderThanDays: 30, now })).removed,
    ).toBe(0);
  });

  it('keeps a file a cancelled post references', async () => {
    const { workspace, user, file } = await seed();
    await age(file.id, old);
    await postWith(workspace.id, user.id, 'cancelled', { id: file.id });

    expect(
      (await media.deleteUnusedMedia({ workspaceId: workspace.id, olderThanDays: 30, now })).removed,
    ).toBe(0);
  });

  it('matches a reference by storage key as well as by id', async () => {
    const { workspace, user, file } = await seed();
    await age(file.id, old);
    await postWith(workspace.id, user.id, 'draft', {
      id: 'a-different-id',
      storageKey: file.storageKey!,
    });

    expect(
      (await media.deleteUnusedMedia({ workspaceId: workspace.id, olderThanDays: 30, now })).removed,
    ).toBe(0);
  });

  it('never reaches into another workspace', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');
    await age(theirs.file.id, old);

    expect(
      (await media.deleteUnusedMedia({ workspaceId: mine.workspace.id, olderThanDays: 30, now }))
        .removed,
    ).toBe(0);
    expect(await prisma.media.count({ where: { id: theirs.file.id } })).toBe(1);
  });

  it('drops the row even when the file is already gone from disk', async () => {
    // The storage key points at nothing in a test, so this also covers a disk
    // that was restored without its media directory.
    const { workspace, file } = await seed();
    await age(file.id, old);

    const result = await media.deleteUnusedMedia({
      workspaceId: workspace.id,
      olderThanDays: 30,
      now,
    });

    expect(result.removed).toBe(1);
    expect(await prisma.media.count()).toBe(0);
  });
});

describe('mediaColumns', () => {
  it('keeps the payload and the key array in step', async () => {
    const { mediaColumns } = await import('../src/lib/json');

    const columns = mediaColumns([
      { id: 'a', kind: 'image', url: '/a.jpg', storageKey: 'uploads/a.jpg' },
      { id: 'b', kind: 'video', url: '/b.mp4' },
    ]);

    expect(columns.mediaKeys.sort()).toEqual(['a', 'b', 'uploads/a.jpg']);
  });

  it('does not repeat a key shared by two references', async () => {
    const { mediaColumns } = await import('../src/lib/json');

    const columns = mediaColumns([
      { id: 'a', kind: 'image', url: '/a.jpg', storageKey: 'uploads/same.jpg' },
      { id: 'b', kind: 'image', url: '/b.jpg', storageKey: 'uploads/same.jpg' },
    ]);

    expect(columns.mediaKeys.filter((key) => key === 'uploads/same.jpg')).toHaveLength(1);
  });

  it('produces an empty array for a post with no media', async () => {
    const { mediaColumns } = await import('../src/lib/json');
    expect(mediaColumns([]).mediaKeys).toEqual([]);
  });
});

describe('storageUsage', () => {
  it('sums only this workspace', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');
    await prisma.media.update({ where: { id: theirs.file.id }, data: { size: 999_999 } });

    const usage = await media.storageUsage(mine.workspace.id);
    expect(usage.bytes).toBe(1024);
  });

  it('reports zero for a workspace holding nothing', async () => {
    const { workspace, file } = await seed();
    await prisma.media.delete({ where: { id: file.id } });

    expect((await media.storageUsage(workspace.id)).bytes).toBe(0);
  });

  it('caps the percentage at 100 rather than reporting 340%', async () => {
    // A quota lowered below what is already stored must still render.
    const settings = await import('../src/lib/settings');
    const { workspace, file } = await seed();
    await prisma.media.update({ where: { id: file.id }, data: { size: 50 * 1024 * 1024 } });

    await settings.writeSetting('media.workspaceQuotaMb', 1, null);
    await settings.ensureSettings();

    const usage = await media.storageUsage(workspace.id);
    expect(usage.percent).toBe(100);

    await settings.clearSetting('media.workspaceQuotaMb');
    await settings.ensureSettings();
  });
});
