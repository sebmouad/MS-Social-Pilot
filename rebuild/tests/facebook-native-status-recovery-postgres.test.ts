import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as any, onRead: undefined as undefined | (() => Promise<void>),
  checks: 0, denyBeforeRead: false, denyAfterRead: false, reads: 0, response: 'published' }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_target, key) => {
  const value = shared.client?.[key]; return typeof value === 'function' ? value.bind(shared.client) : value;
} }) }));
vi.mock('../src/platforms/facebook/formats/read-credentials', () => ({ prepareFacebookNativeStatusRead: async (binding: {remoteTargetId: string}) => ({
  transport: { getGraph: async (id: string) => {
    shared.reads++; await shared.onRead?.();
    if (shared.response === 'error') throw new Error('Identifiable synthetic read failure');
    return { id, from: { id: shared.response === 'wrong_page' ? 'different-page' : binding.remoteTargetId },
      status: { video_status: 'ready' }, published: shared.response !== 'scheduled', scheduled_publish_time: 1_900_000_000 };
  } },
  assertCurrent: async () => { shared.checks++; if (shared.denyBeforeRead || shared.denyAfterRead && shared.reads) throw new Error('Synthetic grant changed'); },
}) }));
import { refreshFacebookNativeStatus, facebookNativeStatusConfirmation } from '../src/platforms/facebook/formats/status-recovery';
import { executeFacebookNativeWithJournal, type FacebookNativeJournalBinding } from '../src/platforms/facebook/formats/journal';
import { assertFacebookNativeResolution, assertFacebookNativeSettled } from '../src/platforms/facebook/formats/journal-recovery';
import { recordRootPublicationOutcome, finishRootPublicationProjection } from '../src/server/root/publication-attempts';
import { exportWorkspaceData, deleteWorkspaceDatabaseRows } from '../src/server/data-control';

function database(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.port !== '55432' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview') ||
    ['host','hostaddr','socket'].some(key => parsed.searchParams.has(key))) throw new Error('Guarded synthetic preview database required.');
  return new PrismaClient({ datasources: { db: { url: value } } });
}
describe.skipIf(!url)('Native status recovery on actual synthetic PostgreSQL', () => {
  let db: PrismaClient;
  const tag = `native91_${randomUUID().replaceAll('-', '')}`;
  const root = `${tag}_root`, author = `${tag}_author`, workspaces: string[] = [];
  beforeAll(async () => {
    db = database(url!); shared.client = db;
    await db.user.createMany({ data: [
      { id: root, email: `${root}@example.invalid`, name: 'Synthetic Root observer', passwordHash: 'not-a-login', isInstanceOwner: true },
      { id: author, email: `${author}@example.invalid`, name: 'Synthetic publication author', passwordHash: 'not-a-login' },
    ] });
  });
  beforeEach(() => { shared.onRead = undefined; shared.checks = 0; shared.denyBeforeRead = false; shared.denyAfterRead = false; shared.reads = 0; shared.response = 'published'; });
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
  async function fixture() {
    const id = `${tag}_${workspaces.length}`; workspaces.push(id);
    await db.workspace.create({ data: { id, slug: id, name: 'Disposable native status recovery', timezone: 'UTC' } });
    await db.membership.create({ data: { id: `${id}_membership`, workspaceId: id, userId: author, role: 'owner' } });
    await db.socialAccount.create({ data: { id: `${id}_account`, workspaceId: id, provider: 'facebook', providerUserId: id,
      name: 'Synthetic source', accessToken: 'not-a-provider-token' } });
    await db.target.create({ data: { id: `${id}_target`, workspaceId: id, socialAccountId: `${id}_account`, type: 'page',
      providerId: `page_${id}`, name: 'Synthetic Page', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.post.create({ data: { id: `${id}_post`, workspaceId: id, authorId: author, message: 'Synthetic status recovery fixture',
      format: 'post', status: 'publishing', createdAt: new Date(), updatedAt: new Date() } });
    await db.postTarget.create({ data: { id: `${id}_pt`, postId: `${id}_post`, targetId: `${id}_target`, status: 'processing', formatId: 'future_video' } });
    const scope: FacebookNativeJournalBinding = { workspaceId: id, operationId: `${id}_operation`, postId: `${id}_post`, postTargetId: `${id}_pt`,
      targetId: `${id}_target`, actorId: author, remoteTargetId: `page_${id}`, sourceFormatId: 'future_video' };
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state)
      VALUES (${scope.operationId},${id},${scope.postId},${scope.postTargetId},${scope.targetId},'facebook',${author},'started')`;
    const outcome = await executeFacebookNativeWithJournal(scope, { format: 'video', targetId: scope.remoteTargetId, description: 'Synthetic', scheduledUnix: null,
      media: { kind: 'video', url: 'https://example.invalid/synthetic.mp4', sizeBytes: 3 } }, {
      database: db, limits: async () => ({ timeout: 10_000, maxWait: 5_000 }),
      transport: { postGraph: async () => ({ id: `final_${id}` }), upload: async () => {} },
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
  it('requires actual active Root and exact current revision confirmation before GET', async () => {
    const scope = await fixture();
    await expect(refreshFacebookNativeStatus(author, await action(scope))).rejects.toMatchObject({ code: 'forbidden' });
    const stale = await action(scope);
    await db.$executeRaw`UPDATE rebuild_facebook_native_journal SET revision=revision+1,"updatedAt"=clock_timestamp() WHERE "operationId"=${scope.operationId}`;
    await expect(refreshFacebookNativeStatus(root, stale)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(shared.reads).toBe(0); expect(await proofs(scope)).toHaveLength(0);
  });
  it('accepts final identity proof from a Root observer distinct from the publication author', async () => {
    const scope = await fixture();
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: true, state: 'confirmed' });
    const [proof] = await proofs(scope);
    expect(proof).toMatchObject({ actorId: root, accepted: true, outcome: 'published', remoteTargetId: scope.remoteTargetId });
    expect((await journal(scope))).toMatchObject({ actorId: author, state: 'confirmed', revision: proof.appliedRevision });
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'PUBLISHED', proof.remoteId))).resolves.toBeUndefined();
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'PUBLISHED', 'wrong-final'))).rejects.toMatchObject({ code: 'conflict' });
    // Parent outcome is deliberately still unresolved; proof alone cannot release erasure.
    await expect(db.$transaction(tx => assertFacebookNativeSettled(tx, scope.workspaceId))).rejects.toMatchObject({ code: 'conflict' });
    expect(await db.$queryRaw`SELECT id FROM root_activities WHERE "actorId"=${root} AND action='facebook.native_status_observed' AND detail->>'operationId'=${scope.operationId}`).toHaveLength(1);
  });
  it('recovers a submitted native parent only after accepted proof and exact-identity Root attestation', async () => {
    const scope = await fixture(); const child = await journal(scope);
    await db.$executeRaw`UPDATE rebuild_publication_attempts SET state='submitted',reason='provider_submission',"remotePostId"=${child.remoteId},"receiptAt"=clock_timestamp() WHERE id=${scope.operationId}`;
    const finish = { operationId: scope.operationId, confirmation: `ROOT FINISH PUBLICATION ${scope.operationId}` };
    const record = { operationId: scope.operationId, outcome: 'PUBLISHED', remotePostId: child.remoteId,
      verifiedExternally: true, confirmation: `ROOT RECORD PUBLICATION ${scope.operationId} PUBLISHED` };
    await expect(finishRootPublicationProjection(root, finish)).rejects.toMatchObject({ code: 'conflict' });
    await expect(recordRootPublicationOutcome(root, record)).rejects.toMatchObject({ code: 'conflict' });
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: true });
    await expect(recordRootPublicationOutcome(root, { ...record, remotePostId: 'different-final-id' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(recordRootPublicationOutcome(root, { operationId: scope.operationId, outcome: 'ABSENT', verifiedExternally: true,
      confirmation: `ROOT RECORD PUBLICATION ${scope.operationId} ABSENT` })).rejects.toMatchObject({ code: 'conflict' });
    await expect(recordRootPublicationOutcome(root, record)).resolves.toMatchObject({ state: 'receipt_recorded' });
    expect(await db.postTarget.findUnique({ where: { id: scope.postTargetId } })).toMatchObject({ status: 'processing', remotePostId: null });
    await expect(finishRootPublicationProjection(root, finish)).resolves.toMatchObject({ ok: true, state: 'projected' });
    expect(await db.postTarget.findUnique({ where: { id: scope.postTargetId } })).toMatchObject({ status: 'published', remotePostId: child.remoteId });
    await expect(db.$transaction(tx => assertFacebookNativeSettled(tx, scope.workspaceId))).resolves.toBeUndefined();
    expect(shared.reads).toBe(1);
  });
  it.each(['scheduled', 'wrong_page', 'error'])('retains %s observations without accepting or releasing the publication', async response => {
    const scope = await fixture(); shared.response = response;
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: false, state: 'needs_review' });
    expect(await proofs(scope)).toMatchObject([{ accepted: false, appliedRevision: null }]);
    expect((await journal(scope)).state).toBe('uncertain');
  });
  it('keeps a late positive observation when the journal revision changes during GET', async () => {
    const scope = await fixture(); shared.onRead = async () => {
      await db.$executeRaw`UPDATE rebuild_facebook_native_journal SET revision=revision+1,"updatedAt"=clock_timestamp() WHERE "operationId"=${scope.operationId}`;
    };
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: false });
    expect(await proofs(scope)).toMatchObject([{ outcome: 'published', accepted: false }]);
    expect((await journal(scope)).state).toBe('uncertain');
  });
  it('keeps the observation but refuses acceptance after current credentials become invalid', async () => {
    const scope = await fixture(); shared.denyAfterRead = true;
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: false });
    expect(await proofs(scope)).toMatchObject([{ outcome: 'published', accepted: false }]);
  });
  it('retains an audited unknown hold without GET when authority expires after preparation', async () => {
    const scope = await fixture(); shared.denyBeforeRead = true;
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: false, state: 'needs_review' });
    expect(shared.reads).toBe(0);
    expect(await proofs(scope)).toEqual([expect.objectContaining({ accepted: false, outcome: 'unknown', detail: 'aborted' })]);
    expect(await journal(scope)).toMatchObject({ state: 'uncertain' });
    const audits = await db.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE "actorId"=${root} AND detail->>'operationId'=${scope.operationId}`;
    expect(audits.map(row => row.action)).toContain('facebook.native_status_observed');
  });
  it('serializes concurrent refreshes under the existing post/target operation authority', async () => {
    const scope = await fixture(), input = await action(scope);
    const results = await Promise.allSettled([refreshFacebookNativeStatus(root, input), refreshFacebookNativeStatus(root, input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(shared.reads).toBe(1); expect(await proofs(scope)).toHaveLength(1);
  });
  it('does not trust a confirmed child flag without an accepted proof', async () => {
    const scope = await fixture();
    await db.$executeRaw`UPDATE rebuild_facebook_native_journal SET state='confirmed',revision=revision+1,"updatedAt"=clock_timestamp() WHERE "operationId"=${scope.operationId}`;
    await expect(db.$transaction(tx => assertFacebookNativeResolution(tx, scope.workspaceId, scope.operationId, 'PUBLISHED', `final_${scope.workspaceId}`)))
      .rejects.toMatchObject({ code: 'conflict' });
  });
  it('rolls back child confirmation when proof persistence fails, then safely repeats only the GET', async () => {
    const scope = await fixture();
    const name = `native91_fault_${randomUUID().replaceAll('-', '')}`;
    // Trusted generated identifiers and a generated fixture ID only; no external text enters this DDL.
    await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."workspaceId" = '${scope.workspaceId}' THEN RAISE EXCEPTION 'synthetic proof write failure'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON rebuild_facebook_native_status_proofs FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
      await expect(refreshFacebookNativeStatus(root, await action(scope))).rejects.toThrow();
      expect((await journal(scope)).state).toBe('uncertain');
      expect(await proofs(scope)).toHaveLength(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON rebuild_facebook_native_status_proofs`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
    }
    expect(await refreshFacebookNativeStatus(root, await action(scope))).toMatchObject({ ok: true });
    expect(shared.reads).toBe(2); expect(await proofs(scope)).toHaveLength(1);
  });
  it('requires an accepted ledger record, rejects proof rewrites and includes scoped data control', async () => {
    const scope = await fixture(); await refreshFacebookNativeStatus(root, await action(scope));
    const [proof] = await proofs(scope);
    await expect(db.$executeRaw`UPDATE rebuild_facebook_native_status_proofs SET detail='changed' WHERE id=${proof.id}`).rejects.toThrow();
    await expect(db.$executeRaw`INSERT INTO rebuild_facebook_native_status_proofs
      SELECT ${randomUUID()},"workspaceId","operationId","observedRevision","appliedRevision","payloadHash",format,"remoteTargetId","remoteId","actorId",outcome,detail,"observedAt",accepted,"createdAt"
      FROM rebuild_facebook_native_status_proofs WHERE id=${proof.id}`).rejects.toThrow();
    const exported: any = await exportWorkspaceData({ userId: author, workspaceId: scope.workspaceId });
    expect(exported.legacyTables.rebuild_facebook_native_status_proofs).toHaveLength(1);
    const foreign = await fixture();
    await db.$transaction(tx => deleteWorkspaceDatabaseRows(tx, scope.workspaceId), { timeout: 15_000 });
    expect(await proofs(scope)).toHaveLength(0); expect(await journal(foreign)).toBeTruthy();
  });
});
