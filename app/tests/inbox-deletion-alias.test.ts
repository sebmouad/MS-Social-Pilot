vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: vi.fn(), comment: vi.fn(), access: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: state.query, postComment: { findFirst: state.comment } } }));
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: state.access }));
import { getInboxDeletion } from '../src/modules/inbox/server/deletion';
beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ channelIds: ['channel'] });
});
it('finds the same durable deletion through a scoped local alias', async () => {
  state.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'operation', workspaceId: 'workspace', targetId: 'channel', provider: 'provider', remoteId: 'remote', localItemId: 'canonical', state: 'uncertain' }]);
  state.comment.mockResolvedValue({ id: 'alias', remoteId: 'remote', postTarget: { targetId: 'channel', target: { socialAccount: { provider: 'provider' } } } });
  const result = await getInboxDeletion({ userId: 'actor', workspaceId: 'workspace' }, { itemId: 'alias' });
  expect(result.operation).toMatchObject({ operationId: 'operation', itemId: 'alias', state: 'uncertain', remoteConfirmed: false, localConfirmed: false });
  expect(result.operation).not.toHaveProperty('remoteId');
});
