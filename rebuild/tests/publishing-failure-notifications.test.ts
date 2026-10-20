import { beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/client';
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/server/platforms/publication-recovery', () => ({ assertPlatformPublicationOutcome: vi.fn(), assertPlatformPublicationsSettled: vi.fn() }));
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { recordPublicationOutcomeInTransaction, publishDestinationInOperation } from '@/modules/publishing/server/publication';
vi.mock('@/modules/publishing/server/guard', () => ({ withPublishingTransaction: (_signal: unknown, work: (value: unknown) => unknown) => work(tx) }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: (work: (value: unknown) => unknown) => work(tx) } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn().mockResolvedValue(5000) }));
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  postTarget: { updateMany: vi.fn(), findMany: vi.fn() }, post: { updateMany: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  tx.$executeRaw.mockResolvedValue(1);
  tx.$queryRaw.mockResolvedValue([{ id: 'operation', workspaceId: 'w', postId: 'p', postTargetId: 'pt', targetId: 't', provider: 'example', state: 'uncertain' }]);
  tx.postTarget.findMany.mockResolvedValue([{ status: 'failed', publishedAt: null }]);
});
it('records a confirmed absent publication and its durable failure intent together', async () => {
  await recordPublicationOutcomeInTransaction(tx as unknown as Prisma.TransactionClient, 'u', { workspaceId: 'w', operationId: 'operation', outcome: 'ABSENT' });
  expect(tx.postTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'failed' } }));
  expect(emitWorkspaceAlert).toHaveBeenCalledWith(tx, { workspaceId: 'w', eventId: 'publication_operation', postId: 'p', targetId: 't', kind: 'publish_failure' });
});
it('does not produce another failure intent for an already resolved operation', async () => {
  tx.$queryRaw.mockResolvedValue([{ state: 'attested_absent' }]);
  await expect(recordPublicationOutcomeInTransaction(tx as unknown as Prisma.TransactionClient, 'u', { workspaceId: 'w', operationId: 'operation', outcome: 'ABSENT' })).rejects.toThrow();
  expect(emitWorkspaceAlert).not.toHaveBeenCalled();
});

it.each(['rejected', 'uncertain'] as const)('produces durable failure only for a definite %s provider outcome', async classification => {
  tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'operation', workspaceId: 'w', postId: 'p', postTargetId: 'pt', targetId: 't', state: 'started' }]);
  tx.postTarget.updateMany.mockResolvedValue({ count: 1 });
  const outcome = await publishDestinationInOperation({ actor: { userId: 'u', workspaceId: 'w' }, signal: new AbortController().signal }, {
    postId: 'p', postTargetId: 'pt', targetId: 't', provider: 'example', expectedStatus: 'pending',
    dispatch: async () => { throw new Error('provider refused'); }, classifyFailure: () => classification,
  });
  expect(outcome).toBe(classification === 'rejected' ? 'failed' : 'needs_review');
  expect(emitWorkspaceAlert).toHaveBeenCalledTimes(classification === 'rejected' ? 1 : 0);
});
