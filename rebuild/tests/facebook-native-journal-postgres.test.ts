import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  const value = shared.client?.[key as string]; return typeof value === 'function' ? value.bind(shared.client) : value;
} }) }));
import { createFacebookNativeJournal, executeFacebookNativeWithJournal, type FacebookNativeJournalScope } from '../src/platforms/facebook/formats/journal';
import { snapshotFacebookNativePlan } from '../src/platforms/facebook/formats/identity';
import { assertFacebookNativeSettled, assertFacebookNativeResolution, readFacebookNativeEvidence } from '../src/platforms/facebook/formats/journal-recovery';
import { exportWorkspaceData, deleteWorkspaceData, deleteWorkspaceDatabaseRows } from '../src/server/data-control';
import type { FacebookNativePlan } from '../src/platforms/facebook/formats/types';

function isolated(value: string, connections?: number) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.port !== '55432' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview') ||
    ['host','hostaddr','socket'].some(key => parsed.searchParams.has(key))) throw new Error('Only guarded loopback preview databases allowed.');
  if (connections) parsed.searchParams.set('connection_limit', String(connections));
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}
const plan: FacebookNativePlan = { format: 'reel', targetId: 'synthetic-page', description: 'Identifiable synthetic test', media: {
  kind: 'video', url: 'https://example.invalid/synthetic.mp4', sizeBytes: 3,
} };
const limits = async () => ({ timeout: 10_000, maxWait: 5_000 });
const proposed = (scope: FacebookNativeJournalScope) => ({ operationId: scope.operationId, targetId: scope.remoteTargetId, format: scope.format,
  payloadHash: scope.payloadHash, state: 'started' as const, knownIds: [] });

describe.skipIf(!url)('Native Facebook journal on real isolated PostgreSQL', () => {
  let db: PrismaClient; let contender: PrismaClient;
  const owner = `native89_${randomUUID().replaceAll('-', '')}`;
  const workspaces: string[] = [];
  beforeAll(async () => {
    db = isolated(url!); contender = isolated(url!, 1); shared.client = db as unknown as Record<string, unknown>;
    await db.user.create({ data: { id: owner, email: `${owner}@example.invalid`, name: 'Synthetic native journal owner', passwordHash: 'not-a-login' } });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId"=ANY(${workspaces}::text[])`;
      await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=ANY(${workspaces}::text[])`;
      await db.postTarget.deleteMany({ where: { post: { workspaceId: { in: workspaces } } } });
      await db.post.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.target.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.socialAccount.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
      await db.user.delete({ where: { id: owner } });
      expect(await db.workspace.count({ where: { id: { in: workspaces } } })).toBe(0);
    } finally { await contender?.$disconnect(); await db.$disconnect(); shared.client = undefined as never; }
  });
  async function fixture(): Promise<FacebookNativeJournalScope> {
    const id = `${owner}_${workspaces.length}`; workspaces.push(id);
    await db.workspace.create({ data: { id, name: 'Disposable native journal', slug: id, timezone: 'UTC' } });
    await db.membership.create({ data: { id: `${id}_member`, workspaceId: id, userId: owner, role: 'owner' } });
    await db.socialAccount.create({ data: { id: `${id}_account`, workspaceId: id, provider: 'facebook', providerUserId: id, name: 'Synthetic', accessToken: 'not-a-real-token' } });
    await db.target.create({ data: { id: `${id}_target`, workspaceId: id, socialAccountId: `${id}_account`, type: 'page', providerId: plan.targetId,
      name: 'Synthetic Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.post.create({ data: { id: `${id}_post`, workspaceId: id, authorId: owner, message: 'Synthetic', format: 'post', status: 'publishing', createdAt: new Date(), updatedAt: new Date() } });
    await db.postTarget.create({ data: { id: `${id}_pt`, postId: `${id}_post`, targetId: `${id}_target`, status: 'processing', formatId: 'future_reel' } });
    const scope: FacebookNativeJournalScope = { workspaceId: id, operationId: `${id}_operation`, postId: `${id}_post`, postTargetId: `${id}_pt`,
      targetId: `${id}_target`, actorId: owner, remoteTargetId: plan.targetId, sourceFormatId: 'future_reel', format: plan.format, payloadHash: snapshotFacebookNativePlan(plan).payloadHash };
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state)
      VALUES (${scope.operationId},${id},${scope.postId},${scope.postTargetId},${scope.targetId},'facebook',${owner},'started')`;
    return scope;
  }
  const store = (scope: FacebookNativeJournalScope, database = db) => createFacebookNativeJournal(scope, { database, limits });
  const raw = (scope: FacebookNativeJournalScope) => db.$queryRaw<Array<Record<string, any>>>`SELECT * FROM rebuild_facebook_native_journal WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.operationId}`;

  it('gives exactly one concurrent worker ownership and leaves restarts read-only', async () => {
    const scope = await fixture(); const a = store(scope); const b = store(scope, contender);
    const results = await Promise.all([a.begin(proposed(scope)), b.begin(proposed(scope))]);
    expect(results.filter(r => r.created)).toHaveLength(1);
    const loser = results[0].created ? b : a;
    expect(await loser.update(scope.operationId, { steps: [{ phase: 'upload_start', dispatched: true, confirmed: false }] }, ['started'])).toBe(false);
    expect(await store(scope).begin(proposed(scope))).toMatchObject({ created: false, existing: { payloadHash: scope.payloadHash } });
    expect(JSON.stringify(results)).not.toContain((await raw(scope))[0].ownerToken);
  });

  it('refuses wrong workspace, binding, payload and suffix aliases without writes', async () => {
    const scope = await fixture(); const owned = store(scope); await owned.begin(proposed(scope));
    const foreign = await fixture();
    await expect(store({ ...scope, workspaceId: foreign.workspaceId }).get(scope.operationId)).rejects.toMatchObject({ code: 'conflict' });
    await expect(store({ ...scope, payloadHash: 'b'.repeat(64) }).begin(proposed({ ...scope, payloadHash: 'b'.repeat(64) }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store({ ...scope, actorId: 'other' }).get(scope.operationId)).rejects.toMatchObject({ code: 'conflict' });
    await expect(owned.get(`${scope.operationId}:delete`)).rejects.toMatchObject({ code: 'conflict' });
    expect((await raw(scope))[0].revision).toBe(0);
  });

  it('fences simultaneous writes at one revision and rejects protocol rewrites in PostgreSQL', async () => {
    const scope = await fixture(); const owned = store(scope); await owned.begin(proposed(scope));
    const step = { phase: 'upload_start', dispatched: true, confirmed: false };
    const writes = await Promise.all([owned.update(scope.operationId, { steps: [step] }, ['started']), owned.update(scope.operationId, { steps: [step] }, ['started'])]);
    expect(writes.filter(Boolean)).toHaveLength(1);
    expect(await owned.update(scope.operationId, { steps: [{ ...step, confirmed: true }], knownIds: ['upload'] }, ['started'])).toBe(true);
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET steps='[{"phase":"upload_start","dispatched":true,"confirmed":false}]'::jsonb, revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET "knownIds"='[]'::jsonb, revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET "payloadHash"=${'c'.repeat(64)}, revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE rebuild_publication_attempts SET "targetId"='different' WHERE id=${scope.operationId}`).rejects.toThrow();
  });

  it('retains late provider IDs after parent terminal state and prevents upload or replay', async () => {
    const scope = await fixture(); const postGraph = vi.fn(async () => {
      await db.$executeRaw`UPDATE rebuild_publication_attempts SET state='rejected', reason='provider_rejected' WHERE id=${scope.operationId}`;
      return { video_id: 'late-upload', upload_url: 'https://example.invalid/upload' };
    }); const upload = vi.fn();
    expect(await executeFacebookNativeWithJournal(scope, plan, { database: db, limits, transport: { postGraph, upload } }))
      .toMatchObject({ status: 'uncertain', knownIds: ['late-upload'] });
    const row = (await raw(scope))[0];
    expect(row).toMatchObject({ state: 'uncertain', knownIds: ['late-upload'], conflicted: true, remoteId: null });
    expect(row.steps).toEqual([{ phase: 'upload_start', dispatched: true, confirmed: true }]);
    expect(upload).not.toHaveBeenCalled();
    expect((await executeFacebookNativeWithJournal(scope, plan, { database: db, limits, transport: { postGraph, upload } })).status).toBe('already_attempted');
    expect(postGraph).toHaveBeenCalledTimes(1);
    await expect(db.$transaction(tx => assertFacebookNativeSettled(tx, scope.workspaceId))).rejects.toMatchObject({ code: 'conflict' });
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'ABSENT'))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('stops dispatch and preserves receipts if the selected connection changes mid-operation', async () => {
    const scope = await fixture(); const upload = vi.fn(); const postGraph = vi.fn(async () => {
      await db.socialAccount.update({ where: { id: `${scope.workspaceId}_account` }, data: { invalidatedAt: new Date() } });
      return { video_id: 'retained', upload_url: 'https://example.invalid/upload' };
    });
    expect((await executeFacebookNativeWithJournal(scope, plan, { database: db, limits, transport: { postGraph, upload } })).status).toBe('uncertain');
    expect((await raw(scope))[0]).toMatchObject({ knownIds: ['retained'], conflicted: true });
    expect(upload).not.toHaveBeenCalled();
  });

  it('preserves a late receipt after a newer revision but never grants another phase', async () => {
    const scope = await fixture(); const upload = vi.fn(); const postGraph = vi.fn(async () => {
      await db.$executeRaw`UPDATE rebuild_facebook_native_journal SET state='uncertain',revision=revision+1 WHERE "operationId"=${scope.operationId}`;
      return { video_id: 'after-revision', upload_url: 'https://example.invalid/upload' };
    });
    expect((await executeFacebookNativeWithJournal(scope, plan, { database: db, limits, transport: { postGraph, upload } })).status).toBe('uncertain');
    expect((await raw(scope))[0]).toMatchObject({ knownIds: ['after-revision'], conflicted: true, state: 'uncertain' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('completes phase receipts while an outer operation holds its advisory locks', async () => {
    const scope = await fixture();
    const postGraph = vi.fn().mockResolvedValueOnce({ video_id: 'complete-video', upload_url: 'https://example.invalid/upload' }).mockResolvedValueOnce({ success: true });
    const upload = vi.fn();
    const result = await db.$transaction(async outer => {
      const key = JSON.stringify(['publishing-targets', scope.workspaceId, scope.targetId]);
      const acquired = await outer.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS acquired`;
      expect(acquired[0]?.acquired).toBe(true);
      return executeFacebookNativeWithJournal(scope, plan, { database: contender, limits, transport: { postGraph, upload } });
    }, { timeout: 10_000 });
    expect(result).toMatchObject({ status: 'submitted', remoteId: 'complete-video', readbackRequired: true });
    expect((await raw(scope))[0]).toMatchObject({ state: 'published', remoteId: 'complete-video', knownIds: ['complete-video'] });
    await expect(db.$transaction(tx => assertFacebookNativeSettled(tx, scope.workspaceId))).rejects.toMatchObject({ code: 'conflict' });
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'PUBLISHED', 'complete-video'))).rejects.toMatchObject({ code: 'conflict' });
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET "remoteId"='other',"knownIds"='["complete-video","other"]'::jsonb,revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
  });

  it('enforces strict JSON phase shapes and the workspace purge write gate', async () => {
    const scope = await fixture(); const owned = store(scope); await owned.begin(proposed(scope));
    for (const value of [null, {}, [{ phase: 'reel_finish', dispatched: true, confirmed: false }],
      [{ phase: 'upload_start', dispatched: true, confirmed: null }], [{ phase: 'upload_start', dispatched: true, confirmed: false, extra: 1 }]]) {
      await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET steps=${JSON.stringify(value)}::jsonb,revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
    }
    await db.workspaceDataPurge.create({ data: { workspaceId: scope.workspaceId, requestedById: owner, mediaRoot: '/private/tmp/native89-no-media', status: 'requested' } });
    await expect(owned.update(scope.operationId, { state: 'uncertain' }, ['started'])).rejects.toThrow('Workspace data deletion is in progress');
    expect((await raw(scope))[0].revision).toBe(0);
    await db.workspaceDataPurge.delete({ where: { workspaceId: scope.workspaceId } });
  });

  it('holds newly discovered IDs after a terminal rejection and cannot clear their conflict', async () => {
    const scope = await fixture(); const owned = store(scope); await owned.begin(proposed(scope));
    expect(await owned.update(scope.operationId, { state: 'rejected' }, ['started'])).toBe(true);
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET "knownIds"='["late-id"]'::jsonb,revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
    expect(await owned.update(scope.operationId, { knownIds: ['late-id'] }, ['started'])).toBe(false);
    expect((await raw(scope))[0]).toMatchObject({ state: 'rejected', knownIds: ['late-id'], conflicted: true });
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_journal SET conflicted=false,revision=revision+1 WHERE "operationId"=${scope.operationId}`).rejects.toThrow();
    await expect(db.$transaction(tx => assertFacebookNativeSettled(tx, scope.workspaceId))).rejects.toMatchObject({ code: 'conflict' });
  });

  it.each(['video', 'story_photo', 'story_video'] as const)('persists the correct complete %s phase chain without claiming live status', async format => {
    const scope = await fixture();
    const nativePlan: FacebookNativePlan = format === 'video' ? { format, targetId: scope.remoteTargetId, description: '', scheduledUnix: null,
      media: { kind: 'video', url: 'https://example.invalid/video.mp4' } } : { format, targetId: scope.remoteTargetId,
      media: { kind: format === 'story_photo' ? 'image' : 'video', url: 'https://example.invalid/media', sizeBytes: 3 } };
    scope.format = format; scope.payloadHash = snapshotFacebookNativePlan(nativePlan).payloadHash;
    const postGraph = format === 'video' ? vi.fn().mockResolvedValueOnce({ id: 'final-video' }) : format === 'story_photo'
      ? vi.fn().mockResolvedValueOnce({ id: 'stage-photo' }).mockResolvedValueOnce({ post_id: 'final-story' })
      : vi.fn().mockResolvedValueOnce({ video_id: 'stage-video', upload_url: 'https://example.invalid/upload' }).mockResolvedValueOnce({ post_id: 'final-story' });
    const result = await executeFacebookNativeWithJournal(scope, nativePlan, { database: contender, limits, transport: { postGraph, upload: vi.fn() } });
    expect(result).toMatchObject({ status: 'submitted', remoteId: format === 'video' ? 'final-video' : 'final-story', readbackRequired: true });
    const row = (await raw(scope))[0];
    expect(row.steps.map((step: { phase: string }) => step.phase)).toEqual(format === 'video' ? ['video_create'] : format === 'story_photo' ? ['photo_upload', 'story_create'] : ['upload_start', 'upload_transfer', 'story_finish']);
    expect(row.steps.every((step: { confirmed: boolean }) => step.confirmed)).toBe(true);
    if (format !== 'video') expect(row.knownIds).toEqual([format === 'story_photo' ? 'stage-photo' : 'stage-video', 'final-story']);
  });

  it('exports the real child table with fence redacted and refuses deletion of unresolved evidence', async () => {
    const scope = await fixture(); const owned = store(scope); await owned.begin(proposed(scope));
    await owned.update(scope.operationId, { state: 'uncertain', steps: [{ phase: 'upload_start', dispatched: true, confirmed: false }] }, ['started']);
    await db.$executeRaw`UPDATE rebuild_publication_attempts SET state='rejected',reason='provider_rejected' WHERE id=${scope.operationId}`;
    await db.postTarget.update({ where: { id: scope.postTargetId }, data: { status: 'failed' } });
    const exported = await exportWorkspaceData({ userId: owner, workspaceId: scope.workspaceId });
    expect(exported.legacyTables.rebuild_facebook_native_journal).toHaveLength(1);
    expect(exported.legacyTables.rebuild_facebook_native_journal[0].ownerToken).toBe('[REDACTED]');
    expect(JSON.stringify(exported)).not.toContain((await raw(scope))[0].ownerToken);
    await expect(deleteWorkspaceData({ userId: owner, workspaceId: scope.workspaceId }, 'DELETE')).rejects.toMatchObject({ code: 'conflict' });
    expect((await raw(scope))).toHaveLength(1);
    const evidence = await readFacebookNativeEvidence(scope.operationId, 10);
    expect(evidence.items).toHaveLength(1); expect(JSON.stringify(evidence)).not.toContain((await raw(scope))[0].ownerToken);
  });

  it('allows settled rejection and removes child before parent while preserving another tenant', async () => {
    const scope = await fixture(); const foreign = await fixture();
    const owned = store(scope); await owned.begin(proposed(scope)); await owned.update(scope.operationId, { state: 'rejected' }, ['started']);
    await store(foreign).begin(proposed(foreign));
    await db.$transaction(tx => assertFacebookNativeSettled(tx, scope.workspaceId));
    await db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'ABSENT'));
    await db.$transaction(tx => deleteWorkspaceDatabaseRows(tx, scope.workspaceId), { timeout: 15_000 });
    expect(await raw(scope)).toHaveLength(0); expect(await raw(foreign)).toHaveLength(1);
  });
}, 30_000);
