import { enqueueChatEvent } from '@/modules/notifications/chat-channels/server/delivery';
vi.mock('@/modules/notifications/chat-channels/server/delivery', () => ({ enqueueChatEvent: vi.fn(async () => 1) }));
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaults, install, state } from './sharing-helpers';

vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({provider:{in:['test-provider']}}) }));
const alerts = vi.hoisted(() => ({ emit: vi.fn(async () => ({ queued: 1 })) }));
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: alerts.emit }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (defaults as Record<string, unknown>)[key], runtimeConfigBatch: async (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, (defaults as Record<string, unknown>)[key]])) }));
vi.mock('@/server/entitlements', async () => (await import('./sharing-helpers')).entitlementMock());
vi.mock('@/server/permissions', async () => (await import('./sharing-helpers')).permissionMock());
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: state.scope }) }));
vi.mock('@/server/data-control/guard', async () => {
  const { OperationError } = await import('@/lib/operation-error');
  return { assertWorkspaceNotPurging: async () => { if (state.purging) throw new OperationError('conflict', 'Workspace data deletion is in progress.'); }, withWorkspaceOperation: async () => { throw new Error('sharing must not nest the workspace operation helper'); } };
});

import { hit, reset } from '../src/server/rate-limit';
import { publicLimiterSize, resetPublicLimits } from '../src/modules/sharing/server/rate';
import { linkShowsImage, loadPublicView, publicMode, resolvePublicLink, reviewNote, submitDecision } from '../src/modules/sharing/server/public';
import { REVIEW_NOTE_MAX, setReviewPort } from '../src/modules/sharing/server/review-port';
import { deleteBioPage, followBioLink, openPublicBio, readBioPage, resetBioAvailability, saveBioPage } from '../src/modules/sharing/server/bio';
import { isUnique, protect } from '../src/modules/sharing/server/access';
import { hashToken } from '../src/modules/sharing/contracts';
import { OperationError } from '../src/lib/operation-error';

const TOKEN = 'A'.repeat(43);
const IMAGE = '11111111-1111-1111-1111-111111111111';
const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const linkRow = (extra: object = {}) => ({ id: 'shl_1', workspaceId: 'workspace-a', kind: 'review', title: 'Spring', description: null, targetIds: ['t1'], daysBack: 7, daysAhead: 30, allowComments: true, decides: true, createdById: 'creator', tokenHash: hashToken(TOKEN), workspaceName: 'Acme', timezone: 'UTC', ...extra });
const post = (extra: object = {}) => ({ id: 'p1', message: 'Hello', firstComment: null, link: 'https://example.com/x', media: [{ kind: 'image', url: 'https://cdn.example.com/a.png' }, { kind: 'image', url: `media:${IMAGE}` }, { kind: 'video', url: 'media:22222222-2222-2222-2222-222222222222' }, { kind: 'video', url: 'http://insecure.example.com/v.mp4' }], status: 'pending_approval', scheduledAt: new Date(Date.now() + 3600_000), publishedAt: null, ...extra });
function world(opts: { link?: object | null; posts?: object[]; destinations?: Array<{ postId: string; targetId: string }>; targets?: Array<{ id: string; name: string; pictureUrl: string | null }>; live?: boolean; shown?: boolean } = {}) {
  state.respond = text => {
    if (text.includes('FROM share_links l JOIN workspaces')) return opts.link === null ? [] : [opts.link ?? linkRow()];
    if (text.includes('FROM share_links l JOIN memberships')) return opts.live === false ? [] : [{ id: 'shl_1' }];
    if (text.includes('FOR NO KEY UPDATE OF p')) return opts.shown === false ? [] : [{ id: 'p1' }];
    if (text.includes('FROM targets')) return opts.targets ?? [{ id: 't1', name: 'Acme Page', pictureUrl: 'https://img.example.com/p.png' }];
    if (text.includes('FROM posts p')) return opts.posts ?? [post()];
    if (text.includes('FROM post_targets')) return opts.destinations ?? [{ postId: 'p1', targetId: 't1' }];
    if (text.includes('FROM review_decisions')) return [];
    return undefined;
  };
}
/** Plays the Publishing lifecycle: both participant callbacks run on the same transaction client, in order. */
const review = vi.fn();
const lifecycle = async (_actor: unknown, _post: string, _decision: string, _note?: string, participant?: { before?: (tx: unknown, c: unknown) => Promise<void>; after?: (tx: unknown, c: unknown) => Promise<void> }) => {
  await participant?.before?.(db, {}); state.executions.push({ sql: 'POST STATUS CHANGED', values: [] }); await participant?.after?.(db, {}); return {};
};
beforeEach(() => { install(); reset(); resetPublicLimits(); resetBioAvailability(); review.mockReset().mockImplementation(lifecycle); setReviewPort({ review }); });

describe('public share links: creator authority and expiry', () => {
  it('stops serving when the creator is disabled, demoted, loses the feature or the workspace is erased', async () => {
    world(); state.disabled = true; expect(await resolvePublicLink(TOKEN, '2.2.2.2')).toEqual({ ok: false, reason: 'not_found' });
    state.disabled = false; state.role = 'editor'; expect(await resolvePublicLink(TOKEN, '2.2.2.3')).toEqual({ ok: false, reason: 'not_found' });
    state.role = 'none'; expect(await resolvePublicLink(TOKEN, '2.2.2.4')).toEqual({ ok: false, reason: 'not_found' });
    state.role = 'owner'; state.planDenied = ['settings/sharing']; expect(await resolvePublicLink(TOKEN, '2.2.2.5')).toEqual({ ok: false, reason: 'not_found' });
    state.planDenied = []; state.purging = true; expect(await resolvePublicLink(TOKEN, '2.2.2.6')).toEqual({ ok: false, reason: 'not_found' });
    state.purging = false; expect((await resolvePublicLink(TOKEN, '2.2.2.7')).ok).toBe(true);
  });
  it('keeps serving a link whose creator lost only the Bio feature', async () => {
    world(); state.planDenied = ['settings/bio']; expect((await resolvePublicLink(TOKEN, '2.2.2.8')).ok).toBe(true);
  });
  it('narrows visible channels to the creator current scope and drops decide power without approval permission', async () => {
    world({ link: linkRow({ targetIds: ['t1', 't2'] }), targets: [{ id: 't1', name: 'One', pictureUrl: null }, { id: 't2', name: 'Two', pictureUrl: null }] });
    state.scope = { all: false, ids: ['t1'] };
    const resolved = await resolvePublicLink(TOKEN, '3.3.3.3') as { ok: true; value: Parameters<typeof loadPublicView>[0] };
    expect(resolved.value.creatorScope).toEqual(['t1']);
    world({ link: linkRow({ targetIds: ['t1', 't2'] }), targets: [{ id: 't1', name: 'One', pictureUrl: null }, { id: 't2', name: 'Two', pictureUrl: null }], destinations: [{ postId: 'p1', targetId: 't1' }, { postId: 'p1', targetId: 't2' }] });
    const view = await loadPublicView(resolved.value, 'review');
    expect(view.posts[0]!.destinations.map(d => d.name)).toEqual(['One']); expect(view.posts[0]!.canDecide).toBe(false);
    state.canApprove = false; const again = await resolvePublicLink(TOKEN, '3.3.3.4') as { ok: true; value: { decides: boolean } };
    expect(again.value.decides).toBe(false);
  });
  it('rejects a row whose stored digest differs and reports links without expiry as expired', async () => {
    world({ link: linkRow({ tokenHash: 'f'.repeat(64) }) }); expect(await resolvePublicLink(TOKEN, '4.4.4.4')).toEqual({ ok: false, reason: 'not_found' });
    const { linkStatus } = await import('../src/modules/sharing/contracts');
    expect(linkStatus({ revokedAt: null, expiresAt: null })).toBe('expired');
    expect(linkStatus({ revokedAt: null, expiresAt: new Date(Date.now() + 1000) })).toBe('active');
  });
});

describe('public share links', () => {
  it('answers every unresolvable link identically and never reaches the database for malformed tokens', async () => {
    for (const bad of ['', 'short', 'x'.repeat(65), 'has space/slash', '../etc']) expect(await resolvePublicLink(bad, '1.1.1.1')).toEqual({ ok: false, reason: 'not_found' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    world({ link: null });
    expect(await resolvePublicLink(TOKEN, '1.1.1.1')).toEqual({ ok: false, reason: 'not_found' });
    const query = state.queries[0]!;
    expect(query.values).toContain(hashToken(TOKEN)); expect(query.values).not.toContain(TOKEN);
    for (const clause of ['"revokedAt" IS NULL', '"expiresAt" > NOW()', '"suspendedAt" IS NULL', 'workspace_data_purges']) expect(query.sql).toContain(clause);
  });

  it('rate-limits repeated opens per address before looking anything up, without affecting other addresses', async () => {
    world({ link: null });
    const results = [];
    for (let i = 0; i < 125; i += 1) results.push(await resolvePublicLink(TOKEN, '9.9.9.9'));
    expect(results.at(-1)).toEqual({ ok: false, reason: 'rate_limited' });
    expect((await resolvePublicLink(TOKEN, '8.8.8.8')).ok).toBe(false);
    expect(state.queries.length).toBeLessThan(125);
  });

  it('with an unknown address, gives each link its own bucket so one flood cannot lock out the others', async () => {
    world(); const other = 'B'.repeat(43);
    let last: unknown; for (let i = 0; i < 120 * 20 + 5; i += 1) last = await resolvePublicLink(TOKEN, null);
    expect(last).toEqual({ ok: false, reason: 'rate_limited' });
    world({ link: linkRow({ id: 'shl_2', tokenHash: hashToken(other) }) });
    expect((await resolvePublicLink(other, null)).ok).toBe(true);
  });

  it('creates no window for guessed tokens when the address is unknown, and a public flood never touches sign-in limits', async () => {
    world({ link: null }); const before = publicLimiterSize();
    for (let i = 0; i < 50; i += 1) await resolvePublicLink(`${String(i).padStart(2, '0')}${'C'.repeat(41)}`, null);
    expect(publicLimiterSize()).toBe(before);
    // Known addresses do create windows, but in the public store only: a login window survives a flood bigger than the store.
    expect(hit('login:victim', { limit: 5, windowMs: 600_000 }).remaining).toBe(4);
    for (let i = 0; i < 5200; i += 1) await resolvePublicLink(TOKEN, `10.${i >> 8}.${i & 255}.1`);
    expect(publicLimiterSize()).toBeLessThanOrEqual(defaults['sharing.rateStoreCapacity'] as number);
    expect(hit('login:victim', { limit: 5, windowMs: 600_000 }).remaining).toBe(3);
  });

  it('does not turn malformed stored selections into an all-channel grant', async () => {
    for (const targetIds of [null, {}, [null], ['t1', 7]]) {
      world({ link: linkRow({ targetIds }) });
      expect(await resolvePublicLink(TOKEN, null)).toEqual({ ok: false, reason: 'not_found' });
    }
    world({ link: linkRow({ targetIds: [] }) });
    expect((await resolvePublicLink(TOKEN, null)).ok).toBe(true); // intentional legacy all-channel selection
  });

  it('serves nothing unless the creator can currently read the Publishing features of this kind', async () => {
    world(); state.readDenied = ['publishing/approvals']; expect(await resolvePublicLink(TOKEN, '5.5.5.1')).toEqual({ ok: false, reason: 'not_found' });
    state.readDenied = []; state.planDenied = ['publishing/approvals']; expect(await resolvePublicLink(TOKEN, '5.5.5.2')).toEqual({ ok: false, reason: 'not_found' });
    state.planDenied = []; expect((await resolvePublicLink(TOKEN, '5.5.5.3')).ok).toBe(true);
    world({ link: linkRow({ kind: 'calendar', decides: false }) }); state.readDenied = ['publishing/calendar']; expect((await resolvePublicLink(TOKEN, '5.5.5.4')).ok).toBe(false);
    state.readDenied = ['publishing/approvals']; expect((await resolvePublicLink(TOKEN, '5.5.5.5')).ok).toBe(true);
    world({ link: linkRow({ kind: 'portal' }) }); state.readDenied = ['publishing/calendar']; expect((await resolvePublicLink(TOKEN, '5.5.5.6')).ok).toBe(false);
  });

  it('keeps image requests out of the page-open allowance', async () => {
    world({ link: null }); for (let i = 0; i < 130; i += 1) await resolvePublicLink(TOKEN, '6.6.6.6');
    expect(await resolvePublicLink(TOKEN, '6.6.6.6')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(await resolvePublicLink(TOKEN, '6.6.6.6', 'media')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('shows only scoped content without internals, and previews uploaded images by id only', async () => {
    world(); const resolved = await resolvePublicLink(TOKEN, null); expect(resolved.ok).toBe(true);
    const view = await loadPublicView((resolved as { ok: true; value: Parameters<typeof loadPublicView>[0] }).value, 'review');
    const text = JSON.stringify(view);
    expect(view.posts[0]).toMatchObject({ id: 'p1', status: 'awaiting_review', canDecide: true, uploadedMediaCount: 2, uploadedImages: [IMAGE], destinations: [{ name: 'Acme Page' }] });
    expect(view.posts[0]!.media).toEqual([{ kind: 'image', url: 'https://cdn.example.com/a.png' }]);
    for (const secret of ['tokenHash', 'authorId', 'accessToken', 'remotePostId', 'creator', 'insecure.example.com', 'media:1111']) expect(text).not.toContain(secret);
    expect(state.queries.find(q => q.sql.includes('FROM posts p'))!.values).toContain('workspace-a');
  });

  it('never selects drafts, rejected or failed posts for any view', async () => {
    world(); const resolved = await resolvePublicLink(TOKEN, null) as { ok: true; value: Parameters<typeof loadPublicView>[0] };
    await loadPublicView(resolved.value, 'review'); await loadPublicView(resolved.value, 'calendar');
    const statuses = state.queries.filter(q => q.sql.includes('FROM posts p')).flatMap(q => q.values.filter(Array.isArray) as string[][]).filter(list => list.includes('scheduled') || list.includes('pending_approval')).map(list => list.join(','));
    expect(statuses).toEqual(['pending_approval', 'scheduled,published']);
    const joined = statuses.join(','); for (const hidden of ['draft', 'rejected', 'failed', 'partially_failed']) expect(joined).not.toContain(hidden);
  });

  it('serves an uploaded image only while a post the link shows references it', async () => {
    world(); const resolved = await resolvePublicLink(TOKEN, null) as { ok: true; value: Parameters<typeof loadPublicView>[0] };
    expect(await linkShowsImage(resolved.value, IMAGE)).toBe(true);
    expect(await linkShowsImage(resolved.value, IMAGE.toUpperCase())).toBe(true);
    expect(await linkShowsImage(resolved.value, '33333333-3333-3333-3333-333333333333')).toBe(false);
    expect(await linkShowsImage(resolved.value, '22222222-2222-2222-2222-222222222222')).toBe(false); // a video, not previewable
    expect(await linkShowsImage(resolved.value, '../etc/passwd')).toBe(false);
  });

  it('shows nothing when every selected channel has since been disabled', async () => {
    world({ targets: [] }); const resolved = await resolvePublicLink(TOKEN, null) as { ok: true; value: Parameters<typeof loadPublicView>[0] };
    expect((await loadPublicView(resolved.value, 'review')).posts).toEqual([]);
    expect(state.queries.some(q => q.sql.includes('FROM posts p'))).toBe(false);
  });

  it('does not let a client decide posts that also go to channels outside the link', async () => {
    world({ destinations: [{ postId: 'p1', targetId: 't1' }, { postId: 'p1', targetId: 'other' }] });
    const resolved = await resolvePublicLink(TOKEN, null) as { ok: true; value: Parameters<typeof loadPublicView>[0] };
    const [first] = (await loadPublicView(resolved.value, 'review')).posts;
    expect(first!.canDecide).toBe(false); expect(first!.destinations).toEqual([{ name: 'Acme Page', pictureUrl: 'https://img.example.com/p.png' }]);
    const answer = await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' }).catch(e => e);
    expect(answer).toMatchObject({ code: 'conflict' }); expect(review).not.toHaveBeenCalled();
  });

  it('approves through the review port as the link creator and stores the answer in the same review', async () => {
    world();
    const result = await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' });
    expect(result).toMatchObject({ ok: true, value: { applied: true, decision: 'approved' } });
    expect(review).toHaveBeenCalledWith({ userId: 'creator', workspaceId: 'workspace-a' }, 'p1', 'approve', 'Approved by client via share link', expect.objectContaining({ before: expect.any(Function), after: expect.any(Function) }));
    const order = state.executions.map(e => e.sql.includes('INSERT INTO review_decisions') ? 'stored' : e.sql.includes('activity_logs') ? 'audit' : e.sql);
    expect(order).toEqual(['POST STATUS CHANGED', 'stored', 'audit']);
    const audited = state.executions.find(e => e.sql.includes('activity_logs'))!;
    expect(audited.values).toContain('sharing.client_answer_recorded');
    expect(JSON.stringify(audited.values)).not.toContain('Pat');
    const insert = state.executions.find(e => e.sql.includes('INSERT INTO review_decisions'))!;
    expect(insert.values).toEqual(expect.arrayContaining(['shl_1', 'p1', 'approved', 'Pat']));
    expect(enqueueChatEvent).toHaveBeenCalledWith(db, expect.objectContaining({ eventId: insert.values[0], workspaceId: 'workspace-a', event: 'reviewDecision', source: expect.objectContaining({postId:'p1'}) }));
    expect(JSON.stringify(vi.mocked(enqueueChatEvent).mock.calls)).not.toContain('Pat');
    expect(JSON.stringify(state.executions)).not.toContain(TOKEN);
    // The pool is never held by sharing while the lifecycle runs.
    expect(state.transactions).toBe(0);
  });

  it('re-checks under a row lock that the link is still live, so a racing revocation wins completely', async () => {
    world({ live: false });
    expect(await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' })).toEqual({ ok: false, reason: 'not_found' });
    expect(state.executions.some(e => e.sql.includes('INSERT INTO review_decisions') || e.sql === 'POST STATUS CHANGED')).toBe(false);
    const lock = state.queries.find(q => q.sql.includes('FROM share_links l JOIN memberships'))!;
    for (const clause of ['"revokedAt" IS NULL', '"expiresAt" > NOW()', 'decides = true', 'l."tokenHash" =', '"suspendedAt" IS NULL', '"disabledAt" IS NULL', 'FOR SHARE OF']) expect(lock.sql).toContain(clause);
    expect(lock.values).toContain(hashToken(TOKEN));
  });

  it('refuses a rotated token between resolve and mutation: the locked check compares the presented digest', async () => {
    world(); const rotated = hashToken('R'.repeat(43));
    // The locking SQL only matches the presented digest; a database whose stored digest changed returns no row.
    review.mockImplementation(async (_a, _p, _d, _n, participant) => { await participant.before(db, {}); });
    state.respond = text => {
      if (text.includes('FROM share_links l JOIN workspaces')) return [linkRow()];
      if (text.includes('FROM share_links l JOIN memberships')) return [];
      if (text.includes('FROM targets')) return [{ id: 't1', name: 'Acme Page', pictureUrl: null }];
      if (text.includes('FROM posts p')) return [post()];
      if (text.includes('FROM post_targets')) return [{ postId: 'p1', targetId: 't1' }];
      return undefined;
    };
    expect(await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' })).toEqual({ ok: false, reason: 'not_found' });
    expect(state.queries.find(q => q.sql.includes('FROM share_links l JOIN memberships'))!.values).not.toContain(rotated);
    expect(state.executions.some(e => e.sql.includes('INSERT INTO review_decisions'))).toBe(false);
  });

  it('serialises plain comments with the same fresh checks, one transaction, a content-free audit and no body in the audit', async () => {
    world({ link: linkRow({ decides: false }) });
    const result = await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'Secret client wording' });
    expect(result).toMatchObject({ ok: true, value: { applied: false, decision: 'comment' } });
    expect(state.transactions).toBe(1);
    expect(state.queries.some(q => q.sql.includes('FROM share_links l JOIN memberships') && q.values.includes(hashToken(TOKEN)))).toBe(true);
    const audited = state.executions.find(e => e.sql.includes('activity_logs'))!;
    expect(audited.values).toContain('sharing.client_answer_recorded'); expect(JSON.stringify(audited.values)).not.toContain('Secret'); expect(JSON.stringify(audited.values)).not.toContain('Pat');
    expect(audited.values.join('|')).toContain('"reason":"comment"');
    // The link was revoked or rotated or the creator lost their role after resolve: nothing is stored.
    state.executions.length = 0; world({ link: linkRow({ decides: false }), live: false });
    expect(await submitDecision(TOKEN, 'b', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'late' })).toEqual({ ok: false, reason: 'not_found' });
    expect(state.executions).toEqual([]);
    world({ link: linkRow({ decides: false }), shown: false });
    expect(await submitDecision(TOKEN, 'c', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'late' })).toEqual({ ok: false, reason: 'not_found' });
    expect(state.executions).toEqual([]);
  });

  it('checks channel coverage and the pending state again under the lock, and only decisions require full coverage', async () => {
    world({ link: linkRow({ targetIds: ['t1'] }) });
    await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' });
    const lock = state.queries.find(q => q.sql.includes('FOR NO KEY UPDATE OF p') && q.sql.includes('NOT EXISTS (SELECT 1 FROM post_targets pt2'))!;
    expect(lock.sql).toContain("p.status::text = ANY("); expect(lock.sql).toContain('NOT EXISTS (SELECT 1 FROM post_targets pt2'); expect(lock.values).toContainEqual(['pending_approval']);
    expect(lock.values).toContainEqual(['t1']);
    expect(lock.sql).toContain('NOT COALESCE(t2.enabled = true');
    const firstPostLock = state.queries.findIndex(q=>q.sql.includes('FOR NO KEY UPDATE OF p'));
    const mutationChannels = state.queries.findIndex((q,index)=>index>firstPostLock && q.sql.includes('FROM targets'));
    expect(mutationChannels).toBeGreaterThan(firstPostLock);
  });

  it('stores nothing and reports the failure when the answer cannot be written atomically with an approval', async () => {
    world(); state.executions.length = 0;
    db.$executeRaw.mockImplementationOnce(async () => 0);
    review.mockImplementation(async (_a: unknown, _p: string, _d: string, _n: string | undefined, participant: { before?: (tx: unknown, c: unknown) => Promise<void>; after?: (tx: unknown, c: unknown) => Promise<void> }) => { await participant.before?.(db, {}); await participant.after?.(db, {}); });
    // The failed store aborted the whole review: the answer is NOT acknowledged as advice, the visitor is told it is unconfirmed.
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' })).rejects.toMatchObject({ code: 'upstream_failure' });
    expect(state.executions).toEqual([]);
    expect(state.transactions).toBe(0);
  });

  it('only a policy refusal becomes advice; database, participant and unknown failures are reported as unconfirmed and store nothing', async () => {
    for (const failure of [new Error('connection lost'), new OperationError('unavailable', 'x'), new OperationError('upstream_failure', 'x'), new OperationError('invalid_request', 'x')]) {
      world(); state.executions.length = 0; review.mockReset().mockRejectedValue(failure);
      await expect(submitDecision(TOKEN, `k${Math.random()}`, { postId: 'p1', decision: 'approved', authorName: 'Pat' })).rejects.toMatchObject({ code: 'upstream_failure' });
      expect(state.executions).toEqual([]); expect(state.transactions).toBe(0);
    }
    for (const code of ['forbidden', 'unauthorized'] as const) {
      world(); state.executions.length = 0; const previousTransactions = state.transactions; review.mockReset().mockRejectedValue(new OperationError(code, 'no'));
      expect(await submitDecision(TOKEN, `p${code}`, { postId: 'p1', decision: 'approved', authorName: 'Pat' })).toMatchObject({ ok: true, value: { applied: false } });
      const audited = state.executions.find(e => e.sql.includes('activity_logs'))!;
      expect(audited.values.join('|')).toContain('"reason":"authority_refused"'); expect(state.transactions).toBe(previousTransactions + 1);
    }
  });

  it('records advice only in its own atomic transaction: a failed audit stores no answer and is not acknowledged', async () => {
    world({ link: linkRow({ decides: false }) }); state.failAudit = true;
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'hi' })).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('requires a reason for change requests and keeps long comments inside the review note limit', async () => {
    world();
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'rejected', authorName: 'Pat' })).rejects.toMatchObject({ code: 'invalid_request' });
    await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'rejected', authorName: 'Pat', comment: 'Fix logo' });
    expect(review).toHaveBeenCalledWith(expect.anything(), 'p1', 'reject', 'Changes requested by client via share link', expect.anything());
    await submitDecision(TOKEN, 'b', { postId: 'p1', decision: 'rejected', authorName: 'Pat', comment: 'x'.repeat(1500) });
    // A long comment still settles the post: the lifecycle note is a fixed marker and the full body is kept only in review_decisions.
    const note = review.mock.calls.at(-1)![3] as string;
    expect(note.length).toBeLessThanOrEqual(REVIEW_NOTE_MAX); expect(note).not.toContain('xxx'); expect(note).not.toContain('Pat');
    expect(state.executions.filter(e => e.sql.includes('INSERT INTO review_decisions')).at(-1)!.values).toContain('x'.repeat(1500));
    expect(JSON.stringify(state.executions.filter(e => e.sql.includes('activity_logs')))).not.toContain('xxx');
  });

  it('keeps the review note limit in step with the Publishing lifecycle', () => {
    const source = readFileSync(new URL('../src/modules/publishing/server/lifecycle.ts', import.meta.url), 'utf8');
    expect(Number(/reviewNote\.length > (\d+)/.exec(source)?.[1])).toBe(REVIEW_NOTE_MAX);
    expect(reviewNote('approved').length).toBeLessThanOrEqual(REVIEW_NOTE_MAX); expect(reviewNote('rejected').length).toBeLessThanOrEqual(REVIEW_NOTE_MAX);
  });

  it('keeps the answer as advice, honestly, when the creator can no longer approve', async () => {
    world(); review.mockRejectedValue(new OperationError('forbidden', 'no'));
    const result = await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' });
    expect(result).toMatchObject({ ok: true, value: { applied: false } });
    expect((result as { value: { message: string } }).value.message).toContain('final call');
    expect(state.executions.some(e => e.sql.includes('INSERT INTO review_decisions'))).toBe(true);
  });

  it('reports a conflict, records nothing, when the post was already settled', async () => {
    world(); review.mockRejectedValue(new OperationError('conflict', 'settled'));
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' })).rejects.toMatchObject({ code: 'conflict' });
    expect(state.executions.some(e => e.sql.includes('review_decisions'))).toBe(false);
  });

  it('fails visibly when plain advice cannot be stored', async () => {
    world({ link: linkRow({ decides: false }) }); db.$executeRaw.mockImplementationOnce(async () => { throw new Error('down'); });
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'hi' })).rejects.toMatchObject({ code: 'upstream_failure' });
  });

  it('treats a non-deciding link, comments-off and calendar links safely', async () => {
    world({ link: linkRow({ decides: false }) });
    expect(await submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat' })).toMatchObject({ ok: true, value: { applied: false } });
    expect(review).not.toHaveBeenCalled();
    world({ link: linkRow({ allowComments: false }) });
    await expect(submitDecision(TOKEN, 'b', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'hi' })).rejects.toMatchObject({ code: 'invalid_request' });
    world({ link: linkRow({ kind: 'calendar' }) });
    expect(await submitDecision(TOKEN, 'c', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'hi' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('answers not found for posts outside the link and rejects malformed or unknown input', async () => {
    world({ posts: [] });
    expect(await submitDecision(TOKEN, 'a', { postId: 'other', decision: 'approved', authorName: 'Pat' })).toEqual({ ok: false, reason: 'not_found' });
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'approved', authorName: 'Pat', extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(submitDecision(TOKEN, 'a', { postId: 'p1', decision: 'nope', authorName: 'Pat' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('throttles decision floods per address', async () => {
    world(); let last: unknown;
    for (let i = 0; i < 32; i += 1) last = await submitDecision(TOKEN, 'z', { postId: 'p1', decision: 'comment', authorName: 'Pat', comment: 'x' });
    expect(last).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('offers only review and calendar tabs for portals', () => {
    expect(publicMode({ kind: 'portal' }, 'results')).toBe('review'); expect(publicMode({ kind: 'portal' }, 'calendar')).toBe('calendar');
    expect(publicMode({ kind: 'calendar' }, 'review')).toBe('calendar'); expect(publicMode({ kind: 'review' }, 'calendar')).toBe('review');
  });
});

describe('unique violation mapping', () => {
  it('recognises model, raw-query and driver unique errors and maps them to a conflict', async () => {
    expect(isUnique({ code: 'P2002' })).toBe(true); expect(isUnique({ code: '23505' })).toBe(true);
    expect(isUnique({ code: 'P2010', meta: { code: '23505' } })).toBe(true);
    expect(isUnique({ code: 'P2010', meta: { message: 'ERROR: duplicate key (code 23505)' } })).toBe(true);
    expect(isUnique({ code: 'P2010', meta: { code: '40001' } })).toBe(false); expect(isUnique(null)).toBe(false);
    await expect(protect(Promise.reject({ code: 'P2010', meta: { code: '23505' } }), 'taken')).rejects.toMatchObject({ code: 'conflict', message: 'taken' });
    await expect(protect(Promise.reject(new Error('boom')))).rejects.toMatchObject({ code: 'upstream_failure' });
  });
});

describe('public bio', () => {
  const page = { id: 'b1', workspaceId: 'workspace-a', title: 'Acme', description: null, avatarUrl: null };
  const bioWorld = (extra: (text: string) => unknown = () => undefined) => { state.respond = text => extra(text) ?? (text.startsWith('SELECT b."workspaceId"') ? [{ workspaceId: 'workspace-a' }] : text.includes('FROM bio_pages b JOIN') ? [page] : text.includes('FROM bio_links') ? [{ id: 'l1', label: 'Shop' }] : undefined); };
  it('shows labels only and answers identically for missing, disabled and malformed slugs', async () => {
    bioWorld(); const open = await openPublicBio('acme', null); expect(open).toMatchObject({ ok: true }); expect(JSON.stringify(open)).not.toContain('http');
    state.respond = text => text.includes('FROM bio_pages b JOIN') ? [] : undefined;
    expect(await openPublicBio('missing', null)).toEqual({ ok: false, reason: 'not_found' });
    expect(await openPublicBio('Bad Slug!', null)).toEqual({ ok: false, reason: 'not_found' });
  });
  it('serves only https bio avatars', async () => {
    bioWorld(text => text.includes('FROM bio_pages b JOIN') ? [{ ...page, avatarUrl: 'http://x.example/a.png' }] : undefined);
    expect(await openPublicBio('acme', '5.5.5.5')).toMatchObject({ ok: true, value: { avatarUrl: null } });
  });
  it('stops serving when no active owner still has the Bio feature, and caches only refusals for the Root interval', async () => {
    bioWorld(); state.planDenied = ['settings/bio'];
    expect(await openPublicBio('acme', '7.7.7.7')).toEqual({ ok: false, reason: 'not_found' });
    expect(await followBioLink('acme', 'l1', '7.7.7.7')).toBeNull();
    expect(state.queries.some(q => q.sql.includes('UPDATE bio_links'))).toBe(false);
    state.planDenied = []; expect(await openPublicBio('acme', '7.7.7.8')).toEqual({ ok: false, reason: 'not_found' }); // cached refusal
    resetBioAvailability(); expect((await openPublicBio('acme', '7.7.7.9')).ok).toBe(true);
    state.planDenied = ['settings/bio']; expect((await openPublicBio('acme', '7.7.7.10')).ok).toBe(false); // successful grants are never cached
  });
  it('is unavailable when the workspace has no active owner', async () => {
    bioWorld(); state.role = 'admin';
    expect(await openPublicBio('acme', '4.4.4.9')).toEqual({ ok: false, reason: 'not_found' });
  });
  it('gives each bio page its own bucket when the visitor address is unknown', async () => {
    bioWorld(); let last: unknown; for (let i = 0; i < 120 * 20 + 3; i += 1) last = await openPublicBio('acme', null);
    expect(last).toEqual({ ok: false, reason: 'rate_limited' });
    expect((await openPublicBio('other', null)).ok).toBe(true);
  });
  it('creates no window for guessed slugs when the address is unknown', async () => {
    state.respond = () => []; const before = publicLimiterSize();
    for (let i = 0; i < 40; i += 1) await openPublicBio(`guess-${i}`, null);
    expect(publicLimiterSize()).toBe(before);
  });

  it('redirects and counts within the window, then still redirects without counting', async () => {
    bioWorld(text => text.includes('UPDATE bio_links') || text.includes('SELECT l.url') ? [{ url: 'https://shop.example.com/' }] : undefined);
    for (let i = 0; i < 60; i += 1) expect(await followBioLink('acme', 'l1', '5.5.5.5')).toBe('https://shop.example.com/');
    expect(state.queries.filter(q => q.sql.includes('UPDATE bio_links')).length).toBe(60);
    expect(await followBioLink('acme', 'l1', '5.5.5.5')).toBe('https://shop.example.com/');
    expect(state.queries.filter(q => q.sql.includes('UPDATE bio_links')).length).toBe(60);
    expect(state.queries.find(q => q.sql.includes('UPDATE bio_links'))!.sql).toContain('LEAST');
    expect(state.queries.find(q => q.sql.includes('UPDATE bio_links'))!.sql).toContain('enabled = true');
  });

  it('returns null for unknown links, malformed ids and unsafe stored addresses', async () => {
    bioWorld(text => text.startsWith('SELECT b."workspaceId"') ? [] : undefined);
    expect(await followBioLink('acme', 'nope', '1.1.1.1')).toBeNull(); expect(await followBioLink('acme', '../x', '1.1.1.1')).toBeNull();
    bioWorld(text => text.includes('UPDATE bio_links') ? [{ url: 'javascript:alert(1)' }] : undefined);
    expect(await followBioLink('acme', 'l1', '2.2.2.2')).toBeNull();
  });

  const save = { slug: 'acme', title: 'Acme', links: [{ label: 'Shop', url: 'https://shop.example.com' }], confirmation: 'SAVE BIO PAGE acme' };
  it('validates addresses, confirmation and slug ownership, preserves clicks, audits without secrets', async () => {
    await expect(saveBioPage(actor, { ...save, confirmation: 'x' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(saveBioPage(actor, { ...save, links: [{ label: 'x', url: 'javascript:alert(1)' }] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(saveBioPage(actor, { ...save, links: [{ label: 'x', url: 'https://user:pw@example.com' }] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(saveBioPage(actor, { ...save, avatarUrl: 'http://example.com/a.png' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.respond = text => text.includes('"workspaceId" <>') ? [{ workspaceId: 'other' }] : undefined;
    await expect(saveBioPage(actor, save)).rejects.toMatchObject({ code: 'conflict' });
    state.respond = text => text.includes('"workspaceId" <>') ? [] : text.includes('INSERT INTO bio_pages') ? [{ id: 'b1' }] : text.includes('SELECT id, label, url, clicks') ? [{ id: 'bl_old', label: 'Shop', url: 'https://shop.example.com/', clicks: 7 }] : undefined;
    await expect(saveBioPage(actor, save)).resolves.toMatchObject({ slug: 'acme', linkCount: 1 });
    // Unchanged label+address keeps both its id (printed redirect addresses survive) and its click total.
    expect(state.executions.find(e => e.sql.includes('INSERT INTO bio_links'))!.values).toEqual(expect.arrayContaining(['bl_old', 7]));
    expect(state.executions.some(e => String(e.values[3]) === 'sharing.bio_saved')).toBe(true);
  });

  it('maps a database-level slug collision to a conflict', async () => {
    state.respond = text => { if (text.includes('INSERT INTO bio_pages')) throw Object.assign(new Error('dup'), { code: 'P2010', meta: { code: '23505' } }); return text.includes('"workspaceId" <>') ? [] : undefined; };
    await expect(saveBioPage(actor, save)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('limits managers to owners/admins with the Bio feature and requires the live slug to delete', async () => {
    state.role = 'editor'; await expect(readBioPage(actor)).rejects.toMatchObject({ code: 'forbidden' }); await expect(saveBioPage(actor, save)).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'owner'; state.writeDenied = ['settings/bio']; await expect(saveBioPage(actor, save)).rejects.toMatchObject({ code: 'forbidden' });
    state.writeDenied = []; state.respond = text => text.includes('FROM bio_pages WHERE "workspaceId"') ? [{ id: 'b1', slug: 'acme' }] : undefined;
    await expect(deleteBioPage(actor, { confirmation: 'DELETE BIO PAGE other' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(deleteBioPage(actor, { confirmation: 'DELETE BIO PAGE acme' })).resolves.toMatchObject({ deleted: true });
    expect(state.executions.some(e => e.sql.includes('DELETE FROM bio_pages') && e.values.includes('workspace-a'))).toBe(true);
  });

  it('caps what a result-limited key can read from the owner view', async () => {
    state.respond = text => text.includes('FROM bio_pages WHERE "workspaceId"') ? [{ id: 'b1', slug: 'acme', title: 'T', description: null, avatarUrl: null, enabled: true }] : text.includes('FROM bio_links WHERE "pageId"') ? [{ id: 'l1', label: 'A', url: 'https://a.example', position: 0, clicks: 1 }, { id: 'l2', label: 'B', url: 'https://b.example', position: 1, clicks: 2 }] : undefined;
    const view = await readBioPage(actor, { maxItems: 1 });
    expect(view.links).toHaveLength(1); expect(view.truncated).toBe(true);
  });
});

 describe('advisory client decision notifications', () => {
  it('queues advisory decisions atomically with the answer and leaves comments quiet', async () => {
    world({ link: linkRow({ decides: false }) });
    await submitDecision(TOKEN, '7.1.1.1', { postId: 'p1', authorName: 'Client', decision: 'rejected', comment: 'Please revise' });
    expect(alerts.emit).toHaveBeenCalledOnce();
    expect(alerts.emit).toHaveBeenCalledWith(db, expect.objectContaining({ workspaceId: 'workspace-a', postId: 'p1', kind: 'approval_decision' }));
    const eventId = (alerts.emit.mock.calls as unknown as Array<[unknown, { eventId: string }]>)[0]![1].eventId;
    expect(state.executions.find(e => e.sql.startsWith('INSERT INTO review_decisions'))!.values).toContain(eventId);
    alerts.emit.mockClear();
    await submitDecision(TOKEN, '7.1.1.2', { postId: 'p1', authorName: 'Client', decision: 'comment', comment: 'A note' });
    expect(alerts.emit).not.toHaveBeenCalled();
  });
  it('does not duplicate the Publishing lifecycle notification for applied answers', async () => {
    world();
    await submitDecision(TOKEN, '7.1.1.3', { postId: 'p1', authorName: 'Client', decision: 'approved' });
    expect(review).toHaveBeenCalledOnce();
    expect(alerts.emit).not.toHaveBeenCalled();
  });
  it('holds the answer as unconfirmed if queuing fails', async () => {
    world({ link: linkRow({ decides: false }) });
    alerts.emit.mockRejectedValueOnce(new Error('queue failed'));
    await expect(submitDecision(TOKEN, '7.1.1.4', { postId: 'p1', authorName: 'Client', decision: 'approved' })).rejects.toMatchObject({ code: 'upstream_failure' });
  });
 });

 describe('public workspace branding policy', () => {
  it('projects only an HTTPS workspace logo from the authorized link workspace', async () => {
    world({ link: linkRow({ workspaceLogoUrl: 'https://images.example.test/logo.png' }) });
    const access = await resolvePublicLink(TOKEN, '7.2.1.1');
    expect(access).toMatchObject({ ok: true, value: { workspaceLogoUrl: 'https://images.example.test/logo.png' } });
    expect(state.queries.find(q => q.sql.includes('FROM share_links l JOIN workspaces'))!.sql).toContain('w."logoUrl"');
    for (const workspaceLogoUrl of ['http://example.test/logo', 'javascript:alert(1)', 'https://secret@example.test/logo', 'data:image/png;base64,x']) {
      world({ link: linkRow({ workspaceLogoUrl }) });
      expect(await resolvePublicLink(TOKEN, '7.2.1.2')).toMatchObject({ ok: true, value: { workspaceLogoUrl: null } });
    }
  });
  it('consumes the Root logo switch, URL bound and advisory notice switch', async () => {
    const key = 'sharing.presentationPolicy'; const settings = defaults as Record<string, unknown>; const original = settings[key];
    try {
      settings[key] = { showWorkspaceLogo: false, logoUrlMaxCharacters: 64, advisoryDecisionNotificationsEnabled: false };
      world({ link: linkRow({ decides: false, workspaceLogoUrl: 'https://images.example.test/logo.png' }) });
      expect(await resolvePublicLink(TOKEN, '7.2.1.3')).toMatchObject({ ok: true, value: { workspaceLogoUrl: null } });
      await submitDecision(TOKEN, '7.2.1.3', { postId: 'p1', authorName: 'Client', decision: 'approved' });
      expect(alerts.emit).not.toHaveBeenCalled();
      settings[key] = { showWorkspaceLogo: true, logoUrlMaxCharacters: 64, advisoryDecisionNotificationsEnabled: true };
      world({ link: linkRow({ workspaceLogoUrl: 'https://images.example.test/' + 'x'.repeat(70) }) });
      expect(await resolvePublicLink(TOKEN, '7.2.1.4')).toMatchObject({ ok: true, value: { workspaceLogoUrl: null } });
      settings[key] = {};
      await expect(resolvePublicLink(TOKEN, '7.2.1.5')).rejects.toMatchObject({ code: 'unavailable' });
    } finally { settings[key] = original; }
  });
 });

 describe('existing saved sharing catalogs', () => {
  it('adds new French phrases while retaining valid saved overrides', async () => {
    const { loadOwnerCopy } = await import('@/modules/sharing/server/limits');
    const settings = defaults as Record<string, unknown>; const original = settings['sharing.ownerCopy'];
    try {
      settings['sharing.ownerCopy'] = { Title: { en: 'Campaign title', fr: 'Titre de campagne' } };
      const copy = await loadOwnerCopy('fr');
      expect(copy.Title).toBe('Titre de campagne');
      expect(copy['I confirm these changes. The address stays the same.']).toBe('Je confirme ces modifications. L’adresse reste identique.');
    } finally { settings['sharing.ownerCopy'] = original; }
  });
 });
