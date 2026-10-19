import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  query: vi.fn(async () => [] as unknown[]),
  authorize: vi.fn(),
  credential: vi.fn(),
  platform: vi.fn(() => true),
}));

vi.mock('@/server/data', () => ({ prisma: { $queryRaw: state.query } }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: state.authorize }));
vi.mock('@/modules/publishing/server/credentials', () => ({ readPublishingCredential: state.credential }));
vi.mock('@/server/entitlements', () => ({ hasPlatformCapability: state.platform }));

import { OperationError } from '@/lib/operation-error';
import type { PlatformAdapter, PublishRequest } from '@/platforms/types';
import { loadFacebookNativeHostBinding } from '@/platforms/facebook/formats/host-binding';

const actor = { userId: 'actor-1', workspaceId: 'workspace-1' };
const freshCredential = { accessToken: 'current-token', grantedScopes: ['pages_manage_posts'] };
const row = () => ({
  workspaceId: actor.workspaceId,
  operationId: 'operation-1',
  postId: 'post-1',
  postTargetId: 'post-target-1',
  targetId: 'target-1',
  actorId: actor.userId,
  parentProvider: 'facebook',
  parentState: 'started',
  parentTargetId: 'target-1',
  parentPostId: 'post-1',
  parentPostTargetId: 'post-target-1',
  parentActorId: actor.userId,
  destinationStatus: 'processing',
  destinationRemotePostId: null,
  destinationTargetId: 'target-1',
  targetWorkspaceId: actor.workspaceId,
  targetEnabled: true,
  targetCanPublish: true,
  targetKind: 'page',
  remoteTargetId: 'page-1',
  accountWorkspaceId: actor.workspaceId,
  accountProvider: 'facebook',
  accountInvalidatedAt: null,
  tokenExpiresAt: null,
  accessToken: 'encrypted-current-token',
  scopes: 'pages_manage_posts',
  authorId: actor.userId,
  postFormat: 'post',
  formatId: 'post',
  message: 'Saved caption',
  link: null,
  media: [{ kind: 'video', url: 'https://media.example/video.mp4' }],
  approvalStatus: 'approved',
  requiresApproval: false,
  postTargets: [{ targetId: 'target-1' }],
});
const request = (): PublishRequest => ({
  operationId: 'operation-1',
  credential: freshCredential,
  target: { id: 'page-1', name: 'Page', kind: 'page' },
  formatId: 'post',
  text: 'Saved caption',
  link: null,
  media: [{ kind: 'video', url: 'https://media.example/video.mp4' }],
});
const deps = () => ({
  adapter: { canUseCredential: vi.fn(() => true) } as Pick<PlatformAdapter, 'canUseCredential'>,
  expectedConfigurationFingerprint: 'epoch-1',
  configurationFingerprint: vi.fn(async () => 'epoch-1'),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.row = row();
  state.query.mockImplementation(async () => [state.row]);
  state.authorize.mockResolvedValue({ actor, role: 'owner', entitlements: {} });
  state.credential.mockReturnValue(freshCredential);
  state.platform.mockReturnValue(true);
});

describe('loadFacebookNativeHostBinding', () => {
  it('returns a read-only binding for the original started Facebook claim and current credential', async () => {
    const result = await loadFacebookNativeHostBinding(request(), deps());
    expect(result).toMatchObject({
      workspaceId: actor.workspaceId,
      operationId: 'operation-1',
      postId: 'post-1',
      postTargetId: 'post-target-1',
      targetId: 'target-1',
      actorId: actor.userId,
      remoteTargetId: 'page-1',
      claimState: 'started',
      targetKind: 'page',
      formatId: 'post',
      text: 'Saved caption',
      mediaUrl: 'https://media.example/video.mp4',
      credential: freshCredential,
    });
    expect(result.authorityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.authorize).toHaveBeenCalledWith({ userId: actor.userId, workspaceId: actor.workspaceId }, 'publishing/posts', 'write');
    expect(state.query).toHaveBeenCalledTimes(1);
  });

  it('requires an operation ID before querying or authorizing', async () => {
    await expect(loadFacebookNativeHostBinding({ ...request(), operationId: undefined }, deps()))
      .rejects.toMatchObject({ name: 'OperationError' });
    expect(state.query).not.toHaveBeenCalled();
    expect(state.authorize).not.toHaveBeenCalled();
  });

  it.each([
    ['other workspace', { workspaceId: 'workspace-2' }],
    ['other provider', { parentProvider: 'instagram' }],
    ['settled parent', { parentState: 'uncertain' }],
    ['nonprocessing destination', { destinationStatus: 'failed' }],
    ['already linked destination', { destinationRemotePostId: 'remote-1' }],
    ['unselected Page', { targetEnabled: false }],
    ['nonpublishable Page', { targetCanPublish: false }],
    ['non-Page destination', { targetKind: 'group' }],
    ['changed remote Page', { remoteTargetId: 'page-2' }],
    ['invalidated connection', { accountInvalidatedAt: new Date() }],
    ['expired credential', { tokenExpiresAt: new Date(Date.now() - 1000) }],
  ])('refuses %s', async (_name, changes) => {
    state.row = { ...row(), ...changes };
    state.query.mockImplementation(async () => [state.row]);
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);
  });

  it('rechecks current actor, whole-post target scope, entitlement, author and contributor approval', async () => {
    state.authorize.mockResolvedValueOnce({ actor: { ...actor, allowedTargetIds: ['target-2'] }, role: 'owner', entitlements: {} });
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);

    state.authorize.mockResolvedValueOnce({ actor: { ...actor, allowedTargetIds: ['target-1'] }, role: 'contributor', entitlements: {} });
    state.row = { ...row(), postTargets: [{ targetId: 'target-1' }, { targetId: 'target-2' }] };
    state.query.mockImplementation(async () => [state.row]);
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);

    state.row = row();
    state.authorize.mockResolvedValueOnce({ actor, role: 'contributor', entitlements: {} });
    state.platform.mockReturnValueOnce(false);
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);

    state.platform.mockReturnValue(true);
    state.authorize.mockResolvedValueOnce({ actor, role: 'contributor', entitlements: {} });
    state.row = { ...row(), authorId: 'someone-else' };
    state.query.mockImplementation(async () => [state.row]);
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);

    state.row = { ...row(), requiresApproval: true, approvalStatus: 'pending' };
    state.query.mockImplementation(async () => [state.row]);
    state.authorize.mockResolvedValueOnce({ actor, role: 'contributor', entitlements: {} });
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);
  });

  it('refuses a changed saved text, format, link, media URL or media kind', async () => {
    for (const changes of [
      { message: 'edited caption' }, { formatId: 'reel' }, { link: 'https://example.com' },
      { media: [{ kind: 'video', url: 'https://media.example/other.mp4' }] },
      { media: [{ kind: 'image', url: 'https://media.example/video.mp4' }] },
    ]) {
      state.row = { ...row(), ...changes };
      state.query.mockImplementation(async () => [state.row]);
      await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);
    }
  });

  it('refuses stale request credentials, lost platform grants, and changed configuration epoch', async () => {
    state.credential.mockReturnValue({ accessToken: 'rotated-token', grantedScopes: ['pages_manage_posts'] });
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);

    state.credential.mockReturnValue(freshCredential);
    state.platform.mockReturnValue(false);
    await expect(loadFacebookNativeHostBinding(request(), deps())).rejects.toBeInstanceOf(OperationError);

    state.platform.mockReturnValue(true);
    const changed = deps();
    changed.configurationFingerprint.mockResolvedValue('epoch-2');
    await expect(loadFacebookNativeHostBinding(request(), changed)).rejects.toBeInstanceOf(OperationError);
  });
});
