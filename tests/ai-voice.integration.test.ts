import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let voice: typeof import('../src/lib/ai-voice');
let settings: typeof import('../src/lib/settings');
const requests: Array<{ url: string; body?: unknown }> = [];

beforeAll(async () => {
  setTestEnv({ OPENAI_API_KEY: 'sk-test' });
  database = setupTestDatabase('aivoice');
  ({ prisma } = await import('../src/lib/prisma'));
  voice = await import('../src/lib/ai-voice');
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
        return new Response(JSON.stringify({ data: [{ id: 'gpt-4o', created: 5 }, { id: 'tts-1', created: 10 }, { id: 'gpt-4o-mini-tts', created: 30 }] }), { status: 200 });
      }
      return new Response(Buffer.from('ID3-audio'), { status: 200 });
    }),
  );
  await prisma.aiGeneration.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  await settings.ensureSettings();
});

describe('voice from a text', () => {
  it('uses the newest speech model the key lists and returns the audio', async () => {
    expect(voice.voiceAvailable()).toBe(true);
    const user = await prisma.user.create({ data: { email: `vo-${randomBytes(3).toString('hex')}@example.test`, name: 'Sam', passwordHash: 'x' } });
    const workspace = await prisma.workspace.create({ data: { name: 'Client', slug: `c-${randomBytes(3).toString('hex')}`, timezone: 'UTC' } });

    const audio = await voice.speak({ workspaceId: workspace.id, userId: user.id, text: 'Fresh bread today', voice: 'marin' });
    expect(audio.toString()).toBe('ID3-audio');
    expect(requests.find((entry) => entry.url.endsWith('/audio/speech'))?.body).toMatchObject({ model: 'gpt-4o-mini-tts', input: 'Fresh bread today', voice: 'marin' });
    expect((await prisma.aiGeneration.findFirstOrThrow()).kind).toBe('voice');
  });
});
