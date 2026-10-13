import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * AI translation: a translated post becomes one post per
 * language, each to its own Pages, plus one in the original for the rest.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let createTranslated: typeof import('../src/lib/translated-posts')['createTranslated'];
let createPostSchema: typeof import('../src/lib/validation')['createPostSchema'];
let encryptSecret: typeof import('../src/lib/crypto')['encryptSecret'];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('translated_posts');
  ({ prisma } = await import('../src/lib/prisma'));
  ({ createTranslated } = await import('../src/lib/translated-posts'));
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
  await prisma.target.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

describe('createTranslated', () => {
  it('makes one post per language and one in the original', async () => {
    const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
    const user = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.test`, name: 'Owner', passwordHash: 'x' } });
    const pages = [];
    for (let index = 0; index < 3; index++) {
      pages.push(
        await prisma.target.create({
          data: { workspaceId: workspace.id, type: 'page', providerId: `page-${index}`, name: `Page ${index + 1}`, accessToken: encryptSecret('token') },
        }),
      );
    }
    const [p1, p2, p3] = pages.map((page) => page.id) as [string, string, string];
    const input = createPostSchema.parse({
      message: 'Product launch',
      targetIds: [p1, p2, p3],
      scheduledAtLocal: '2026-11-10T10:00',
      timezone: 'UTC',
      translations: [{ targetIds: [p2, p3], message: 'Lanzamiento' }],
    });

    const result = await createTranslated(
      { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.owner, requiresApproval: false },
      input,
      new Date('2026-11-02T09:00:00Z'),
    );

    expect(result.posts).toBe(2);
    const posts = await prisma.post.findMany({ include: { targets: true }, orderBy: { message: 'asc' } });
    expect(posts.map((post) => [post.message, post.targets.map((target) => target.targetId).sort()])).toEqual([
      ['Lanzamiento', [p2, p3].sort()],
      ['Product launch', [p1]],
    ]);
    expect(new Set(posts.map((post) => post.scheduledAt?.toISOString()))).toEqual(new Set(['2026-11-10T10:00:00.000Z']));
  });
});
