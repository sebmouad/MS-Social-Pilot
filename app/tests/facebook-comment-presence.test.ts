import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { target: { findFirst: vi.fn() } }, config: vi.fn(), decrypt: vi.fn(),
  engine: { listComments: vi.fn() }, configuredEngine: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: mocks.configuredEngine }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: vi.fn(), canUseFeature: vi.fn() }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: vi.fn() }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: vi.fn(), canAccessPage: vi.fn() }));
vi.mock('@/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: vi.fn(), inboxCommentSuppressed: vi.fn(), orderInboxCommentBatch: vi.fn() }));

import { readFacebookCommentPresence } from '../src/platforms/facebook/inbox';

const input = { workspaceId: 'w1', targetId: 't1', remoteId: 'rc1', postRemoteId: 'post_1' };
const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockImplementation(async (key: string) => key === 'platforms.facebook.enabled' ? true : ['pages_read_user_content']);
  mocks.prisma.target.findFirst.mockResolvedValue({ accessToken: 'enc', socialAccount: { scopes: 'pages_read_user_content,other', tokenExpiresAt: null } });
  mocks.decrypt.mockReturnValue('page-secret'); mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.listComments.mockResolvedValue([{ id: 'other' }]);
});

describe('Facebook comment presence read', () => {
  it('reports absence only from a complete successful listing of the comment’s post', async () => {
    expect(await readFacebookCommentPresence(input, signal())).toBe('absent');
    expect(mocks.engine.listComments).toHaveBeenCalledWith('page-secret', 'post_1');
    expect(mocks.prisma.target.findFirst.mock.calls[0][0].where).toMatchObject({ id: 't1', workspaceId: 'w1', enabled: true });
  });
  it('reports presence when the listing still contains the comment', async () => {
    mocks.engine.listComments.mockResolvedValue([{ id: 'rc1' }]);
    expect(await readFacebookCommentPresence(input, signal())).toBe('present');
  });
  it('treats provider errors, truncated pagination, lost grants and disabled platform as unknown', async () => {
    mocks.engine.listComments.mockRejectedValue(new Error('(#100) object does not exist'));
    expect(await readFacebookCommentPresence(input, signal())).toBe('unknown');
    mocks.engine.listComments.mockClear();
    mocks.prisma.target.findFirst.mockResolvedValue({ accessToken: 'enc', socialAccount: { scopes: 'other', tokenExpiresAt: null } });
    expect(await readFacebookCommentPresence(input, signal())).toBe('unknown');
    mocks.prisma.target.findFirst.mockResolvedValue({ accessToken: 'enc', socialAccount: { scopes: 'pages_read_user_content', tokenExpiresAt: new Date(0) } });
    expect(await readFacebookCommentPresence(input, signal())).toBe('unknown');
    mocks.prisma.target.findFirst.mockResolvedValue(null);
    expect(await readFacebookCommentPresence(input, signal())).toBe('unknown');
    mocks.config.mockImplementation(async (key: string) => key === 'platforms.facebook.enabled' ? false : []);
    expect(await readFacebookCommentPresence(input, signal())).toBe('unknown');
    expect(mocks.engine.listComments).not.toHaveBeenCalled();
  });
  it('refuses path-like identifiers before any lookup', async () => {
    expect(await readFacebookCommentPresence({ ...input, postRemoteId: '../x' }, signal())).toBe('unknown');
    expect(mocks.prisma.target.findFirst).not.toHaveBeenCalled();
  });
});
