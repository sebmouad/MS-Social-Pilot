import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
import { createFacebookNativeJournal, type FacebookNativeJournalScope } from '../src/platforms/facebook/formats/journal';
import { createFacebookNativeScheduleStore } from '../src/platforms/facebook/formats/schedule-journal';
import { cancelFacebookNativeSchedule, rescheduleFacebookNativeSchedule } from '../src/platforms/facebook/formats/schedule';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.port !== '55432' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview') ||
    ['host', 'hostaddr', 'socket'].some(key => parsed.searchParams.has(key))) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}
const limits = async () => ({ timeout: 10_000, maxWait: 5_000 });
const HASH = 'a'.repeat(64);
const scheduled = { status: { video_status: 'ready' }, published: false, scheduled_publish_time: 1_800_000_000 };

/** The change table exists only after migration 20261030140000 is applied to the guarded preview database. */
describe.skipIf(!url)('Native Facebook schedule changes on real isolated PostgreSQL', () => {
  let db: PrismaClient; let ready = false;
  const owner = `sched140_${randomUUID().replaceAll('-', '')}`;
  const workspaces: string[] = [];
  beforeAll(async () => {
    db = isolated(url!);
    ready = (await db.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('rebuild_facebook_native_schedule_changes')::text AS t`)[0].t !== null;
    await db.user.create({ data: { id: owner, email: `${owner}@example.invalid`, name: 'Synthetic schedule owner', passwordHash: 'not-a-login' } });
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
    } finally { await db.$disconnect(); }
  });
  /** A published, unconflicted native Video journal row with remote id VID. */
  async function published() {
    const id = `${owner}_${workspaces.length}`; workspaces.push(id);
    await db.workspace.create({ data: { id, name: 'Disposable schedule change', slug: id, timezone: 'UTC' } });
    await db.membership.create({ data: { id: `${id}_member`, workspaceId: id, userId: owner, role: 'owner' } });
    await db.socialAccount.create({ data: { id: `${id}_account`, workspaceId: id, provider: 'facebook', providerUserId: id, name: 'Synthetic', accessToken: 'not-a-real-token' } });
    await db.target.create({ data: { id: `${id}_target`, workspaceId: id, socialAccountId: `${id}_account`, type: 'page', providerId: 'page', name: 'Synthetic Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.post.create({ data: { id: `${id}_post`, workspaceId: id, authorId: owner, message: 'Synthetic', format: 'post', status: 'publishing', createdAt: new Date(), updatedAt: new Date() } });
    await db.postTarget.create({ data: { id: `${id}_pt`, postId: `${id}_post`, targetId: `${id}_target`, status: 'processing', formatId: 'video' } });
    const scope: FacebookNativeJournalScope = { workspaceId: id, operationId: `${id}_op`, postId: `${id}_post`, postTargetId: `${id}_pt`, targetId: `${id}_target`,
      actorId: owner, remoteTargetId: 'page', sourceFormatId: 'video', format: 'video', payloadHash: HASH };
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state)
      VALUES (${scope.operationId},${id},${scope.postId},${scope.postTargetId},${scope.targetId},'facebook',${owner},'started')`;
    const journal = createFacebookNativeJournal(scope, { database: db, limits });
    await journal.begin({ operationId: scope.operationId, targetId: 'page', format: 'video', payloadHash: HASH, state: 'started', knownIds: [] });
    expect(await journal.update(scope.operationId, { steps: [{ phase: 'video_create', dispatched: true, confirmed: true }], knownIds: ['VID'], remoteId: 'VID', state: 'published' }, ['started'])).toBe(true);
    return scope;
  }
  const store = (scope: { workspaceId: string; operationId: string }) => createFacebookNativeScheduleStore({ workspaceId: scope.workspaceId, publishOperationId: scope.operationId }, { database: db, limits });
  const transport = (over = {}) => ({ postGraph: vi.fn(async () => ({ success: true })), upload: vi.fn(), getGraph: vi.fn(async () => scheduled), deleteGraph: vi.fn(async () => ({ success: true })), ...over });
  const rows = (scope: { operationId: string }) => db.$queryRaw<Array<Record<string, any>>>`SELECT * FROM rebuild_facebook_native_schedule_changes WHERE "publishOperationId"=${scope.operationId} ORDER BY "changeId"`;

  it('cancels once through the schedule helper, durably, and moves the parent to deleted', async () => {
    if (!ready) return;
    const scope = await published(); const t = transport(); const attempts = store(scope);
    expect(await cancelFacebookNativeSchedule(scope.operationId, { attempts, transport: t as never })).toEqual({ status: 'cancelled' });
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
    expect((await rows(scope)).map(r => [r.changeId, r.state, r.revision])).toEqual([[`${scope.operationId}:cancel`, 'deleted', 1]]);
    expect((await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_facebook_native_journal WHERE "operationId"=${scope.operationId}`)[0].state).toBe('deleted');
    // A fresh process cannot send a second DELETE.
    const again = await cancelFacebookNativeSchedule(scope.operationId, { attempts: store(scope), transport: t as never });
    expect(again.status === 'no_publication' || again.status === 'already_attempted').toBe(true);
    expect(t.deleteGraph).toHaveBeenCalledTimes(1);
  });

  it('reschedules once per instant and leaves the parent published', async () => {
    if (!ready) return;
    const scope = await published(); const t = transport(); const now = new Date(1_700_000_000_000); const at = new Date(now.getTime() + 86_400_000);
    expect(await rescheduleFacebookNativeSchedule(scope.operationId, at, { attempts: store(scope), transport: t as never, now })).toEqual({ status: 'rescheduled' });
    expect(await rescheduleFacebookNativeSchedule(scope.operationId, at, { attempts: store(scope), transport: t as never, now })).toMatchObject({ status: 'already_attempted' });
    expect(t.postGraph).toHaveBeenCalledTimes(1);
    const [row] = await rows(scope);
    expect(row).toMatchObject({ kind: 'reschedule', state: 'published', remoteId: 'VID' });
    expect((await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_facebook_native_journal WHERE "operationId"=${scope.operationId}`)[0].state).toBe('published');
  });

  it('gives one concurrent creator ownership; only it may settle, and the parent needs a confirmed cancel', async () => {
    if (!ready) return;
    const scope = await published(); const a = store(scope); const b = store(scope);
    const proposal = { operationId: `${scope.operationId}:cancel`, format: 'video' as const, state: 'started' as const, knownIds: ['VID'], targetId: 'page' };
    const results = await Promise.all([a.begin(proposal), b.begin(proposal)]);
    expect(results.filter(r => r.created)).toHaveLength(1);
    const winner = results[0].created ? a : b; const loser = results[0].created ? b : a;
    expect(await loser.update(proposal.operationId, { state: 'deleted' }, ['started'])).toBe(false);
    expect(await winner.update(scope.operationId, { state: 'deleted' }, ['published'])).toBe(false); // child still started
    expect(await winner.update(proposal.operationId, { state: 'deleted' }, ['started'])).toBe(true);
    expect(await winner.update(proposal.operationId, { state: 'uncertain' }, ['started'])).toBe(false);
    expect(await winner.update(scope.operationId, { state: 'deleted' }, ['published', 'confirmed'])).toBe(true);
    expect(await winner.update(scope.operationId, { state: 'deleted' }, ['published', 'confirmed'])).toBe(false);
  });

  it('rejects mismatched remote identity, foreign workspaces, unpublished parents and SQL-level rewrites', async () => {
    if (!ready) return;
    const scope = await published(); const foreign = await published();
    const op = `${scope.operationId}:cancel`;
    await expect(store(scope).begin({ operationId: op, format: 'video', state: 'started', knownIds: ['OTHER'], targetId: 'page' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(createFacebookNativeScheduleStore({ workspaceId: foreign.workspaceId, publishOperationId: scope.operationId }, { database: db, limits })
      .begin({ operationId: op, format: 'video', state: 'started', knownIds: ['VID'], targetId: 'page' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await rows(scope)).toHaveLength(0);
    const s = store(scope);
    await s.begin({ operationId: op, format: 'video', state: 'started', knownIds: ['VID'], targetId: 'page' });
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_schedule_changes SET state='published', revision=revision+1 WHERE "changeId"=${op}`).rejects.toThrow(); // cancel cannot be "published"
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_schedule_changes SET "remoteId"='OTHER', revision=revision+1 WHERE "changeId"=${op}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_schedule_changes SET state='deleted' WHERE "changeId"=${op}`).rejects.toThrow(); // revision must advance
    await expect(db.$executeRaw`INSERT INTO rebuild_facebook_native_schedule_changes ("changeId","workspaceId","publishOperationId",kind,"scheduledUnix","remoteId","remoteTargetId","ownerToken")
      VALUES (${`${scope.operationId}:cancel:x`},${scope.workspaceId},${scope.operationId},'cancel',NULL,'VID','page',${randomUUID()}::uuid)`).rejects.toThrow(); // id shape
    // A parent that is no longer published cannot start a new change.
    await db.$executeRaw`DELETE FROM rebuild_facebook_native_schedule_changes WHERE "changeId"=${op}`;
    await db.$executeRaw`UPDATE rebuild_facebook_native_journal SET state='uncertain', revision=revision+1, "updatedAt"=clock_timestamp() WHERE "operationId"=${scope.operationId}`;
    await expect(store(scope).begin({ operationId: op, format: 'video', state: 'started', knownIds: ['VID'], targetId: 'page' })).rejects.toMatchObject({ code: 'conflict' });
  });
});
