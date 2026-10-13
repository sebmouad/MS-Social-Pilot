import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let video: typeof import('../src/lib/ai-video');
let settings: typeof import('../src/lib/settings');

const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
let operation: Record<string, unknown> = { done: false };
// A box length, "ftyp", the brand: what an MP4 starts with.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom', 'ascii'), Buffer.alloc(32)]);

beforeAll(async () => {
  setTestEnv({ GEMINI_API_KEY: 'g-test' });
  database = setupTestDatabase('aivideo');
  ({ prisma } = await import('../src/lib/prisma'));
  video = await import('../src/lib/ai-video');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  requests.length = 0;
  operation = { done: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const address = String(url);
      requests.push({ url: address, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
      if (address.includes('/models?')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/veo-3.0-generate-001', supportedGenerationMethods: ['predictLongRunning'] },
              { name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
              { name: 'models/veo-3.1-fast-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
            ],
          }),
          { status: 200 },
        );
      }
      if (address.endsWith(':predictLongRunning')) return new Response(JSON.stringify({ name: 'models/veo/operations/op-1' }), { status: 200 });
      if (address.includes('/operations/')) return new Response(JSON.stringify(operation), { status: 200 });
      return new Response(MP4, { status: 200 });
    }),
  );
  await prisma.aiVideo.deleteMany();
  await prisma.aiGeneration.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await settings.ensureSettings();
});

async function seed() {
  const user = await prisma.user.create({ data: { email: `v-${randomBytes(3).toString('hex')}@example.test`, name: 'Sam', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({ data: { name: 'Client', slug: `c-${randomBytes(3).toString('hex')}`, timezone: 'UTC' } });
  return { user, workspace };
}

describe('videos from a description', () => {
  it('starts one on the newest full-size model the key lists, then keeps the finished file in the library', async () => {
    expect(video.videoAvailable()).toBe(true);
    const { user, workspace } = await seed();

    const started = await video.startVideo({ workspaceId: workspace.id, userId: user.id, prompt: 'Bread at dawn', aspectRatio: '9:16' });
    const call = requests.find((entry) => entry.url.endsWith(':predictLongRunning'));
    expect(call?.url).toContain('/models/veo-3.1-generate-preview:');
    expect(call?.body).toEqual({ instances: [{ prompt: 'Bread at dawn' }], parameters: { aspectRatio: '9:16' } });
    expect(started.status).toBe('working');

    // Not done yet: nothing changes.
    expect(await video.pollVideos()).toBe(0);
    expect((await prisma.aiVideo.findUniqueOrThrow({ where: { id: started.id } })).status).toBe('working');

    operation = { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.example/v.mp4' } }] } } };
    expect(await video.pollVideos()).toBe(1);
    const done = await prisma.aiVideo.findUniqueOrThrow({ where: { id: started.id } });
    expect(done.status).toBe('ready');
    const media = await prisma.media.findUniqueOrThrow({ where: { id: done.mediaId! } });
    expect([media.workspaceId, media.mimeType]).toEqual([workspace.id, 'video/mp4']);
    expect((await prisma.aiGeneration.findFirstOrThrow()).kind).toBe('video');
  });

  it('says why a video failed, and gives up on one that takes too long', async () => {
    const { user, workspace } = await seed();
    const refused = await video.startVideo({ workspaceId: workspace.id, userId: user.id, prompt: 'Something refused', aspectRatio: '16:9' });
    operation = { done: true, error: { message: 'Blocked by safety rules' } };
    await video.pollVideos();
    expect(await prisma.aiVideo.findUniqueOrThrow({ where: { id: refused.id } })).toMatchObject({ status: 'failed', error: 'Blocked by safety rules' });

    operation = { done: false };
    const slow = await video.startVideo({ workspaceId: workspace.id, userId: user.id, prompt: 'Something slow', aspectRatio: '16:9' });
    await video.pollVideos(new Date(Date.now() + 31 * 60 * 1000));
    expect((await prisma.aiVideo.findUniqueOrThrow({ where: { id: slow.id } })).status).toBe('failed');
  });
});
