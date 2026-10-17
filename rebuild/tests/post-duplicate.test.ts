import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'editor', actor: { userId: 'user-1', workspaceId: 'workspace-1', allowedTargetIds: ['target-1'] as string[] | undefined },
  source: null as any, receipt: [] as any[], foundDraft: true, where: null as any, limits: vi.fn(), validateTargets: vi.fn(),
}));
const db = vi.hoisted(() => ({ postFindFirst: vi.fn(), postCreate: vi.fn(), queryRaw: vi.fn(), executeRaw: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { post: { findFirst: (...args: unknown[]) => db.postFindFirst(...args), create: (...args: unknown[]) => db.postCreate(...args) }, $queryRaw: (...args: unknown[]) => db.queryRaw(...args) } }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({ modules: { publishing: true } }) }));
vi.mock('../src/server/publishing/lifecycle', () => ({
  limits: (...args: unknown[]) => state.limits(...args), validatePostContent: (value: string, _max: number, attachments: { link?: string | null; media?: unknown[] }) => { const text = value.trim(); if (!text && !attachments.link && !attachments.media?.length) throw new Error('Add post text, a link, or media before saving.'); return text; }, validFirstComment: (value: string) => value.trim() || null,
  validatePostAttachments: (value: unknown) => value, resolvePublishMedia: async (_workspace: string, media: unknown) => media,
  validateTargets: (...args: unknown[]) => state.validateTargets(...args),
}));
vi.mock('../src/modules/publishing/server/guard', () => ({
  withPublishingOperation: async (_actor: unknown, _options: unknown, work: (context: unknown) => unknown) => work({ actor: state.actor, role: state.role, signal: new AbortController().signal }),
  withPublishingTransaction: async (_signal: AbortSignal, work: (tx: unknown) => unknown) => work({ post: { create: db.postCreate }, $executeRaw: db.executeRaw }),
}));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async (_workspace: string, _entitlements: unknown, allowed?: readonly string[]) => allowed ? [...allowed] : ['target-1'],
  publishingPostVisibilityWhere: (workspaceId: string, ids: readonly string[], authorId?: string) => { state.where = { workspaceId, ids: [...ids], authorId }; return { workspaceId, OR: [{ targets: { some: { targetId: { in: [...ids] } }, every: { targetId: { in: [...ids] } } } }, ...(authorId ? [{ targets: { none: {} }, authorId }] : [])] }; },
}));

import { duplicatePost } from '../src/modules/publishing/server/duplicate';

const source = (overrides: Record<string, unknown> = {}) => ({ id: 'source-1', workspaceId: 'workspace-1', authorId: 'user-1', message: 'Source message', firstComment: 'First comment', link: null, media: [], status: 'published', scheduledAt: null, publishedAt: new Date(), targets: [{ targetId: 'target-1', status: 'published', remotePostId: 'remote-1' }], ...overrides });
const args = (postId = 'source-1', requestId = '11111111-1111-4111-8111-111111111111') => ({ postId, requestId, confirmation: `DUPLICATE POST ${postId}` });
const actor = { userId: 'user-1', workspaceId: 'workspace-1' };

describe('duplicatePost', () => {
  beforeEach(() => {
    state.role = 'editor'; state.actor = { ...actor, allowedTargetIds: ['target-1'] }; state.source = source(); state.receipt = []; state.foundDraft = true;
    state.where = null; state.limits.mockReset().mockResolvedValue({ maxText: 1000, maxMedia: 4, maxAlt: 500, maxTargets: 10 }); state.validateTargets.mockReset().mockResolvedValue([{ id: 'target-1' }]);
    db.postFindFirst.mockReset().mockImplementation(async ({ where }: any) => { if (where.id === 'source-1') return state.source; return state.foundDraft ? { id: where.id } : null; });
    db.postCreate.mockReset().mockResolvedValue({}); db.queryRaw.mockReset().mockImplementation(async () => state.receipt); db.executeRaw.mockReset().mockResolvedValue(1);
  });

  it('requires an exact confirmation and a canonical lowercase request UUID', async () => {
    await expect(duplicatePost(actor, args('source-1', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(duplicatePost(actor, { ...args(), extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(duplicatePost(actor, { ...args(), confirmation: 'DUPLICATE POST other' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('denies hidden or cross-workspace sources before looking up a receipt', async () => {
    state.source = null;
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'not_found' });
    expect(db.queryRaw).not.toHaveBeenCalled();
  });

  it('denies roles outside owner, admin, editor and own-source contributor', async () => {
    state.role = 'viewer';
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'contributor'; state.source = source({ authorId: 'other-user' });
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('limits scoped editors to their own unconnected drafts like Publishing reads', async () => {
    state.source = null;
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'not_found' });
    expect(state.where).toEqual({ workspaceId: 'workspace-1', ids: ['target-1'], authorId: 'user-1' });
  });

  it('blocks legacy processing source states before validating copy content', async () => {
    state.source = source({ status: 'publishing' });
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'conflict' });
    expect(state.limits).not.toHaveBeenCalled();
  });

  it('replays an exact receipt without revalidating an edited source or draft', async () => {
    const requestId = args().requestId;
    state.receipt = [{ actorId: 'user-1', action: 'publishing.post_duplicated', detail: { workspaceId: 'workspace-1', sourcePostId: 'source-1', requestId, postId: requestId } }];
    state.source = source({ message: 'Source edited since copy' });
    await expect(duplicatePost(actor, args())).resolves.toEqual({ sourcePostId: 'source-1', postId: requestId, draftCreated: true, replayed: true });
    expect(state.limits).not.toHaveBeenCalled(); expect(db.postCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['different actor', { actorId: 'other-user' }],
    ['different workspace', { detail: { workspaceId: 'other-workspace', sourcePostId: 'source-1', requestId: args().requestId, postId: args().requestId } }],
    ['different source', { detail: { workspaceId: 'workspace-1', sourcePostId: 'other-source', requestId: args().requestId, postId: args().requestId } }],
  ])('rejects a receipt collision with %s', async (_label, override) => {
    const id = args().requestId;
    state.receipt = [{ actorId: 'user-1', action: 'publishing.post_duplicated', detail: { workspaceId: 'workspace-1', sourcePostId: 'source-1', requestId: id, postId: id }, ...override }];
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'conflict' });
    expect(db.postCreate).not.toHaveBeenCalled();
  });

  it('conflicts when a valid receipt outlives its deleted copy', async () => {
    const id = args().requestId;
    state.receipt = [{ actorId: 'user-1', action: 'publishing.post_duplicated', detail: { workspaceId: 'workspace-1', sourcePostId: 'source-1', requestId: id, postId: id } }];
    state.foundDraft = false;
    await expect(duplicatePost(actor, args())).rejects.toMatchObject({ code: 'conflict' });
  });

  it('passes the copied link into destination media compatibility checks', async () => {
    state.source = source({ link: 'https://example.test/story', media: [{ kind: 'image', url: 'https://example.test/image.jpg', altText: 'image' }] });
    await duplicatePost(actor, args());
    expect(state.validateTargets).toHaveBeenCalledWith(state.actor, ['target-1'], 10, state.source.media, true, 'https://example.test/story');
  });

  it('duplicates link-only and media-only posts with an empty normalized caption', async () => {
    for (const attachments of [{ link: 'https://example.test/story', media: [] }, { media: [{ kind: 'image', url: 'https://example.test/image.jpg' }] }]) {
      state.source = source({ message: '   ', firstComment: null, ...attachments });
      await duplicatePost(actor, args());
      expect(db.postCreate.mock.calls.at(-1)?.[0].data).toMatchObject({ message: '', link: attachments.link, media: attachments.media });
    }
  });

  it('does not accept a first comment as the only post content', async () => {
    state.source = source({ message: ' ', firstComment: 'Comment only', link: null, media: [] });
    await expect(duplicatePost(actor, args())).rejects.toThrow(/Add post text, a link, or media/);
    expect(db.postCreate).not.toHaveBeenCalled();
  });
});
