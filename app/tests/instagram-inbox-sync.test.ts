import { beforeEach, expect, it, vi } from 'vitest';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
import { OperationError } from '@/lib/operation-error';

const m = vi.hoisted(() => ({
  locked: false, token: 'encrypted', selected: true, suppressed: new Set<string>(),
  target: { findMany: vi.fn(), findFirst: vi.fn() }, postTarget: { findMany: vi.fn() },
  postComment: { upsert: vi.fn() }, appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  audit: vi.fn(), source: vi.fn(), access: vi.fn(), config: vi.fn(), stop: vi.fn(),
  comments: vi.fn(), lock: vi.fn(), policy: null as null | typeof INSTAGRAM_POLICY_DEFAULTS,
  workspaces: ['workspace-a'], targetsByWorkspace: {} as Record<string, Array<{ id: string; workspaceId: string; providerId: string; socialAccountId: string | null }>>,
}));
vi.mock('@/server/data', () => ({ prisma: { target: m.target, postTarget: m.postTarget, postComment: m.postComment, appSetting: m.appSetting } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config, runtimeSecret: async () => null }));
vi.mock('@/platforms/instagram/source-binding', () => ({ assertInstagramSource: m.source }));
vi.mock('@/server/secret-crypto', () => ({ decryptSecret: () => 'decrypted' }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: m.access }));
vi.mock('@/server/jobs/job-context', () => ({ jobStopRequested: m.stop, jobAbortSignal: () => undefined }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_w: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: async (_w: string, _r: unknown, fn: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => { m.locked = true; try { return await fn({ postComment: m.postComment, $executeRaw: m.audit, $queryRaw: async () => [] }, new AbortController().signal); } finally { m.locked = false; } } }));
vi.mock('@/modules/inbox/server/comment-guard', async actual => {
  const real = await actual<typeof import('@/modules/inbox/server/comment-guard')>();
  return { ...real, lockInboxChannel: m.lock, inboxCommentSuppressed: async (_tx: unknown, _w: string, _t: string, remoteId: string) => m.suppressed.has(remoteId) };
});
vi.mock('@/platforms/instagram/runtime', () => ({
  configuredInstagramPolicy: async () => m.policy,
  configuredInstagramCollector: async () => { throw new Error('analytics collector is out of scope here'); },
  configuredInstagramAdapter: async () => ({ listComments: m.comments }),
}));

import { syncInstagramInbox } from '@/platforms/instagram/jobs';

const now = new Date('2026-10-23T12:00:00.000Z');
const comment = (id: string, parentId: string | null = null) => ({ id, text: `hello ${id}`, createdAt: new Date('2026-10-23T11:00:00.000Z'), targetId: 'remote', kind: 'comment' as const, parentId, authorId: 'visitor', authorName: 'Visitor' });

beforeEach(() => {
  vi.resetAllMocks();
  m.locked = false; m.token = 'encrypted'; m.selected = true; m.suppressed = new Set();
  m.policy = { ...INSTAGRAM_POLICY_DEFAULTS };
  m.workspaces = ['workspace-a'];
  m.targetsByWorkspace = { 'workspace-a': [{ id: 'target-a1', workspaceId: 'workspace-a', providerId: 'remote-a1', socialAccountId: 'connection-a' }] };
  m.config.mockImplementation(async (key: string) => key === 'platforms.instagram.enabled' ? true : key === 'sync.maxItemsPerJob' ? 10 : 10);
  m.appSetting.findUnique.mockResolvedValue(null);
  m.target.findMany.mockImplementation(async (args: { distinct?: string[]; where?: { workspaceId?: string; id?: { gt?: string; lte?: string } }; take?: number }) => {
    if (args.distinct) return m.workspaces.map(workspaceId => ({ workspaceId }));
    const rows = (m.targetsByWorkspace[args.where?.workspaceId ?? ''] ?? []).filter(row => {
      if (args.where?.id?.gt) return row.id > args.where.id.gt;
      if (args.where?.id?.lte) return row.id <= args.where.id.lte;
      return true;
    });
    return rows.slice(0, args.take ?? rows.length);
  });
  m.target.findFirst.mockImplementation(async (args: { where: { id: string } }) => {
    if (!m.selected) return null;
    const scopes = [...INSTAGRAM_POLICY_DEFAULTS.commentScopes].join(',');
    return { accessToken: m.token, socialAccountId: 'connection-a', socialAccount: { scopes, tokenExpiresAt: null } };
  });
  m.postTarget.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; targetId?: string } }) => {
    if (args.where.targetId === 'target-a1' && !args.where.id) return [{ id: 'post-a1', remotePostId: 'remote-post-a1' }];
    if (args.where.id) return args.where.id.in.map(id => ({ id, remotePostId: 'remote-post-a1' }));
    return [];
  });
  m.comments.mockImplementation(async () => { expect(m.locked).toBe(false); return [comment('c1'), comment('c2', 'c1')]; });
});

it('syncs comments fetch-then-write with a system audit and an advanced cursor', async () => {
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
  expect(m.access).toHaveBeenCalledWith('workspace-a', { provider: 'instagram', anyFeatureOf: ['inbox/conversations'] });
  expect(m.comments).toHaveBeenCalledWith({ credential: { accessToken: 'decrypted', grantedScopes: expect.arrayContaining(['instagram_manage_comments']) }, targetId: 'remote-a1', remotePostId: 'remote-post-a1' });
  expect(m.lock).toHaveBeenCalled();
  expect(m.postComment.upsert).toHaveBeenCalledTimes(2);
  expect(m.postComment.upsert.mock.calls[0][0].where).toEqual({ postTargetId_remoteId: { postTargetId: 'post-a1', remoteId: 'c1' } });
  expect(m.audit).toHaveBeenCalled();
  expect(m.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'sync.cursor.instagram-inbox' }, create: expect.objectContaining({ value: { workspaceId: 'workspace-a', targetId: 'target-a1' } }) }));
});

it('shares each run fairly across workspaces and resumes after the saved cursor', async () => {
  m.policy = { ...INSTAGRAM_POLICY_DEFAULTS, inboxTargetsPerWorkspace: 1 };
  m.workspaces = ['workspace-a', 'workspace-b'];
  m.targetsByWorkspace = {
    'workspace-a': [{ id: 'a1', workspaceId: 'workspace-a', providerId: 'remote-a1', socialAccountId: 'connection-a' }, { id: 'a2', workspaceId: 'workspace-a', providerId: 'remote-a2', socialAccountId: 'connection-a' }],
    'workspace-b': [{ id: 'b1', workspaceId: 'workspace-b', providerId: 'remote-b1', socialAccountId: 'connection-b' }, { id: 'b2', workspaceId: 'workspace-b', providerId: 'remote-b2', socialAccountId: 'connection-b' }],
  };
  m.postTarget.findMany.mockResolvedValue([]);
  m.appSetting.findUnique.mockResolvedValue({ value: { workspaceId: 'workspace-a', targetId: 'a1' } });
  const order: string[] = [];
  m.target.findFirst.mockImplementation(async (args: { where: { id: string } }) => { order.push(args.where.id); return { accessToken: m.token, socialAccountId: 'connection', socialAccount: { scopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes.join(','), tokenExpiresAt: null } }; });

  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 2, updated: 2, skipped: 0, failed: 0 });
  // The ring resumes after workspace-a (b1 first), then wraps to the remainder of workspace-a (a2).
  expect(order[0]).toBe('b1');
  expect(new Set(order)).toEqual(new Set(['b1', 'a2']));
  expect(m.appSetting.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: expect.objectContaining({ value: { workspaceId: 'workspace-a', targetId: 'a2' } }) }));
});

it('retries once without a cursor when the saved position selects nothing', async () => {
  m.appSetting.findUnique.mockResolvedValue({ value: { workspaceId: 'workspace-a', targetId: 'target-a1' } });
  m.target.findMany.mockImplementationOnce(async () => []);
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
});

it('does nothing while the module is switched off', async () => {
  m.config.mockImplementation(async (key: string) => key === 'platforms.instagram.enabled' ? false : 10);
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 0, updated: 0, skipped: 0, failed: 0 });
  expect(m.target.findMany).not.toHaveBeenCalled();
});

it('does not fetch for workspace owners without the required plan/platform access', async () => {
  m.access.mockRejectedValue(new OperationError('forbidden', 'denied'));
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.comments).not.toHaveBeenCalled(); expect(m.postComment.upsert).not.toHaveBeenCalled();
});

it('discards fetched comments after deselection or credential rotation', async () => {
  m.target.findFirst.mockResolvedValueOnce({ accessToken: 'encrypted', socialAccountId: 'connection-a', socialAccount: { scopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes.join(','), tokenExpiresAt: null } }).mockResolvedValue({ accessToken: 'rotated', socialAccountId: 'connection-a', socialAccount: { scopes: INSTAGRAM_POLICY_DEFAULTS.commentScopes.join(','), tokenExpiresAt: null } });
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  expect(m.comments).toHaveBeenCalled(); expect(m.postComment.upsert).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});

it('keeps stored comments for a destination that rebound while Graph was being read', async () => {
  m.postTarget.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; targetId?: string } }) => {
    if (args.where.targetId === 'target-a1' && !args.where.id) return [{ id: 'post-a1', remotePostId: 'remote-post-a1' }];
    return [{ id: 'post-a1', remotePostId: 'remote-post-moved' }];
  });
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
  expect(m.postComment.upsert).not.toHaveBeenCalled();
});

it('skips comments with a pending or confirmed deletion instead of restoring them', async () => {
  m.suppressed = new Set(['c1']);
  await syncInstagramInbox(now);
  expect(m.postComment.upsert).toHaveBeenCalledTimes(1);
  expect(m.postComment.upsert.mock.calls[0][0].where).toEqual({ postTargetId_remoteId: { postTargetId: 'post-a1', remoteId: 'c2' } });
});

it('isolates a provider failure to its target and keeps syncing the rest', async () => {
  m.workspaces = ['workspace-a', 'workspace-b'];
  m.targetsByWorkspace = {
    'workspace-a': [{ id: 'target-a1', workspaceId: 'workspace-a', providerId: 'remote-a1', socialAccountId: 'connection-a' }],
    'workspace-b': [{ id: 'target-b1', workspaceId: 'workspace-b', providerId: 'remote-b1', socialAccountId: 'connection-b' }],
  };
  m.postTarget.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; targetId?: string } }) => {
    if (args.where.targetId === 'target-a1' && !args.where.id) return [{ id: 'post-a1', remotePostId: 'remote-post-a1' }];
    if (args.where.targetId === 'target-b1' && !args.where.id) return [{ id: 'post-b1', remotePostId: 'remote-post-b1' }];
    if (args.where.id) return args.where.id.in.map(id => ({ id, remotePostId: id === 'post-a1' ? 'remote-post-a1' : 'remote-post-b1' }));
    return [];
  });
  m.comments.mockRejectedValueOnce(new Error('Graph unavailable')).mockImplementation(async () => [comment('ok')]);
  await expect(syncInstagramInbox(now)).resolves.toEqual({ examined: 2, updated: 1, skipped: 0, failed: 1 });
  expect(m.postComment.upsert).toHaveBeenCalledTimes(1);
});

it('query binds target, provider, workspace and connection identities', async () => {
  await syncInstagramInbox(now);
  expect(m.target.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'target-a1', workspaceId: 'workspace-a', providerId: 'remote-a1', socialAccountId: 'connection-a', enabled: true, socialAccount: { is: { workspaceId: 'workspace-a', provider: 'instagram', invalidatedAt: null } } }) }));
});
