import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  root: vi.fn(), config: vi.fn(), query: vi.fn(), transaction: vi.fn(),
  workspace: vi.fn(), lock: vi.fn(), record: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: deps.query, $transaction: deps.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: deps.config }));
vi.mock('../src/server/root/operations', () => ({ requireActiveRoot: deps.root }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: deps.workspace }));
vi.mock('../src/modules/publishing/server/guard', () => ({ lockPublishingTargets: deps.lock }));
vi.mock('../src/modules/publishing/server/deletion', () => ({ recordPostDeletionOutcomeInTransaction: deps.record }));

import { listRootPostDeletions, recordRootPostDeletionOutcome } from '../src/server/root/post-deletions';
import { OperationError } from '../src/lib/operation-error';

beforeEach(() => {
  vi.clearAllMocks();
  deps.root.mockResolvedValue(undefined);
  deps.config.mockImplementation(async key => key === 'publishing.deletionHistoryLimit' ? 20 : key === 'root.operationalTimezone' ? 'UTC' : key === 'publishing.transactionTimeoutMs' ? 5000 : 1000);
  deps.query.mockResolvedValue([]);
  deps.workspace.mockImplementation(async (_workspaceId, operation) => operation());
  deps.transaction.mockImplementation(async callback => callback({ $queryRaw: vi.fn().mockResolvedValue([{ isInstanceOwner: true, disabledAt: null }]) }));
  deps.record.mockImplementation(async (_tx, _actorId, input) => ({ ok: true, operationId: input.operationId, state: input.outcome === 'deleted' ? 'remote_confirmed' : 'rejected' }));
});

describe('private Root post deletion recovery', () => {
  it('requires current active Root before querying and limits recent rows', async () => {
    deps.root.mockRejectedValueOnce(new OperationError('forbidden', 'Installation-owner access is required.'));
    await expect(listRootPostDeletions('member')).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.query).not.toHaveBeenCalled();
    deps.root.mockResolvedValue(undefined);
    deps.config.mockImplementation(async key => key === 'publishing.deletionHistoryLimit' ? 20 : 'UTC');
    await listRootPostDeletions('root', 4);
    expect(Array.from(deps.query.mock.calls[0][0]).join('')).toContain('FROM rebuild_post_deletions');
    expect(deps.query.mock.calls[0].slice(1)).toContain(4);
  });

  it('returns only safe identities and bounded metadata, never post body or provider errors', async () => {
    const now = new Date('2026-10-16T12:00:00Z');
    deps.query.mockResolvedValueOnce([{ id: 'op1', workspaceId: 'ws1', targetId: 'tg1', provider: 'facebook', remoteId: 'remote1', localPostIds: ['post1'], localPostTargetIds: ['pt1'], state: 'uncertain', createdAt: now, updatedAt: now, remoteConfirmedAt: null, completedAt: null, workspaceName: 'Synthetic', targetName: 'Page', message: 'private post body', error: 'private provider error' }]);
    const result = await listRootPostDeletions('root');
    expect(result.items[0]).toMatchObject({ operationId: 'op1', workspaceId: 'ws1', remotePostId: 'remote1', localPostIds: ['post1'], state: 'uncertain' });
    expect(JSON.stringify(result)).not.toMatch(/private post body|private provider error|message|error/);
  });

  it.each([
    { operationId: 'op1', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'wrong' },
    { operationId: 'op1', outcome: 'sent', verifiedOnPlatform: true, confirmation: 'ROOT RECORD POST DELETION op1 DELETED' },
    { operationId: 'op1', outcome: 'deleted', verifiedOnPlatform: false, confirmation: 'ROOT RECORD POST DELETION op1 DELETED' },
  ])('rejects inexact or unverified attestations before loading journal state', async input => {
    await expect(recordRootPostDeletionOutcome('root', input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(deps.query).not.toHaveBeenCalled();
  });

  it('takes workspace and Publishing target locks, rechecks current Root in transaction and delegates atomic audit/state', async () => {
    deps.query.mockResolvedValueOnce([{ id: 'op1', workspaceId: 'ws1', targetId: 'tg1', state: 'uncertain' }]);
    const result = await recordRootPostDeletionOutcome('root', { operationId: 'op1', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'ROOT RECORD POST DELETION op1 DELETED' });
    expect(deps.workspace).toHaveBeenCalledWith('ws1', expect.any(Function));
    expect(deps.lock).toHaveBeenCalledWith(expect.anything(), 'ws1', ['tg1']);
    expect(deps.root).toHaveBeenCalledTimes(2);
    expect(deps.record).toHaveBeenCalledWith(expect.anything(), 'root', { operationId: 'op1', workspaceId: 'ws1', outcome: 'deleted' });
    expect(result).toMatchObject({ ok: true, state: 'remote_confirmed' });
  });

  it('rejects a journal already resolved before entering the mutation lock', async () => {
    deps.query.mockResolvedValueOnce([{ id: 'op1', workspaceId: 'ws1', targetId: 'tg1', state: 'completed' }]);
    await expect(recordRootPostDeletionOutcome('root', { operationId: 'op1', outcome: 'deleted', verifiedOnPlatform: true, confirmation: 'ROOT RECORD POST DELETION op1 DELETED' })).rejects.toMatchObject({ code: 'conflict' });
    expect(deps.workspace).not.toHaveBeenCalled();
  });

  it('rechecks Root authority under the transaction lock before writing an attestation', async () => {
    deps.query.mockResolvedValueOnce([{ id: 'op1', workspaceId: 'ws1', targetId: 'tg1', state: 'uncertain' }]);
    deps.transaction.mockImplementationOnce(async callback => callback({ $queryRaw: vi.fn().mockResolvedValue([{ isInstanceOwner: false, disabledAt: null }]) }));
    await expect(recordRootPostDeletionOutcome('root', { operationId: 'op1', outcome: 'not_deleted', verifiedOnPlatform: true, confirmation: 'ROOT RECORD POST DELETION op1 NOT DELETED' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.record).not.toHaveBeenCalled();
  });
});
