import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
// Needs migration 20261030100000 (Story proofs): every case returns early when the guarded database predates it.
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as any, onRead: undefined as undefined | (() => Promise<void>), reads: 0, response: 'published' }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  const value = shared.client?.[key]; return typeof value === 'function' ? value.bind(shared.client) : value;
} }) }));
vi.mock('../src/platforms/facebook/formats/read-credentials', () => ({ prepareFacebookNativeStatusRead: async (binding: { remoteId: string }) => ({
  transport: { getGraph: async (id: string) => {
    shared.reads++; await shared.onRead?.();
    if (shared.response === 'error') throw new Error('Identifiable synthetic read failure');
    // A Story has no readable object of its own: the Page's Stories edge lists it by final post id.
    if (!id.endsWith('/stories')) throw new Error('Story proof must read the Page Stories edge');
    return { data: shared.response === 'not_listed' ? [] : [{ post_id: binding.remoteId, status: shared.response === 'archived' ? 'archived' : 'published' }] };
  } },
  assertCurrent: async () => {},
}) }));
import { refreshFacebookNativeStatus, facebookNativeStatusConfirmation } from '../src/platforms/facebook/formats/status-recovery';
import { executeFacebookNativeWithJournal, type FacebookNativeJournalBinding } from '../src/platforms/facebook/formats/journal';
import { assertFacebookNativeResolution } from '../src/platforms/facebook/formats/journal-recovery';

function database(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.port !== '55432' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview') ||
    ['host', 'hostaddr', 'socket'].some(key => parsed.searchParams.has(key))) throw new Error('Guarded synthetic preview database required.');
  return new PrismaClient({ datasources: { db: { url: value } } });
}
async function storyProofsMigrated(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ ok: boolean }>>`SELECT pg_get_functiondef('rebuild_facebook_native_status_proofs_guard'::regproc) LIKE '%Story%' AS ok`;
  return rows[0]?.ok === true;
}
describe.skipIf(!url)('Native Story proof recovery on actual synthetic PostgreSQL', () => {
  let db: PrismaClient, migrated = false;
  const tag = `native100_${randomUUID().replaceAll('-', '')}`;
  const root = `${tag}_root`, author = `${tag}_author`, workspaces: string[] = [];
  beforeAll(async () => {
    db = database(url!); shared.client = db; migrated = await storyProofsMigrated(db).catch(() => false);
    if (!migrated) return;
    await db.user.createMany({ data: [
      { id: root, email: `${root}@example.invalid`, name: 'Synthetic Root observer', passwordHash: 'not-a-login', isInstanceOwner: true },
      { id: author, email: `${author}@example.invalid`, name: 'Synthetic publication author', passwordHash: 'not-a-login' },
    ] });
  });
  beforeEach(() => { shared.onRead = undefined; shared.reads = 0; shared.response = 'published'; });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${root}`;
      await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=ANY(${workspaces}::text[])`;
      await db.postTarget.deleteMany({ where: { post: { workspaceId: { in: workspaces } } } });
      await db.post.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.target.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.socialAccount.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
      await db.user.deleteMany({ where: { id: { in: [root, author] } } });
    } finally { await db.$disconnect(); shared.client = undefined; }
  });
  async function fixture(format: 'story_photo' | 'story_video') {
    const id = `${tag}_${workspaces.length}`; workspaces.push(id);
    await db.workspace.create({ data: { id, slug: id, name: 'Disposable native Story recovery', timezone: 'UTC' } });
    await db.membership.create({ data: { id: `${id}_membership`, workspaceId: id, userId: author, role: 'owner' } });
    await db.socialAccount.create({ data: { id: `${id}_account`, workspaceId: id, provider: 'facebook', providerUserId: id,
      name: 'Synthetic source', accessToken: 'not-a-provider-token' } });
    await db.target.create({ data: { id: `${id}_target`, workspaceId: id, socialAccountId: `${id}_account`, type: 'page',
      providerId: `page_${id}`, name: 'Synthetic Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.post.create({ data: { id: `${id}_post`, workspaceId: id, authorId: author, message: 'Synthetic Story recovery fixture',
      format: 'post', status: 'publishing', createdAt: new Date(), updatedAt: new Date() } });
    await db.postTarget.create({ data: { id: `${id}_pt`, postId: `${id}_post`, targetId: `${id}_target`, status: 'processing', formatId: format } });
    const scope: FacebookNativeJournalBinding = { workspaceId: id, operationId: `${id}_operation`, postId: `${id}_post`, postTargetId: `${id}_pt`,
      targetId: `${id}_target`, actorId: author, remoteTargetId: `page_${id}`, sourceFormatId: format };
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state)
      VALUES (${scope.operationId},${id},${scope.postId},${scope.postTargetId},${scope.targetId},'facebook',${author},'started')`;
    const photo = format === 'story_photo';
    const outcome = await executeFacebookNativeWithJournal(scope, { format, targetId: scope.remoteTargetId,
      media: photo ? { kind: 'image', url: 'https://example.invalid/synthetic.jpg', sizeBytes: 3 } : { kind: 'video', url: 'https://example.invalid/synthetic.mp4', sizeBytes: 3 } } as any, {
      database: db, limits: async () => ({ timeout: 10_000, maxWait: 5_000 }),
      transport: { postGraph: async (path: string, body: Record<string, string>) => {
        if (path.endsWith('/photos')) return { id: `staged_${id}` };
        if (path.endsWith('/photo_stories')) return { post_id: `story_${id}` };
        return body.upload_phase === 'finish' ? { success: true, post_id: `story_${id}` }
          : { video_id: `staged_${id}`, upload_url: 'https://rupload.facebook.com/video-upload/v21.0/synthetic' };
      }, upload: async () => {} },
    });
    expect(outcome.status).toBe('submitted');
    return scope;
  }
  const journal = async (scope: FacebookNativeJournalBinding) => (await db.$queryRaw<Array<Record<string, any>>>`
    SELECT * FROM rebuild_facebook_native_journal WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.operationId}`)[0];
  const proofs = (scope: FacebookNativeJournalBinding) => db.$queryRaw<Array<Record<string, any>>>`
    SELECT * FROM rebuild_facebook_native_status_proofs WHERE "workspaceId"=${scope.workspaceId} AND "operationId"=${scope.operationId}`;
  async function action(scope: FacebookNativeJournalBinding) {
    return { actionId: 'refresh_native_status', subjectId: scope.operationId,
      confirmation: facebookNativeStatusConfirmation(scope.operationId, (await journal(scope)).revision), acknowledged: true as const };
  }
  const formats = ['story_photo', 'story_video'] as const;
  it.each(formats)('journals the staged media beside the final %s identity', async format => {
    if (!migrated) return;
    const scope = await fixture(format), row = await journal(scope);
    expect(row.knownIds).toHaveLength(2); expect(row.knownIds).toContain(row.remoteId);
    expect(row.remoteId).toBe(`story_${scope.workspaceId}`);
  });
  it.each(formats)('accepts %s proof only from the Page Stories edge by exact final id', async format => {
    if (!migrated) return;
    const scope = await fixture(format);
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: true, state: 'confirmed' });
    const [proof] = await proofs(scope);
    expect(proof).toMatchObject({ actorId: root, accepted: true, outcome: 'published', format, remoteId: `story_${scope.workspaceId}` });
    expect(shared.reads).toBe(1);
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'PUBLISHED', proof.remoteId))).resolves.toBeUndefined();
    // The staged media id is not the final identity and cannot be attested as the publication.
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'PUBLISHED', `staged_${scope.workspaceId}`))).rejects.toMatchObject({ code: 'conflict' });
  });
  it.each(['not_listed', 'archived', 'error'])('keeps a %s Story observation unaccepted and the child uncertain', async response => {
    if (!migrated) return;
    const scope = await fixture('story_photo'); shared.response = response;
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: false, state: 'needs_review' });
    expect(await proofs(scope)).toMatchObject([{ accepted: false, appliedRevision: null, outcome: 'unknown' }]);
    expect((await journal(scope)).state).toBe('uncertain');
  });
  it('database guard refuses an accepted Story proof without exactly two identities', async () => {
    if (!migrated) return;
    const scope = await fixture('story_video'); const row = await journal(scope);
    const insert = () => db.$executeRaw`INSERT INTO rebuild_facebook_native_status_proofs
      (id,"workspaceId","operationId","observedRevision","appliedRevision","payloadHash",format,"remoteTargetId","remoteId","actorId",outcome,detail,"observedAt",accepted)
      VALUES (${randomUUID()},${scope.workspaceId},${scope.operationId},${row.revision - 1},${row.revision},${row.payloadHash},${row.format},
        ${row.remoteTargetId},${row.remoteId},${root},'published',NULL,CURRENT_TIMESTAMP,true)`;
    // Not confirmed: refused.
    await expect(insert()).rejects.toThrow();
    // Confirmed but the staged identity removed: refused (a Story needs exactly two).
    await db.$executeRaw`UPDATE rebuild_facebook_native_journal SET state='confirmed',"knownIds"=jsonb_build_array("remoteId"),"updatedAt"=clock_timestamp() WHERE "operationId"=${scope.operationId}`;
    await expect(insert()).rejects.toThrow();
    expect(await proofs(scope)).toHaveLength(0);
  });
  it('serializes concurrent Story refreshes under the existing operation authority', async () => {
    if (!migrated) return;
    const scope = await fixture('story_photo'), input = await action(scope);
    const results = await Promise.allSettled([refreshFacebookNativeStatus(root, input), refreshFacebookNativeStatus(root, input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(shared.reads).toBe(1); expect(await proofs(scope)).toHaveLength(1);
  });
});
