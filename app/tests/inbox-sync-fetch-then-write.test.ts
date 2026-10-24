import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  depth: 0, events: [] as string[], providerDepths: [] as number[],
  targets: vi.fn(), freshTarget: vi.fn(), postTargets: vi.fn(), inboxList: vi.fn(), postComments: vi.fn(), suppressed: vi.fn(), lock: vi.fn(),
  conversationUpsert: vi.fn(), messageUpsert: vi.fn(), commentUpsert: vi.fn(), metadataWrite: vi.fn(),
}));

const binding = { providerId: 'pa', accessToken: null, socialAccount: { workspaceId: 'w', accessToken: 'token', scopes: 'pages_messaging', tokenExpiresAt: null, invalidatedAt: null } };
async function inside<T>(name: string, run: () => Promise<T>): Promise<T> {
  state.depth++; state.events.push(`${name}:begin`);
  try { return await run(); } finally { state.depth--; state.events.push(`${name}:end`); }
}

vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_w: string, operation: () => Promise<unknown>) => inside('workspace', operation) }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: vi.fn() }));
vi.mock('../src/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: (_w: string, _r: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => inside('lock', () => run({
  conversation: { upsert: state.conversationUpsert }, conversationMessage: { upsert: state.messageUpsert }, postComment: { upsert: state.commentUpsert }, $executeRaw: state.metadataWrite,
}, new AbortController().signal)) }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({
  lockInboxChannel: state.lock, inboxCommentSuppressed: state.suppressed, orderInboxCommentBatch: (items: unknown[]) => items,
}));
vi.mock('../src/modules/inbox/server/sync-bounds', () => ({ inboxSyncBounds: async () => ({}) }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  if (key === 'platforms.facebook.enabled') return true;
  if (key === 'sync.maxItemsPerJob') return 5;
  if (key === 'sync.resourceOperationTimeoutMs') return 60000;
  if (key === 'meta.inboxReadScopes') return ['pages_messaging'];
  return [];
} }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: async () => ({
  listInbox: async () => { state.providerDepths.push(state.depth); state.events.push('provider:listInbox'); return state.inboxList(); },
  listComments: async () => { state.providerDepths.push(state.depth); state.events.push('provider:listComments'); return state.postComments(); },
}) }));
vi.mock('../src/server/data', () => ({ prisma: {
  target: { findMany: state.targets, findFirst: state.freshTarget },
  appSetting: { findUnique: async () => null, upsert: async () => ({}) },
  postTarget: { findMany: state.postTargets },
} }));

import { syncInbox } from '../src/platforms/facebook/jobs';
import { runWithJobContext } from '../src/server/jobs/job-context';

const comment = { id: 'c1', parentId: null, message: 'hi', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks(); state.depth = 0; state.events.length = 0; state.providerDepths.length = 0;
  state.targets.mockResolvedValue([{ id: 'target-a', workspaceId: 'w', providerId: 'pa' }]);
  state.freshTarget.mockImplementation(async () => { state.events.push('recheck'); return binding; });
  state.postTargets.mockResolvedValue([{ id: 'pt1', remotePostId: 'remote1' }]);
  state.inboxList.mockResolvedValue([{ id: 'conv1', snippet: 's', unreadCount: 0, messageCount: 1, updatedAt: new Date(), messages: [] }]);
  state.postComments.mockResolvedValue([comment]);
  state.suppressed.mockResolvedValue(false);
  state.conversationUpsert.mockResolvedValue({ id: 'stored' });
  state.messageUpsert.mockResolvedValue({ id: 'stored-message' });
  state.commentUpsert.mockResolvedValue({ id: 'stored-comment' });
});

describe('Inbox sync fetch-then-write', () => {
  it('preserves supplied provider metadata, parent ids and original Page response timestamps', async () => {
    const respondedAt = new Date('2026-10-20T12:00:00Z');
    state.inboxList.mockResolvedValue([{ id: 'conv1', snippet: 'Response', unreadCount: 0, messageCount: 1, updatedAt: respondedAt,
      metadata: { participants: [{ id: 'visitor', name: 'Sam', pictureUrl: 'https://example.test/avatar' }], folder: 'inbox', labels: [] },
      messages: [{ id: 'message1', fromId: 'pa', fromName: 'Page', text: null, createdAt: respondedAt, metadata: { attachments: [{ type: 'image', url: 'https://example.test/image' }] } }],
    }]);
    state.postComments.mockResolvedValue([{ ...comment, parentId: 'root-remote', fromId: 'pa', createdAt: respondedAt,
      metadata: { reactions: [{ type: 'LIKE', count: 2 }], permalink: 'https://example.test/comment', threadId: 'root-remote' },
    }]);

    await syncInbox();

    expect(state.providerDepths).toEqual([0, 0]);
    expect(state.metadataWrite).toHaveBeenCalledTimes(3);
    const payloads = state.metadataWrite.mock.calls.map(call => JSON.parse(call[1] as string));
    expect(payloads).toEqual([
      expect.objectContaining({ participants: [expect.objectContaining({ id: 'visitor', pictureUrl: 'https://example.test/avatar' })], folder: 'inbox', labels: [] }),
      { attachments: [{ type: 'image', url: 'https://example.test/image' }] },
      { reactions: [{ type: 'LIKE', count: 2 }], permalink: 'https://example.test/comment', threadId: 'root-remote' },
    ]);
    expect(state.messageUpsert.mock.calls[0]![0].update).toMatchObject({ fromId: 'pa', createdTime: respondedAt });
    expect(state.commentUpsert.mock.calls[0]![0].create).toMatchObject({ parentRemoteId: 'root-remote', fromId: 'pa', createdTime: respondedAt });
  });
  it('makes every provider call outside the workspace transaction and resource lock', async () => {
    const result = await syncInbox();

    expect(result).toMatchObject({ examined: 1, updated: 2, failed: 0 });
    expect(state.providerDepths).toEqual([0, 0]);
    const events = state.events;
    expect(events.indexOf('provider:listComments')).toBeLessThan(events.lastIndexOf('workspace:begin'));
    expect(events.lastIndexOf('workspace:begin')).toBeLessThan(events.indexOf('lock:begin'));
    // The only transaction before the provider reads is the empty admission check.
    expect(events.slice(0, events.indexOf('provider:listInbox'))).toEqual(['workspace:begin', 'workspace:end', 'recheck']);
  });

  it('re-checks the binding inside the write transaction after the provider reads', async () => {
    await syncInbox();

    const events = state.events;
    const lockBegin = events.indexOf('lock:begin');
    expect(events.slice(lockBegin, events.indexOf('lock:end')).filter(event => event === 'recheck')).toHaveLength(2);
    expect(state.lock).toHaveBeenCalled();
  });

  it('writes nothing when the binding is revoked while the provider call was in flight', async () => {
    let reads = 0;
    state.freshTarget.mockImplementation(async () => (++reads <= 2 ? binding : null));

    const result = await syncInbox();

    expect(result).toMatchObject({ examined: 1, updated: 0, skipped: 1, failed: 0 });
    expect(state.conversationUpsert).not.toHaveBeenCalled();
    expect(state.commentUpsert).not.toHaveBeenCalled();
  });

  it('drops comment batches whose post was re-bound during the provider round-trip', async () => {
    state.postTargets.mockResolvedValueOnce([{ id: 'pt1', remotePostId: 'remote1' }]).mockResolvedValueOnce([{ id: 'pt1', remotePostId: 'other' }]);

    await syncInbox();

    expect(state.commentUpsert).not.toHaveBeenCalled();
    expect(state.conversationUpsert).toHaveBeenCalled();
  });

  it('does not start another target once shutdown is requested', async () => {
    state.targets.mockResolvedValue([{ id: 'target-a', workspaceId: 'w', providerId: 'pa' }, { id: 'target-b', workspaceId: 'w', providerId: 'pb' }]);
    let stopping = false;
    state.inboxList.mockImplementation(async () => { stopping = true; return []; });

    const result = await runWithJobContext({ signal: new AbortController().signal, stopRequested: () => stopping }, () => syncInbox());

    expect(result.examined).toBe(2);
    expect(state.inboxList).toHaveBeenCalledTimes(1);
  });
});
