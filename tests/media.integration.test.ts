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

/**
 * The declared type is whatever the browser was told to send. It is a claim,
 * not a fact, and everything downstream — the download route's content-type,
 * the file handed to Facebook, the key a future object store would infer a type
 * from — is built on it.
 */
describe('what a file actually is', () => {
  let media: typeof import('../src/lib/media');

  beforeAll(async () => {
    media = await import('../src/lib/media');
  });

  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const GIF = Buffer.from('GIF89a-and-then-some');
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)]);
  const MOV = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  '), Buffer.alloc(8)]);
  const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

  it('recognises the formats it accepts', () => {
    expect(media.sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(media.sniffMimeType(PNG)).toBe('image/png');
    expect(media.sniffMimeType(GIF)).toBe('image/gif');
    expect(media.sniffMimeType(WEBP)).toBe('image/webp');
    expect(media.sniffMimeType(MP4)).toBe('video/mp4');
    expect(media.sniffMimeType(MOV)).toBe('video/quicktime');
  });

  it('recognises nothing in something else', () => {
    expect(media.sniffMimeType(HTML)).toBeNull();
    expect(media.sniffMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('stores a real image', async () => {
    const stored = await media.storeFile({
      workspaceId: 'ws-real',
      data: PNG,
      mimeType: 'image/png',
      originalName: 'photo.png',
    });

    expect(stored.kind).toBe('image');
    expect(stored.storageKey).toMatch(/\.png$/);
  });

  it('refuses HTML wearing an image content type', async () => {
    await expect(
      media.storeFile({
        workspaceId: 'ws-liar',
        data: HTML,
        mimeType: 'image/png',
        originalName: 'photo.png',
      }),
    ).rejects.toThrow(/not a JPEG, PNG, GIF, WebP or MP4/i);
  });

  it('refuses a video sent as an image', async () => {
    await expect(
      media.storeFile({
        workspaceId: 'ws-mismatch',
        data: MP4,
        mimeType: 'image/png',
        originalName: 'clip.png',
      }),
    ).rejects.toThrow(/contents are video\/mp4/i);
  });

  it('takes the extension from the file, not from the name it was given', async () => {
    // The name is the uploader's to choose. What it produces on disk is not.
    const stored = await media.storeFile({
      workspaceId: 'ws-extension',
      data: PNG,
      mimeType: 'image/png',
      originalName: 'not-really.php',
    });

    expect(stored.storageKey).toMatch(/\.png$/);
    expect(stored.storageKey).not.toMatch(/php/);
  });
});

/**
 * Serving a file must not cost a copy of it in memory: uploads run to tens of
 * megabytes, and a few people opening the media library at once would each pay
 * for a whole video.
 */
describe('opening a stored file', () => {
  let media: typeof import('../src/lib/media');

  beforeAll(async () => {
    media = await import('../src/lib/media');
  });

  it('returns the bytes and the size without reading it whole', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const stored = await media.storeFile({
      workspaceId: 'ws-stream',
      data: png,
      mimeType: 'image/png',
      originalName: 'photo.png',
    });

    const opened = await media.openStoredFile(stored.storageKey);
    expect(opened.size).toBe(png.byteLength);

    const chunks: Uint8Array[] = [];
    const reader = opened.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    expect(Buffer.concat(chunks).equals(png)).toBe(true);
  });

  it('refuses a key that climbs out of the media directory', async () => {
    // The key comes from the database, but the check is here regardless: this
    // is the function that turns a string into a file handle.
    await expect(media.openStoredFile('../../etc/passwd')).rejects.toThrow(/invalid media path/i);
  });

  it('reports a missing file rather than serving nothing', async () => {
    await expect(media.openStoredFile('ws-stream/not-here.png')).rejects.toThrow();
  });
});
