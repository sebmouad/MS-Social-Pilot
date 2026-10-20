import { beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/client';
vi.mock('@/modules/settings/notifications/producers', () => ({ emitWorkspaceAlert: vi.fn().mockResolvedValue(undefined) }));
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';
import { enqueueEmptyQueueNotifications } from '@/modules/publishing/server/notification-events';
const tx = { $queryRaw: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); });
it('alerts only destinations whose scheduled queue was drained, once per destination', async () => {
  tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'remaining' }]);
  await enqueueEmptyQueueNotifications(tx as unknown as Prisma.TransactionClient, 'w', 'p', ['empty', 'empty', 'full']);
  expect(emitWorkspaceAlert).toHaveBeenCalledTimes(1);
  expect(emitWorkspaceAlert).toHaveBeenCalledWith(tx, expect.objectContaining({ workspaceId: 'w', kind: 'queue_empty', targetId: 'empty' }));
});
it('uses the same bounded event identity when a consumption is replayed', async () => {
  tx.$queryRaw.mockResolvedValue([]);
  await enqueueEmptyQueueNotifications(tx as unknown as Prisma.TransactionClient, 'w', 'p', ['t']);
  await enqueueEmptyQueueNotifications(tx as unknown as Prisma.TransactionClient, 'w', 'p', ['t']);
  const calls = vi.mocked(emitWorkspaceAlert).mock.calls;
  expect(calls[0][1].eventId).toBe(calls[1][1].eventId);
  expect(calls[0][1].eventId.length).toBeLessThanOrEqual(200);
});
