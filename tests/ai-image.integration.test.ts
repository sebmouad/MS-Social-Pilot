import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let image: typeof import('../src/lib/ai-image');
let settings: typeof import('../src/lib/settings');

const requests: Array<{ url: string; body?: unknown }> = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+XJ/PPQAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  setTestEnv({ OPENAI_API_KEY: 'sk-test' });
  database = setupTestDatabase('aiimage');
  ({ prisma } = await import('../src/lib/prisma'));
  image = await import('../src/lib/ai-image');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
      if (String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-4o', created: 5 }, { id: 'old-image-model', created: 10 }, { id: 'new-image-model', created: 20 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 });
    }),
  );
  await prisma.aiGeneration.deleteMany();
  await prisma.media.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await settings.ensureSettings();
});

describe('pictures from a description', () => {
  it('uses the newest image model the key lists, stores the picture in the library, and records it', async () => {
    expect(image.imageAvailable()).toBe(true);
    const user = await prisma.user.create({ data: { email: `im-${randomBytes(3).toString('hex')}@example.test`, name: 'Sam', passwordHash: 'x' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Client', slug: `c-${randomBytes(3).toString('hex')}`, timezone: 'UTC' } });

    const made = await image.generateImage({ workspaceId: workspace.id, userId: user.id, prompt: 'A loaf of bread', size: 'landscape' });
    const call = requests.find((entry) => entry.url.endsWith('/images/generations'));
    expect(call?.body).toMatchObject({ model: 'new-image-model', prompt: 'A loaf of bread', size: '1536x1024' });

    const media = await prisma.media.findUniqueOrThrow({ where: { id: made.id } });
    expect([media.workspaceId, media.mimeType, media.url]).toEqual([workspace.id, 'image/png', `/api/media/${media.id}/raw`]);
    const logged = await prisma.aiGeneration.findFirstOrThrow();
    expect([logged.kind, logged.provider, logged.model]).toEqual(['image', 'openai', 'new-image-model']);
  });
});
