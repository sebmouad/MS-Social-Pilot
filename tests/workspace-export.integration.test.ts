import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Export everything (NEXT_PHASES G17): a ZIP that unzips, holds everything, and no secrets. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let exporter: typeof import('../src/lib/workspace-export');
let resolveStoragePath: typeof import('../src/lib/media')['resolveStoragePath'];
const mediaDir = mkdtempSync(path.join(tmpdir(), 'msp-export-'));

beforeAll(async () => {
  setTestEnv({ MEDIA_DIR: mediaDir });
  database = setupTestDatabase('workspace_export');
  ({ prisma } = await import('../src/lib/prisma'));
  exporter = await import('../src/lib/workspace-export');
  ({ resolveStoragePath } = await import('../src/lib/media'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
  rmSync(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.workspaceExport.deleteMany();
  await prisma.media.deleteMany();
  await prisma.postComment.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.queueSlot.deleteMany();
  await prisma.pageInsight.deleteMany();
  await prisma.target.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
  const user = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', passwordHash: 'x' } });
  const page = await prisma.target.create({
    data: { workspaceId: workspace.id, type: 'page', providerId: 'p1', name: 'Client A Page', accessToken: 'SECRET-PAGE-TOKEN' },
  });
  const post = await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      message: 'Product launch, today',
      status: 'published',
      targets: { create: [{ targetId: page.id, status: 'published', remoteUrl: 'https://facebook.com/1', insights: { impressions: 10 } }] },
    },
    include: { targets: true },
  });
  await prisma.postComment.create({
    data: { postTargetId: post.targets[0]!.id, remoteId: 'c1', message: 'Great news', fromName: 'A reader', createdTime: new Date() },
  });
  await prisma.queueSlot.create({ data: { workspaceId: workspace.id, dayOfWeek: 1, hour: 9, minute: 30 } });
  await prisma.pageInsight.create({ data: { targetId: page.id, metric: 'page_follows', period: 'day', endTime: new Date('2026-10-01'), value: 120, numeric: 120 } });
  const key = `${workspace.id}/photo.jpg`;
  mkdirSync(path.dirname(resolveStoragePath(key)), { recursive: true });
  writeFileSync(resolveStoragePath(key), Buffer.from('fake image bytes'), { flag: 'w' });
  await prisma.media.create({
    data: { workspaceId: workspace.id, filename: 'photo one.jpg', mimeType: 'image/jpeg', size: 16, kind: 'image', storageKey: key, url: '/x' },
  });
  return { workspace, user };
}

describe('workspace export', () => {
  it('builds a ZIP with posts, schedule, analytics, comments and media, and no tokens', async () => {
    const { workspace, user } = await seed();

    const first = await exporter.requestExport(workspace.id, user.id);
    const again = await exporter.requestExport(workspace.id, user.id);
    expect(again.id).toBe(first.id);

    expect(await exporter.runExports(new Date())).toContain('built');
    const entry = await prisma.workspaceExport.findUniqueOrThrow({ where: { id: first.id } });
    expect(entry).toMatchObject({ status: 'ready', skippedMedia: 0 });
    const zipPath = resolveStoragePath(entry.storageKey!);

    const listing = execFileSync('unzip', ['-l', zipPath]).toString();
    for (const name of ['README.txt', 'pages.json', 'posts.json', 'posts.csv', 'schedule.json', 'analytics/pages.csv', 'comments.json']) {
      expect(listing).toContain(name);
    }
    expect(listing).toMatch(/media\/\w+-photo_one\.jpg/);
    execFileSync('unzip', ['-tq', zipPath]);
    const everything = execFileSync('unzip', ['-p', zipPath]).toString();
    expect(everything).not.toContain('SECRET-PAGE-TOKEN');
    expect(everything).toContain('Product launch, today');
    expect(everything).toContain('Great news');
    expect(everything).toContain('page_follows');
    expect(everything).toContain('fake image bytes');

    // A week later it expires and the file goes.
    expect(await exporter.runExports(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).toContain('expired');
    expect((await prisma.workspaceExport.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('expired');
    expect(existsSync(zipPath)).toBe(false);
  });
});
