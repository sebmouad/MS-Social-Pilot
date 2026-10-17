import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
import { createFacebookEngine, FacebookMediaRecoveryError } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({ client: null as any, failNextUpdate: false }));
vi.mock('../src/server/data', () => ({
  get prisma() {
    return {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => integration.client.$queryRaw(strings, ...values),
      $transaction: (work: (tx: any) => Promise<unknown>, options?: unknown) => integration.client.$transaction(async (tx: any) => {
        const wrapped = new Proxy(tx, {
          get(target, property) {
            if (property === '$executeRaw') return (strings: TemplateStringsArray, ...values: unknown[]) => {
              if (integration.failNextUpdate && strings.join('').includes('UPDATE rebuild_facebook_media_steps')) {
                integration.failNextUpdate = false;
                throw new Error('injected media receipt persistence failure');
              }
              return target.$executeRaw(strings, ...values);
            };
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return work(wrapped);
      }, options),
    };
  },
}));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.maxRemoteMediaPerPost': 10,
    'publishing.transactionTimeoutMs': 5000,
    'publishing.transactionMaxWaitMs': 2000,
    'meta.mediaHistoryLimit': 100,
    'meta.manualMediaCleanupEnabled': false,
  }[key]),
}));

import { assertFacebookMediaResolution, assertFacebookMediaSettled, facebookMediaJournal, readFacebookMediaEvidence } from '../src/platforms/facebook/media-journal';

const facebookConfig: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg', 'image/png'], appSecretProofEnabled: false,
};

describe.skipIf(!databaseUrl)('Facebook durable media steps on isolated PostgreSQL', () => {
  let client: PrismaClient | undefined;
  const workspaceIds = new Set<string>();

  beforeAll(() => {
    if (process.env.DATABASE_URL !== databaseUrl) throw new Error('Facebook media journal integration requires DATABASE_URL to exactly match the guarded preview URL.');
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Facebook media journal integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.client = client;
  });

  afterEach(async () => {
    if (!client) return;
    for (const workspaceId of workspaceIds) {
      await client.$executeRaw`DELETE FROM rebuild_facebook_media_steps WHERE "workspaceId" = ${workspaceId}`;
      await client.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId" = ${workspaceId}`;
      await client.$executeRaw`DELETE FROM targets WHERE "workspaceId" = ${workspaceId}`;
      await client.$executeRaw`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    }
    workspaceIds.clear();
    integration.failNextUpdate = false;
  });

  afterAll(async () => { integration.client = client; await client?.$disconnect(); });

  async function createFixture() {
    if (!client) throw new Error('Guarded preview client was not initialized.');
    const suffix = randomUUID().replaceAll('-', '');
    const workspaceId = `preview_fb_media_${suffix}`;
    const targetId = `fb_target_${suffix}`;
    const remoteTargetId = `remote_page_${suffix}`;
    const operationId = randomUUID();
    workspaceIds.add(workspaceId);
    await client.workspace.create({ data: { id: workspaceId, name: 'Synthetic Facebook media journal fixture', slug: workspaceId, timezone: 'UTC' } });
    await client.target.create({ data: { id: targetId, workspaceId, type: 'page', providerId: remoteTargetId, name: 'Synthetic Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await client.$executeRaw`INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state)
      VALUES (${operationId}, ${workspaceId}, ${`post_${suffix}`}, ${`post_target_${suffix}`}, ${targetId}, 'facebook', ${`actor_${suffix}`}, 'started')`;
    return { workspaceId, targetId, remoteTargetId, operationId };
  }

  async function rows(workspaceId: string, operationId: string) {
    return client!.$queryRaw<Array<{ phase: string; ordinal: number; state: string; remoteId: string | null }>>`
      SELECT "phase", "ordinal", "state", "remoteId" FROM rebuild_facebook_media_steps
      WHERE "workspaceId" = ${workspaceId} AND "operationId" = ${operationId} ORDER BY "phase", "ordinal"`;
  }

  it('commits each ordered photo receipt before feed intent and keeps exact feed receipt evidence', async () => {
    const fixture = await createFixture();
    const journal = facebookMediaJournal(fixture.operationId, fixture.remoteTargetId);
    await journal.beginPhoto(1);
    await journal.recordPhoto(1, 'photo-one');
    await journal.beginPhoto(2);
    await journal.recordPhoto(2, 'photo-two');
    await journal.beginFeed(['photo-one', 'photo-two']);

    await expect(journal.beginPhoto(3)).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.beginFeed(['photo-two', 'photo-one'])).rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaResolution(client! as never, fixture.workspaceId, fixture.operationId, 'PUBLISHED', 'feed-one'))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaSettled(client! as never, fixture.workspaceId)).rejects.toMatchObject({ code: 'conflict' });

    await journal.recordFeed('feed-one');
    await expect(assertFacebookMediaResolution(client! as never, fixture.workspaceId, fixture.operationId, 'PUBLISHED', 'other-feed'))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaResolution(client! as never, fixture.workspaceId, fixture.operationId, 'PUBLISHED', 'feed-one')).resolves.toBeUndefined();
    await expect(assertFacebookMediaSettled(client! as never, fixture.workspaceId)).resolves.toBeUndefined();
    expect(await rows(fixture.workspaceId, fixture.operationId)).toEqual([
      { phase: 'feed', ordinal: 0, state: 'recorded', remoteId: 'feed-one' },
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-one' },
      { phase: 'photo', ordinal: 2, state: 'recorded', remoteId: 'photo-two' },
    ]);
  });

  it('runs the real Facebook engine through independently committed photo and feed steps', async () => {
    const fixture = await createFixture();
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      if (url.pathname.endsWith('/photos')) return new Response(JSON.stringify({ id: `photo-${requests.length}` }), { status: 200 });
      return new Response(JSON.stringify({ id: 'page-feed' }), { status: 200 });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(facebookConfig, fetcher, undefined, facebookMediaJournal);
    await expect(engine.publish({
      operationId: fixture.operationId,
      targetId: fixture.remoteTargetId,
      accessToken: 'synthetic-page-token',
      text: 'Synthetic album',
      media: [
        { kind: 'image', url: 'https://cdn.example.test/one.jpg' },
        { kind: 'image', url: 'https://cdn.example.test/two.jpg' },
      ],
    })).resolves.toEqual({ remoteId: 'page-feed', url: null });
    expect(requests).toHaveLength(3);
    expect((await rows(fixture.workspaceId, fixture.operationId)).map(row => [row.phase, row.ordinal, row.state, row.remoteId])).toEqual([
      ['feed', 0, 'recorded', 'page-feed'], ['photo', 1, 'recorded', 'photo-1'], ['photo', 2, 'recorded', 'photo-2'],
    ]);
  });

  it('holds an intent after a receipt-write fault and refuses replay or later upload', async () => {
    const fixture = await createFixture();
    const journal = facebookMediaJournal(fixture.operationId, fixture.remoteTargetId);
    await journal.beginPhoto(1);
    integration.failNextUpdate = true;
    await expect(journal.recordPhoto(1, 'photo-one')).rejects.toThrow('injected media receipt persistence failure');
    await expect(journal.beginPhoto(1)).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.beginPhoto(2)).rejects.toMatchObject({ code: 'conflict' });
    expect(await rows(fixture.workspaceId, fixture.operationId)).toEqual([
      expect.objectContaining({ phase: 'photo', ordinal: 1, state: 'started', remoteId: null }),
    ]);
  });

  it('keeps the feed step started when its receipt write fails after provider acceptance', async () => {
    const fixture = await createFixture();
    const journal = facebookMediaJournal(fixture.operationId, fixture.remoteTargetId);
    await journal.beginPhoto(1);
    await journal.recordPhoto(1, 'photo-one');
    await journal.beginPhoto(2);
    await journal.recordPhoto(2, 'photo-two');
    await journal.beginFeed(['photo-one', 'photo-two']);
    integration.failNextUpdate = true;
    await expect(journal.recordFeed('accepted-feed')).rejects.toThrow('injected media receipt persistence failure');
    expect(await rows(fixture.workspaceId, fixture.operationId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'feed', state: 'started', remoteId: null }),
    ]));
    await expect(assertFacebookMediaResolution(client! as never, fixture.workspaceId, fixture.operationId, 'PUBLISHED', 'accepted-feed'))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaSettled(client! as never, fixture.workspaceId)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a duplicate known photo ID and keeps unknown feed outcomes held', async () => {
    const fixture = await createFixture();
    const journal = facebookMediaJournal(fixture.operationId, fixture.remoteTargetId);
    await journal.beginPhoto(1);
    await journal.recordPhoto(1, 'same-photo');
    await journal.beginPhoto(2);
    await expect(journal.recordPhoto(2, 'same-photo')).rejects.toMatchObject({ code: 'conflict' });
    expect(await rows(fixture.workspaceId, fixture.operationId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ordinal: 2, state: 'started', remoteId: null }),
    ]));

    const fresh = await createFixture();
    const second = facebookMediaJournal(fresh.operationId, fresh.remoteTargetId);
    await second.beginPhoto(1);
    await second.recordPhoto(1, 'fresh-one');
    await second.beginPhoto(2);
    await second.recordPhoto(2, 'fresh-two');
    await second.beginFeed(['fresh-one', 'fresh-two']);
    await expect(assertFacebookMediaResolution(client! as never, fresh.workspaceId, fresh.operationId, 'PUBLISHED', 'feed-unknown'))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaSettled(client! as never, fresh.workspaceId)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('records provider-declared rejection without a receipt and exposes bounded content-free evidence', async () => {
    const fixture = await createFixture();
    const journal = facebookMediaJournal(fixture.operationId, fixture.remoteTargetId);
    await journal.beginPhoto(1);
    await journal.rejectPhoto(1);
    await journal.beginFeed(['other-one', 'other-two']).catch(() => undefined);

    const evidence = await readFacebookMediaEvidence(fixture.operationId);
    expect(evidence.items).toEqual([expect.objectContaining({
      operationId: fixture.operationId, workspaceId: fixture.workspaceId, targetId: fixture.targetId,
      phase: 'photo', ordinal: 1, state: 'rejected', remoteId: null,
    })]);
    expect(JSON.stringify(evidence)).not.toMatch(/accessToken|message|url|bytes|rawError/i);
    await expect(assertFacebookMediaResolution(client! as never, fixture.workspaceId, fixture.operationId, 'ABSENT')).resolves.toBeUndefined();
  });
});
