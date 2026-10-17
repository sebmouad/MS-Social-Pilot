import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  client: null as any,
  outcome: 'confirmed' as 'confirmed' | 'rejected' | 'uncertain',
  cleanupEnabled: true,
  attestationEnabled: false,
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
    'meta.manualMediaAttestationEnabled': integration.attestationEnabled,
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
import { resolveFacebookMedia } from '../src/platforms/facebook/media-resolution';
import { recordFacebookMediaDeletionOutcome } from '../src/platforms/facebook/media-resolution-store';
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
      await client.$executeRaw`DELETE FROM post_targets WHERE "postId" IN (SELECT id FROM posts WHERE "workspaceId"=${workspaceId})`;
      await client.$executeRaw`DELETE FROM posts WHERE "workspaceId"=${workspaceId}`;
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
    integration.outcome = 'confirmed'; integration.cleanupEnabled = true; integration.attestationEnabled = false; integration.callbackCalls = 0; integration.prepareCalls = 0;
    integration.failReceiptUpdate = false; integration.failIntentAudit = false;
  });
  afterAll(async () => { integration.client = client; await client?.$disconnect(); });

  async function fixture(options: { photoCount?: number; photoState?: 'recorded' | 'started'; feedState?: string; parentState?: string; parentRemotePostId?: string; projectedRemotePostId?: string } = {}) {
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
    if (options.projectedRemotePostId) await client.post.create({ data: {
      id: postId, workspaceId, authorId: actorId, message: 'Synthetic projection fixture', status: 'draft', createdAt: new Date(), updatedAt: new Date(),
      targets: { create: { id: postTargetId, targetId, status: 'pending', remotePostId: options.projectedRemotePostId, updatedAt: new Date() } },
    } });
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
        VALUES (${id}, ${workspaceId}, ${operationId}, ${postId}, ${postTargetId}, ${targetId}, ${actorId}, ${remoteTargetId}, 'photo', ${ordinal}, ${options.photoState ?? 'recorded'}, ${options.photoState === 'started' ? null : `remote_photo_${ordinal}_${suffix}`}, CASE WHEN ${options.photoState ?? 'recorded'}='recorded' THEN CURRENT_TIMESTAMP ELSE NULL END)`;
    }
    const feedId = options.feedState ? randomUUID() : null;
    if (options.feedState) await client.$executeRaw`INSERT INTO rebuild_facebook_media_steps
      (id, "workspaceId", "operationId", "postId", "postTargetId", "targetId", "actorId", "remoteTargetId", phase, ordinal, state, "remoteId", "receiptAt", "rejectedAt")
      VALUES (${feedId}, ${workspaceId}, ${operationId}, ${postId}, ${postTargetId}, ${targetId}, ${actorId}, ${remoteTargetId}, 'feed', 0, ${options.feedState},
        ${options.feedState === 'recorded' ? 'known_feed' : null}, CASE WHEN ${options.feedState}='recorded' THEN CURRENT_TIMESTAMP ELSE NULL END,
        CASE WHEN ${options.feedState}='rejected' THEN CURRENT_TIMESTAMP ELSE NULL END)`;
    return { workspaceId, targetId, remoteTargetId, operationId, postId, postTargetId, photoIds, feedId, actorId };
  }
  const action = (stepId: string) => ({ actionId: 'delete_staged_photo', subjectId: stepId, confirmation: `DELETE STAGED PHOTO ${stepId}`, acknowledged: true as const });
  const attest = (actionId: string, id: string, remoteId?: string) => ({ actionId, subjectId: id,
    confirmation: actionId === 'record_photo_present' ? `ATTEST FACEBOOK PHOTO ${id} PRESENT`
      : actionId === 'record_feed_present' ? `ATTEST FACEBOOK FEED ${id} PRESENT`
        : actionId === 'record_photo_deleted' ? `ATTEST FACEBOOK DELETE ${id} DELETED`
          : actionId === 'record_photo_still_present' ? `ATTEST FACEBOOK DELETE ${id} STILL PRESENT`
            : `ATTEST FACEBOOK STEP ${id} ABSENT`, acknowledged: true as const,
    ...(remoteId ? { fieldValues: { remoteId } } : {}) });

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

  it('keeps cleanup blocked after a human feed-absent report while allowing the no-feed parent-absent case', async () => {
    const feedAbsent = await fixture({ feedState: 'started' });
    integration.attestationEnabled = true;
    await resolveFacebookMedia(feedAbsent.actorId, attest('record_step_absent', feedAbsent.feedId!));
    const { readFacebookMediaEvidence } = await import('../src/platforms/facebook/media-journal');
    const evidence = await readFacebookMediaEvidence(feedAbsent.operationId, 10);
    expect(evidence.actions?.some(item => item.actionId === 'delete_staged_photo')).toBe(false);
    await expect(cleanupFacebookMedia(feedAbsent.actorId, action(feedAbsent.photoIds[0])))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(0);

    const parentAbsentWithoutFeed = await fixture();
    await client!.$executeRaw`UPDATE rebuild_publication_attempts SET state='attested_absent', reason='external_human_attestation',
      "attestedAt"=CURRENT_TIMESTAMP, "attestedBy"=${parentAbsentWithoutFeed.actorId}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${parentAbsentWithoutFeed.operationId}`;
    const noFeedEvidence = await readFacebookMediaEvidence(parentAbsentWithoutFeed.operationId, 10);
    expect(noFeedEvidence.actions?.some(item => item.actionId === 'delete_staged_photo')).toBe(true);
    await expect(cleanupFacebookMedia(parentAbsentWithoutFeed.actorId, action(parentAbsentWithoutFeed.photoIds[0])))
      .resolves.toMatchObject({ ok: true, state: 'confirmed' });
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

  it('records external absence and preserves a contradictory late provider receipt as a conflict event', async () => {
    const f = await fixture({ photoState: 'started' });
    integration.attestationEnabled = true;
    const absent = await resolveFacebookMedia(f.actorId, attest('record_step_absent', f.photoIds[0]));
    expect(absent).toMatchObject({ ok: true, state: 'attested' });
    await expect(facebookMediaJournal(f.operationId, f.remoteTargetId).recordPhoto(1, 'late_photo_id')).resolves.toBeUndefined();
    const step = await client!.$queryRaw<Array<{ state: string; remoteId: string | null }>>`SELECT state, "remoteId" FROM rebuild_facebook_media_steps WHERE id=${f.photoIds[0]}`;
    expect(step[0]).toEqual({ state: 'conflict', remoteId: null });
    const event = await client!.$queryRaw<Array<{ outcome: string; remoteId: string | null; source: string }>>`
      SELECT outcome, "remoteId", source FROM rebuild_facebook_media_resolutions WHERE "mediaStepId"=${f.photoIds[0]} ORDER BY "createdAt" DESC LIMIT 1`;
    expect(event[0]).toMatchObject({ outcome: 'late_provider_receipt', remoteId: 'late_photo_id', source: 'provider' });
    const evidence = await (await import('../src/platforms/facebook/media-journal')).readFacebookMediaEvidence(f.operationId, 10);
    expect(evidence.items).toContainEqual(expect.objectContaining({ recordType: 'event', source: 'operator', state: 'photo_absent', actorId: f.actorId }));
    expect(evidence.items).toContainEqual(expect.objectContaining({ recordType: 'event', source: 'provider', state: 'late_provider_receipt', remoteId: 'late_photo_id' }));
    await expect(assertFacebookMediaSettled(client! as never, f.workspaceId)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('records feed presence only after exact known photos and freezes the publication operation', async () => {
    const f = await fixture({ photoCount: 2, feedState: 'started' });
    integration.attestationEnabled = true;
    const result = await resolveFacebookMedia(f.actorId, attest('record_feed_present', f.feedId!, 'attested_feed_id'));
    expect(result).toMatchObject({ ok: true, state: 'attested' });
    await expect(facebookMediaJournal(f.operationId, f.remoteTargetId).recordFeed('attested_feed_id')).resolves.toBeUndefined();
    const feed = await client!.$queryRaw<Array<{ state: string; remoteId: string | null; attestedBy: string | null }>>`
      SELECT state, "remoteId", "attestedBy" FROM rebuild_facebook_media_steps WHERE id=${f.feedId!}`;
    expect(feed[0]).toMatchObject({ state: 'attested_present', remoteId: 'attested_feed_id', attestedBy: f.actorId });
    await expect(assertFacebookMediaResolution(client! as never, f.workspaceId, f.operationId, 'PUBLISHED', 'attested_feed_id')).resolves.toBeUndefined();
    const parent = await client!.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE id=${f.operationId}`;
    expect(parent[0].state).toBe('uncertain');
  });

  it('supports photo-present and feed-absent attestations and keeps the two identities separate', async () => {
    const photo = await fixture({ photoState: 'started' });
    integration.attestationEnabled = true;
    await resolveFacebookMedia(photo.actorId, attest('record_photo_present', photo.photoIds[0], 'human_photo_id'));
    await expect(facebookMediaJournal(photo.operationId, photo.remoteTargetId).recordPhoto(1, 'human_photo_id')).resolves.toBeUndefined();
    const photoRow = await client!.$queryRaw<Array<{ state: string; remoteId: string | null; receiptAt: Date | null }>>`
      SELECT state, "remoteId", "receiptAt" FROM rebuild_facebook_media_steps WHERE id=${photo.photoIds[0]}`;
    expect(photoRow[0]).toMatchObject({ state: 'attested_present', remoteId: 'human_photo_id', receiptAt: null });

    const feed = await fixture({ feedState: 'started' });
    await resolveFacebookMedia(feed.actorId, attest('record_step_absent', feed.feedId!));
    const feedRow = await client!.$queryRaw<Array<{ state: string; remoteId: string | null; attestedBy: string | null }>>`
      SELECT state, "remoteId", "attestedBy" FROM rebuild_facebook_media_steps WHERE id=${feed.feedId!}`;
    expect(feedRow[0]).toMatchObject({ state: 'attested_absent', remoteId: null, attestedBy: feed.actorId });
    const events = await client!.$queryRaw<Array<{ outcome: string; eventActorId: string | null }>>`
      SELECT outcome, "eventActorId" FROM rebuild_facebook_media_resolutions WHERE "operationId"=${feed.operationId}`;
    expect(events).toContainEqual({ outcome: 'feed_absent', eventActorId: feed.actorId });
  });

  it('keeps matching late deletion confirmation after a human deleted attestation and records its provider event', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.attestationEnabled = true;
    integration.outcome = 'uncertain';
    await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    const deletion = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]}`;
    await resolveFacebookMedia(f.actorId, attest('record_photo_deleted', deletion[0].id));
    await client!.$transaction(tx => recordFacebookMediaDeletionOutcome(tx as never, deletion[0].id, 'confirmed'));
    const row = await client!.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_facebook_media_deletions WHERE id=${deletion[0].id}`;
    expect(row[0].state).toBe('attested_deleted');
    const event = await client!.$queryRaw<Array<{ outcome: string; remoteId: string | null }>>`
      SELECT outcome, "remoteId" FROM rebuild_facebook_media_resolutions WHERE "deletionId"=${deletion[0].id} AND source='provider'`;
    expect(event[0].outcome).toBe('late_provider_receipt');
    expect(event[0].remoteId).toContain('remote_photo_1_');
    await expect(assertFacebookMediaResolution(client! as never, f.workspaceId, f.operationId, 'ABSENT')).resolves.toBeUndefined();
  });

  it('resolves an uncertain deletion when a delayed provider confirmation arrives', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.outcome = 'uncertain';
    await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    const deletion = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]}`;
    await client!.$transaction(tx => recordFacebookMediaDeletionOutcome(tx as never, deletion[0].id, 'confirmed'));
    const row = await client!.$queryRaw<Array<{ state: string; receiptAt: Date | null }>>`SELECT state, "receiptAt" FROM rebuild_facebook_media_deletions WHERE id=${deletion[0].id}`;
    expect(row[0].state).toBe('confirmed');
    expect(row[0].receiptAt).toBeInstanceOf(Date);
    await expect(assertFacebookMediaResolution(client! as never, f.workspaceId, f.operationId, 'ABSENT')).resolves.toBeUndefined();
  });

  it('records a deletion still-present attestation and permits a later explicit cleanup intent', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.attestationEnabled = true;
    integration.outcome = 'uncertain';
    const unknown = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(unknown.state).toBe('needs_review');
    const deletion = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]}`;
    await resolveFacebookMedia(f.actorId, attest('record_photo_still_present', deletion[0].id));
    integration.outcome = 'confirmed';
    const retried = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(retried).toMatchObject({ ok: true, state: 'confirmed' });
    expect(integration.callbackCalls).toBe(2);
    const history = await client!.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]} ORDER BY "createdAt"`;
    expect(history.map(row => row.state)).toEqual(['attested_present', 'confirmed']);
  });

  it('rejects a late deletion result when another step no longer matches the copied Page binding', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.outcome = 'uncertain';
    const unknown = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(unknown.state).toBe('needs_review');
    const deletion = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]}`;
    await client!.$executeRaw`UPDATE rebuild_facebook_media_steps SET "remoteTargetId"='different-page' WHERE id=${f.feedId!}`;
    await expect(client!.$transaction(tx => recordFacebookMediaDeletionOutcome(tx as never, deletion[0].id, 'confirmed')))
      .rejects.toThrow(/immutable publication binding/);
    const row = await client!.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_facebook_media_deletions WHERE id=${deletion[0].id}`;
    expect(row[0].state).toBe('uncertain');
    const events = await client!.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM rebuild_facebook_media_resolutions WHERE "deletionId"=${deletion[0].id} AND source='provider'`;
    expect(Number(events[0].count)).toBe(0);
  });

  it('holds a newer cleanup claim when an older still-present deletion later confirms', async () => {
    const f = await fixture({ feedState: 'rejected' });
    integration.attestationEnabled = true;
    integration.outcome = 'uncertain';
    await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    const oldDeletion = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]}`;
    await resolveFacebookMedia(f.actorId, attest('record_photo_still_present', oldDeletion[0].id));
    integration.outcome = 'confirmed';
    const newer = await cleanupFacebookMedia(f.actorId, action(f.photoIds[0]));
    expect(newer).toMatchObject({ ok: true, state: 'confirmed' });
    const late = await client!.$transaction(tx => recordFacebookMediaDeletionOutcome(tx as never, oldDeletion[0].id, 'confirmed'));
    expect(late).toBe('conflict');
    const rows = await client!.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT id, state FROM rebuild_facebook_media_deletions WHERE "mediaStepId"=${f.photoIds[0]} ORDER BY "createdAt", id`;
    expect(rows.map(row => row.state)).toEqual(['attested_present', 'conflict']);
    const event = await client!.$queryRaw<Array<{ outcome: string; source: string; remoteId: string | null }>>`
      SELECT outcome, source, "remoteId" FROM rebuild_facebook_media_resolutions WHERE "deletionId"=${oldDeletion[0].id} AND source='provider'`;
    expect(event).toHaveLength(1);
    expect(event[0]).toMatchObject({ outcome: 'late_provider_receipt', source: 'provider' });
    expect(event[0].remoteId).toContain('remote_photo_1_');
    await expect(cleanupFacebookMedia(f.actorId, action(f.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.callbackCalls).toBe(2);
  });

  it('allows update rejection on the immutable event ledger and permits scoped erasure deletes', async () => {
    const f = await fixture({ photoState: 'started' });
    integration.attestationEnabled = true;
    await resolveFacebookMedia(f.actorId, attest('record_step_absent', f.photoIds[0]));
    const events = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_facebook_media_resolutions WHERE "operationId"=${f.operationId}`;
    await expect(client!.$executeRaw`UPDATE rebuild_facebook_media_resolutions SET outcome='photo_present' WHERE id=${events[0].id}`).rejects.toThrow();
    await expect(client!.$executeRaw`DELETE FROM rebuild_facebook_media_resolutions WHERE id=${events[0].id}`).resolves.toBe(1);
  });

  it('keeps parent ABSENT frozen while a later photo receipt becomes a visible conflict', async () => {
    const f = await fixture({ photoState: 'started' });
    await client!.$executeRaw`UPDATE rebuild_publication_attempts SET state='attested_absent', reason='external_human_attestation',
      "attestedAt"=CURRENT_TIMESTAMP, "attestedBy"=${f.actorId}, "updatedAt"=CURRENT_TIMESTAMP WHERE id=${f.operationId}`;
    await expect(facebookMediaJournal(f.operationId, f.remoteTargetId).recordPhoto(1, 'after_absent_photo')).resolves.toBeUndefined();
    const step = await client!.$queryRaw<Array<{ state: string; remoteId: string | null }>>`SELECT state, "remoteId" FROM rebuild_facebook_media_steps WHERE id=${f.photoIds[0]}`;
    expect(step[0]).toEqual({ state: 'conflict', remoteId: null });
    const event = await client!.$queryRaw<Array<{ outcome: string; remoteId: string | null }>>`
      SELECT outcome, "remoteId" FROM rebuild_facebook_media_resolutions WHERE "mediaStepId"=${f.photoIds[0]}`;
    expect(event).toContainEqual({ outcome: 'late_provider_receipt', remoteId: 'after_absent_photo' });
    await expect(assertFacebookMediaSettled(client! as never, f.workspaceId)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects manual attestation when disabled, malformed, or bound to a corrupted operation', async () => {
    const f = await fixture({ photoState: 'started' });
    await expect(resolveFacebookMedia(f.actorId, attest('record_step_absent', f.photoIds[0]))).rejects.toMatchObject({ code: 'forbidden' });
    integration.attestationEnabled = true;
    await expect(resolveFacebookMedia(f.actorId, { ...attest('record_step_absent', f.photoIds[0]), confirmation: 'wrong' }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await client!.$executeRaw`UPDATE rebuild_facebook_media_steps SET "actorId"='different-actor', "updatedAt"=CURRENT_TIMESTAMP WHERE id=${f.photoIds[0]}`;
    await expect(resolveFacebookMedia(f.actorId, attest('record_step_absent', f.photoIds[0]))).rejects.toMatchObject({ code: 'conflict' });
    const events = await client!.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_facebook_media_resolutions WHERE "operationId"=${f.operationId}`;
    expect(Number(events[0].count)).toBe(0);
  });

  it('refuses API attestation and PUBLISHED or ABSENT resolution when the canonical post target is projected', async () => {
    const absent = await fixture({ photoState: 'started', projectedRemotePostId: 'projected-post' });
    integration.attestationEnabled = true;
    await expect(resolveFacebookMedia(absent.actorId, attest('record_step_absent', absent.photoIds[0])))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaResolution(client! as never, absent.workspaceId, absent.operationId, 'ABSENT'))
      .rejects.toMatchObject({ code: 'conflict' });

    const published = await fixture({ photoCount: 2, feedState: 'recorded', parentState: 'uncertain', projectedRemotePostId: 'different-projection' });
    await expect(assertFacebookMediaResolution(client! as never, published.workspaceId, published.operationId, 'PUBLISHED', 'known_feed'))
      .rejects.toMatchObject({ code: 'conflict' });

    const projectedCleanup = await fixture({ projectedRemotePostId: 'already-projected' });
    await expect(cleanupFacebookMedia(projectedCleanup.actorId, action(projectedCleanup.photoIds[0])))
      .rejects.toMatchObject({ code: 'conflict' });
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
    expect(evidence.columns.map(column => column.key)).toContain('remoteTargetId');
    expect(evidence.actions).toHaveLength(2);
    expect(evidence.actions?.[0].description).toContain('known staged Facebook photo');
    expect(evidence.actions?.[0].description).not.toContain('known unpublished');
    expect(evidence.actions?.[0]).toMatchObject({ actionId: 'delete_staged_photo', confirmation: `DELETE STAGED PHOTO ${f.photoIds[0]}` });
    expect(evidence.actions?.[0].context).toEqual([
      { label: 'Workspace ID', value: f.workspaceId },
      { label: 'Target ID', value: f.targetId },
      { label: 'Facebook Page ID', value: f.remoteTargetId },
      { label: 'Publication operation ID', value: f.operationId },
      { label: 'Facebook photo ID', value: f.remoteTargetId.replace('remote_page_', 'remote_photo_1_') },
    ]);
    expect(evidence.items.find(item => item.recordType === 'step')).toMatchObject({ remoteTargetId: f.remoteTargetId });
    expect(JSON.stringify(evidence)).not.toMatch(/accessToken|imageUrl|rawError|postText/i);
  });
});
