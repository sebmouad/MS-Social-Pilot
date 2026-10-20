import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), audit: vi.fn(), authorize: vi.fn(), credential: vi.fn(), adapter: vi.fn(),
  send: vi.fn(), classify: vi.fn(), operation: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: {
  postTarget: { findFirst: mocks.find }, $transaction: async (work: (tx: unknown) => unknown) => work(tx),
} }));
const tx = { postTarget: { updateMany: mocks.update }, $executeRaw: mocks.audit, $queryRaw: vi.fn() };
vi.mock('../src/modules/publishing/server/guard', () => ({
  withPublishingOperation: (...args: unknown[]) => mocks.operation(...args),
  withPublishingTransaction: async (_signal: unknown, work: (client: unknown) => unknown) => work(tx),
}));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: mocks.authorize }));
vi.mock('../src/modules/publishing/server/credentials', () => ({ readPublishingCredential: mocks.credential }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'publishing.maxFirstCommentDelayMinutes' ? 10080 : 2000 }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: mocks.adapter }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: vi.fn() }));

import { retryFirstComment, sendFirstComment, sendDueFirstComment } from '../src/modules/publishing/server/first-comment';
import { FIRST_COMMENT_REJECTED } from '../src/modules/publishing/first-comment-state';

const actor = { userId: 'author', workspaceId: 'workspace', allowedTargetIds: ['channel'] };
const input = { postId: 'post', postTargetId: 'destination', confirmation: 'RETRY FIRST COMMENT destination' };
function fixture() {
  return { id: 'destination', targetId: 'channel', status: 'published', formatId: 'post', remotePostId: 'remote-post',
    publishedAt: new Date(), firstCommentId: null as string | null, firstCommentAt: null as Date | null, firstCommentError: FIRST_COMMENT_REJECTED as string | null,
    post: { firstComment: 'Saved comment', authorId: 'author', format: 'post', firstCommentDelayMinutes: 10080 },
    target: { id: 'channel', workspaceId: 'workspace', providerId: 'remote-channel', type: 'channel', enabled: true, canPublish: true, accessToken: 'synthetic',
      socialAccount: { id: 'source', workspaceId: 'workspace', provider: 'synthetic', invalidatedAt: null, tokenExpiresAt: null, scopes: '' } },
  };
}
let row: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.clearAllMocks(); row = fixture();
  mocks.find.mockImplementation(async () => structuredClone(row));
  mocks.authorize.mockImplementation(async (currentActor: typeof actor) => ({ actor: currentActor, role: 'editor' }));
  mocks.operation.mockImplementation(async (currentActor, _options, work) => work({ actor: currentActor, role: 'editor', signal: new AbortController().signal }));
  mocks.credential.mockReturnValue({ accessToken: 'synthetic', grantedScopes: [] });
  mocks.adapter.mockResolvedValue({ publishFirstComment: mocks.send, classifyPublishingFailure: mocks.classify, supportsTargetKind: () => true,
    publishingFormats: [{ id: 'post', label: 'Post', media: { kinds: [], maxImages: 0, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }] });
  mocks.send.mockResolvedValue({ remoteId: 'comment-receipt' });
  mocks.classify.mockReturnValue('uncertain');
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (where.firstCommentAt !== undefined && row.firstCommentAt?.getTime() !== where.firstCommentAt?.getTime() ||
      where.firstCommentError !== undefined && row.firstCommentError !== where.firstCommentError || row.firstCommentId !== null) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
});

describe('deliberate first-comment retry service', () => {
  it('claims and audits a definite rejection before dispatch, overrides delay, and refuses a repeated retry', async () => {
    mocks.send.mockImplementation(async () => {
      expect(row.firstCommentAt).toBeInstanceOf(Date);
      expect(row.firstCommentError).toBeNull();
      expect(mocks.audit.mock.calls.some(call => call.includes('publishing.first_comment_retry_started'))).toBe(true);
      return { remoteId: 'comment-receipt' };
    });
    expect(await retryFirstComment(actor, input)).toMatchObject({ ok: true, state: 'sent' });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ remotePostId: 'remote-post', text: 'Saved comment' }));
    expect(row.firstCommentId).toBe('comment-receipt');
    await expect(retryFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.authorize).toHaveBeenCalledWith(actor, 'publishing/posts', 'write');
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ post: { workspaceId: 'workspace' }, target: { workspaceId: 'workspace' } }) }));
  });

  it.each([null, {}, { ...input, confirmation: 'SEND FIRST COMMENT destination' }, { ...input, confirmation: 'RETRY FIRST COMMENT other' }, { ...input, postId: ' ' }, { ...input, extra: true }])('rejects malformed or unconfirmed requests before acquiring an operation: %j', async value => {
    await expect(retryFirstComment(actor, value)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.operation).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    { firstCommentError: null }, { firstCommentError: 'legacy-unknown-error' }, { firstCommentError: 'rebuild:first_comment_uncertain' },
    { firstCommentAt: new Date() }, { firstCommentId: 'existing-comment' }, { status: 'processing' }, { remotePostId: null },
  ])('holds every state without definite rejection proof: %j', async change => {
    Object.assign(row, change);
    await expect(retryFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses normal send and worker continuation after rejection', async () => {
    await expect(sendFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    await expect(sendDueFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('holds an uncertain retry and prevents any subsequent retry or worker send', async () => {
    mocks.send.mockRejectedValueOnce(new Error('response lost'));
    expect(await retryFirstComment(actor, input)).toMatchObject({ state: 'needs_review' });
    expect(row.firstCommentAt).toBeInstanceOf(Date);
    await expect(retryFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(await sendDueFirstComment(actor, input)).toMatchObject({ state: 'needs_review' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent claim for the rejected comment', async () => {
    const results = await Promise.allSettled([retryFirstComment(actor, input), retryFirstComment(actor, input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(row.firstCommentId).toBe('comment-receipt');
  });

  it('requires another explicit decision after another definite rejection', async () => {
    mocks.send.mockRejectedValueOnce(new Error('definite refusal')); mocks.classify.mockReturnValue('rejected');
    expect(await retryFirstComment(actor, input)).toMatchObject({ state: 'ready' });
    expect(row.firstCommentError).toBe(FIRST_COMMENT_REJECTED); expect(row.firstCommentAt).toBeNull();
    await expect(sendDueFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(await retryFirstComment(actor, input)).toMatchObject({ state: 'sent' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it.each(['accepted', 'rejected'])('keeps a %s retry held if receipt persistence fails', async kind => {
    const update = mocks.update.getMockImplementation()!;
    let updates = 0;
    mocks.update.mockImplementation(async args => {
      if (++updates > 1) throw new Error('synthetic storage failure');
      return update(args);
    });
    if (kind === 'rejected') { mocks.send.mockRejectedValueOnce(new Error('definite refusal')); mocks.classify.mockReturnValue('rejected'); }
    expect(await retryFirstComment(actor, input)).toMatchObject({ state: 'needs_review' });
    expect(row.firstCommentAt).toBeInstanceOf(Date);
    await expect(retryFirstComment(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('never releases a malformed resolved receipt even with a rejected classifier', async () => {
    mocks.send.mockResolvedValue({ remoteId: '' }); mocks.classify.mockReturnValue('rejected');
    expect(await retryFirstComment(actor, input)).toMatchObject({ state: 'needs_review' });
    expect(row.firstCommentError).toBe('rebuild:first_comment_uncertain');
    await expect(retryFirstComment(actor, input)).rejects.toThrow(); expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it.each(['authority', 'scope', 'author', 'selection', 'platform', 'grant', 'changed', 'claim'])('rechecks current %s before dispatch', async kind => {
    if (kind === 'authority') mocks.authorize.mockRejectedValueOnce(new OperationError('forbidden', 'Revoked'));
    if (kind === 'scope') mocks.authorize.mockResolvedValueOnce({ actor: { ...actor, allowedTargetIds: [] }, role: 'editor' });
    if (kind === 'author') mocks.authorize.mockResolvedValueOnce({ actor: { ...actor, userId: 'someone-else' }, role: 'contributor' });
    if (kind === 'selection') row.target.enabled = false;
    if (kind === 'platform') mocks.adapter.mockResolvedValueOnce(null);
    if (kind === 'grant') mocks.credential.mockReturnValueOnce({ accessToken: 'synthetic', grantedScopes: [] }).mockReturnValueOnce(null);
    if (kind === 'changed') mocks.find.mockImplementationOnce(async () => structuredClone(row)).mockImplementationOnce(async () => ({ ...structuredClone(row), firstCommentError: 'rebuild:first_comment_uncertain' }));
    if (kind === 'claim') mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(retryFirstComment(actor, input)).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
