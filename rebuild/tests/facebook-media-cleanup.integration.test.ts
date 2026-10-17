import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  client: null as any,
  outcome: 'confirmed' as 'confirmed' | 'rejected' | 'uncertain',
  cleanupEnabled: true,
  callbackCalls: 0,
  prepareCalls: 0,
  failReceiptUpdate: false,
  failIntentAudit: false,
}));
vi.mock('../src/server/data', () => ({
  get prisma() {
    return {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => integration.client.$queryRaw(strings, ...values),
      $transaction: (work: (tx: any) => Promise<unknown>, options?: unknown) => integration.client.$transaction(async (tx: any) => {
        const wrapped = new Proxy(tx, {
          get(target, property) {
            if (property === '$executeRaw') return (strings: TemplateStringsArray, ...values: unknown[]) => {
              const sql = strings.join('');
              if (integration.failReceiptUpdate && sql.includes('UPDATE rebuild_facebook_media_deletions SET')) {
                integration.failReceiptUpdate = false;
                throw new Error('injected deletion receipt persistence failure');
              }
              if (integration.failIntentAudit && sql.includes('INSERT INTO root_activities')) {
                integration.failIntentAudit = false;
                throw new Error('injected pre-request audit failure');
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
    'publishing.transactionTimeoutMs': 5000,
    'publishing.transactionMaxWaitMs': 2000,
    'publishing.identifierMaxCharacters': 2048,
    'publishing.maxRemoteMediaPerPost': 10,
    'meta.mediaHistoryLimit': 100,
    'publishing.operationTimeoutMs': 30000,
    'publishing.operationMaxWaitMs': 5000,
    'data.workspaceOperationTimeoutMs': 60000,
    'meta.manualMediaCleanupEnabled': integration.cleanupEnabled,
  }[key]),
}));
vi.mock('../src/server/root/operations', () => ({ requireActiveRoot: async () => undefined }));
vi.mock('../src/server/root/publication-operation', () => ({
  withRootPublicationOperation: async (_userId: string, _scope: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => run({}, new AbortController().signal),
}));
vi.mock('../src/platforms/facebook/media-cleanup-transport', () => ({
  prepareFacebookMediaDeletion: async () => {
    integration.prepareCalls += 1;
    return async () => { integration.callbackCalls += 1; return integration.outcome; };
  },
}));

import { cleanupFacebookMedia } from '../src/platforms/facebook/media-cleanup';
import { assertFacebookMediaResolution, assertFacebookMediaSettled, facebookMediaJournal } from '../src/platforms/facebook/media-journal';

describe.skipIf(!databaseUrl)('Facebook staged-photo cleanup on isolated PostgreSQL', () => {
  let client: PrismaClient | undefined;
  const workspaceIds = new Set<string>();
  const actorByWorkspace = new Map<string, string>();
  beforeAll(() => {
    if (process.env.DATABASE_URL !== databaseUrl) throw new Error('Facebook media cleanup integration requires DATABASE_URL to exactly match the guarded preview URL.');
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Facebook media cleanup integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.client = client;
  });
  afterEach(async () => {
    if (!client) return;
    for (const workspaceId of workspaceIds) {
      await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
      await client.$executeRaw`DELETE FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${workspaceId}`;
      await client.$executeRaw`DELETE FROM rebuild_facebook_media_steps WHERE "workspaceId"=${workspaceId}`;
      await client.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
      await client.$executeRaw`DELETE FROM targets WHERE "workspaceId"=${workspaceId}`;
      await client.$executeRaw`DELETE FROM workspaces WHERE id=${workspaceId}`;
      const actorId = actorByWorkspace.get(workspaceId);
      if (actorId) await client.$executeRaw`DELETE FROM users WHERE id=${actorId}`;
    }
    workspaceIds.clear();
    actorByWorkspace.clear();
    integration.outcome = 'confirmed'; integration.cleanupEnabled = true; integration.callbackCalls = 0; integration.prepareCalls = 0;
    integration.failReceiptUpdate = false; integration.failIntentAudit = false;
  });
  afterAll(async () => { integration.client = client; await client?.$disconnect(); });

  async function fixture(options: { photoCount?: number; feedState?: string; parentState?: string; parentRemotePostId?: string } = {}) {
    if (!client) throw new Error('Guarded preview client was not initialized.');
    const suffix = randomUUID().replaceAll('-', '');
    const workspaceId = `preview_fb_cleanup_${suffix}`;
    const targetId = `fb_target_${suffix}`;
    const remoteTargetId = `remote_page_${suffix}`;
    const operationId = randomUUID();
    const postId = `post_${suffix}`;
    const postTargetId = `post_target_${suffix}`;
    const actorId = `root_actor_${suffix}`;
    workspaceIds.add(workspaceId);
    actorByWorkspace.set(workspaceId, actorId);
    await client.user.create({ data: { id: actorId, email: `${actorId}@example.test`, name: 'Synthetic Root actor', passwordHash: 'synthetic-test-only', isInstanceOwner: true } });
    await client.workspace.create({ data: { id: workspaceId, name: 'Synthetic Facebook cleanup fixture', slug: workspaceId, timezone: 'UTC' } });
    await client.target.create({ data: { id: targetId, workspaceId, type: 'page', providerId: remoteTargetId, name: 'Synthetic Page', enabled: true, canPublish: true, createdAt: new Date() } });
    const state = options.parentState ?? 'started';
    const parentReason = state === 'uncertain' ? 'outcome_unknown' : state === 'receipt_recorded' ? 'provider_receipt' : null;
    await client.$executeRaw`INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "receiptAt")
      VALUES (${operationId}, ${workspaceId}, ${postId}, ${postTargetId}, ${targetId}, 'facebook', ${actorId}, ${state},
        ${parentReason}, ${options.parentRemotePostId ?? null}, CASE WHEN ${state}='receipt_recorded' THEN CURRENT_TIMESTAMP ELSE NULL END)`;
    const photoIds: string[] = [];
    for (let ordinal = 1; ordinal <= (options.photoCount ?? 1); ordinal += 1) {
      const id = randomUUID(); photoIds.push(id);
      await client.$executeRaw`INSERT INTO rebuild_facebook_media_steps
        (id, "workspaceId", "operationId", "postId", "postTargetId", "targetId", "actorId", "remoteTargetId", phase, ordinal, state, "remoteId", "receiptAt")
        VALUES (${id}, ${workspaceId}, ${operationId}, ${postId}, ${postTargetId}, ${targetId}, ${actorId}, ${remoteTargetId}, 'photo', ${ordinal}, 'recorded', ${`remote_photo_${ordinal}_${suffix}`}, CURRENT_TIMESTAMP)`;
    }
    if (options.feedState) await client.$executeRaw`INSERT INTO rebuild_facebook_media_steps
      (id, "workspaceId", "operationId", "postId", "postTargetId", "targetId", "actorId", "remoteTargetId", phase, ordinal, state, "remoteId", "receiptAt", "rejectedAt")
      VALUES (${randomUUID()}, ${workspaceId}, ${operationId}, ${postId}, ${postTargetId}, ${targetId}, ${actorId}, ${remoteTargetId}, 'feed', 0, ${options.feedState},
        ${options.feedState === 'recorded' ? 'known_feed' : null}, CASE WHEN ${options.feedState}='recorded' THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN ${options.feedState}='rejected' THEN CURRENT_TIMESTAMP ELSE NULL END)`;
    return { workspaceId, targetId, remoteTargetId, operationId, postId, postTargetId, photoIds, actorId };
  }
  const action = (stepId: string) => ({ actionId: 'delete_staged_photo', subjectId: stepId, confirmation: `DELETE STAGED PHOTO ${stepId}`, acknowledged: true as const });

  it('commits deletion before the callback, freezes a late feed, and makes confirmed replay idempotent', async () => {
    const f = await fixture({ photoCount: 2 });
    const first = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(first).toMatchObject({ ok: true, state: 'confirmed' });
    expect(integration.callbackCalls).toBe(1);
    const parent = await client!.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE id=${f.operationId}`;
    expect(parent[0].state).toBe('uncertain');
    const photo = await client!.$queryRaw<Array<{ remoteId: string }>>`SELECT "remoteId" FROM rebuild_facebook_media_steps WHERE id=${f.photoIds[0]}`;
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).resolves.toMatchObject({ ok: true, state: 'confirmed', operationId: first.operationId });
    expect(integration.callbackCalls).toBe(1);
    await expect(facebookMediaJournal(f.operationId, f.remoteTargetId).beginFeed(['remote_photo_1', 'remote_photo_2']))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(photo[0].remoteId).toContain('remote_photo_1_');
  });

  it('refuses cleanup when any feed intent exists, including a held or recorded feed', async () => {
    const started = await fixture({ feedState: 'started' });
    await expect(cleanupFacebookMedia(started.actorId, action(started.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    const recorded = await fixture({ feedState: 'recorded' });
    await expect(cleanupFacebookMedia(recorded.actorId, action(recorded.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(0);
  });

  it('allows an explicitly rejected feed cleanup and then resolves ABSENT only after confirmed deletion', async () => {
    const f = await fixture({ feedState: 'rejected' });
    const result = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(result.state).toBe('confirmed');
    await expect(assertFacebookMediaResolution(client! as never, f.workspaceId, f.operationId, 'ABSENT')).resolves.toBeUndefined();
    await expect(assertFacebookMediaSettled(client! as never, f.workspaceId)).resolves.toBeUndefined();
  });

  it('permits a new explicit attempt after a definite delete rejection', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.outcome = 'rejected';
    const rejected = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(rejected.state).toBe('rejected');
    integration.outcome = 'confirmed';
    const confirmed = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.operationId).not.toBe(rejected.operationId);
    expect(integration.callbackCalls).toBe(2);
  });

  it('serializes concurrent requests against the same photo intent', async () => {
    const f = await fixture({ feedState: 'rejected' });
    const results = await Promise.allSettled([
      cleanupFacebookMedia(f.actorId, action(f.photoIds[0])),
      cleanupFacebookMedia(f.actorId, action(f.photoIds[0])),
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof cleanupFacebookMedia>>> => result.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const operationIds = results.flatMap(result => result.status === 'fulfilled' ? [result.value.operationId] : []);
    expect(new Set(operationIds).size).toBe(1);
    expect(integration.callbackCalls).toBe(1);
    const rows = await client!.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${f.workspaceId} AND state <> 'rejected'`;
    expect(Number(rows[0].count)).toBe(1);
  });

  it('keeps uncertain deletion and receipt-write faults held without redispatch', async () => {
    const f = await fixture();
    integration.outcome = 'uncertain';
    const unknown = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(unknown.state).toBe('needs_review');
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(1);

    const receiptFault = await fixture();
    integration.outcome = 'confirmed'; integration.failReceiptUpdate = true;
    const held = await cleanupFacebookMedia(receiptFault.actorId, action(receiptFault.photoIds[0]));
    expect(held.state).toBe('needs_review');
    await expect(assertFacebookMediaSettled(client! as never, receiptFault.workspaceId)).rejects.toMatchObject({ code: 'conflict' });
    await expect(cleanupFacebookMedia(receiptFault.actorId, action(receiptFault.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(2);
  });

  it('does not contact Facebook if the pre-request intent audit cannot commit', async () => {
    const f = await fixture();
    integration.failIntentAudit = true;
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).rejects.toThrow('injected pre-request audit failure');
    expect(integration.callbackCalls).toBe(0);
    const rows = await client!.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_facebook_media_deletions WHERE "workspaceId"=${f.workspaceId}`;
    expect(Number(rows[0].count)).toBe(0);
  });

  it('refuses cleanup when the parent already has a known publication receipt', async () => {
    const f = await fixture({ parentState: 'receipt_recorded', parentRemotePostId: 'known-post' });
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(0);
  });

  it('rejects tampered step bindings before creating deletion intent or calling transport', async () => {
    const photoMismatch = await fixture();
    await client!.$executeRaw`UPDATE rebuild_facebook_media_steps SET "postId"='tampered-post', "updatedAt"=CURRENT_TIMESTAMP WHERE id=${photoMismatch.photoIds[0]}`;
    await expect(cleanupFacebookMedia(photoMismatch.actorId, action(photoMismatch.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });

    const feedMismatch = await fixture({ feedState: 'rejected' });
    await client!.$executeRaw`UPDATE rebuild_facebook_media_steps SET "actorId"='tampered-actor', "updatedAt"=CURRENT_TIMESTAMP
      WHERE "workspaceId"=${feedMismatch.workspaceId} AND "operationId"=${feedMismatch.operationId} AND phase='feed'`;
    await expect(cleanupFacebookMedia(feedMismatch.actorId, action(feedMismatch.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });

    const hiddenFeed = await fixture({ feedState: 'started' });
    await client!.$executeRaw`UPDATE rebuild_facebook_media_steps SET "targetId"='tampered-target', "updatedAt"=CURRENT_TIMESTAMP
      WHERE "workspaceId"=${hiddenFeed.workspaceId} AND "operationId"=${hiddenFeed.operationId} AND phase='feed'`;
    await expect(cleanupFacebookMedia(hiddenFeed.actorId, action(hiddenFeed.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.prepareCalls).toBe(0);
    expect(integration.callbackCalls).toBe(0);
    const rows = await client!.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_facebook_media_deletions WHERE "workspaceId" IN (${photoMismatch.workspaceId}, ${feedMismatch.workspaceId}, ${hiddenFeed.workspaceId})`;
    expect(Number(rows[0].count)).toBe(0);
  });

  it('honors the disabled manual-cleanup policy before any remote preparation', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.cleanupEnabled = false;
    const { readFacebookMediaEvidence } = await import('../src/platforms/facebook/media-journal');
    expect((await readFacebookMediaEvidence(f.operationId)).actions).toEqual([]);
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).rejects.toMatchObject({ code: 'forbidden' });
    expect(integration.prepareCalls).toBe(0);
    expect(integration.callbackCalls).toBe(0);
  });

  it('keeps a known feed receipt non-ABSENT even after a staged photo is deleted', async () => {
    const f = await fixture({ photoCount: 2, feedState: 'recorded', parentState: 'uncertain' });
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaResolution(client! as never, f.workspaceId, f.operationId, 'ABSENT')).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(0);
  });

  it('enforces NULL-safe state/receipt constraints in PostgreSQL', async () => {
    const f = await fixture();
    await expect(client!.$executeRaw`INSERT INTO rebuild_facebook_media_deletions
      (id, "workspaceId", "mediaStepId", "operationId", "postId", "postTargetId", "targetId", "remoteTargetId", "remotePhotoId", "actorId", state, "receiptAt")
      VALUES (${randomUUID()}, ${f.workspaceId}, ${f.photoIds[0]}, ${f.operationId}, ${f.postId}, ${f.postTargetId}, ${f.targetId}, ${f.remoteTargetId}, 'remote-photo', ${f.actorId}, 'confirmed', NULL)`)
      .rejects.toThrow();
  });

  it('evidence lists cleanup state and offers exact actions only for eligible known photos', async () => {
    const f = await fixture({ photoCount: 2, feedState: 'rejected', parentState: 'uncertain' });
    const { readFacebookMediaEvidence } = await import('../src/platforms/facebook/media-journal');
    const evidence = await readFacebookMediaEvidence(f.operationId, 10);
    expect(evidence.rowIdKey).toBe('id');
    expect(evidence.columns.map(column => column.key)).toContain('cleanupState');
    expect(evidence.actions).toHaveLength(2);
    expect(evidence.actions?.[0]).toMatchObject({ actionId: 'delete_staged_photo', confirmation: `DELETE STAGED PHOTO ${f.photoIds[0]}` });
    expect(JSON.stringify(evidence)).not.toMatch(/accessToken|imageUrl|rawError|postText/i);
  });
});
