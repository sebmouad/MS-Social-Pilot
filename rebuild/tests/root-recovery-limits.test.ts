import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ root: vi.fn(), query: vi.fn(), find: vi.fn(), config: vi.fn(), idMax: 200, confirmationMax: 400 }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: deps.query, postTarget: { findFirst: deps.find } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: deps.config }));
vi.mock('@/server/root/operations', () => ({ requireActiveRoot: deps.root }));
vi.mock('@/server/root/publication-operation', () => ({ withRootPublicationOperation: vi.fn() }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: vi.fn() }));
vi.mock('@/modules/publishing/server/guard', () => ({ lockPublishingTargets: vi.fn() }));
vi.mock('@/modules/publishing/server/publication', () => ({ adoptLegacyPublicationInTransaction: vi.fn(), projectPublicationInTransaction: vi.fn(), recordPublicationOutcomeInTransaction: vi.fn() }));
vi.mock('@/modules/publishing/server/deletion', () => ({ recordPostDeletionOutcomeInTransaction: vi.fn() }));
vi.mock('@/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: vi.fn() }));
import { adoptRootLegacyPublication, finishRootPublicationProjection, recordRootPublicationOutcome } from '@/server/root/publication-attempts';
import { recordRootPostDeletionOutcome } from '@/server/root/post-deletions';
import { confirmRootInboxDeletion } from '@/server/root/inbox-deletions';
const cases = [
  { run: recordRootPublicationOutcome, input: (id: string) => ({ operationId: id, outcome: 'ABSENT', verifiedExternally: true, confirmation: `ROOT RECORD PUBLICATION ${id} ABSENT` }) },
  { run: finishRootPublicationProjection, input: (id: string) => ({ operationId: id, confirmation: `ROOT FINISH PUBLICATION ${id}` }) },
  { run: adoptRootLegacyPublication, input: (id: string) => ({ postTargetId: id, confirmation: `ROOT ADOPT PUBLICATION ${id}` }) },
  { run: recordRootPostDeletionOutcome, input: (id: string) => ({ operationId: id, outcome: 'deleted', verifiedOnPlatform: true, confirmation: `ROOT RECORD POST DELETION ${id} DELETED` }) },
  { run: confirmRootInboxDeletion, input: (id: string) => ({ operationId: id, verifiedOnPlatform: true, confirmation: `CONFIRM REMOTE DELETION ${id}` }) },
];
beforeEach(() => {
  vi.clearAllMocks(); deps.idMax = 200; deps.confirmationMax = 400;
  deps.root.mockResolvedValue(undefined); deps.query.mockResolvedValue([]); deps.find.mockResolvedValue(null);
  deps.config.mockImplementation(async key => key === 'root.identifierMaxCharacters' ? deps.idMax : deps.confirmationMax);
});
describe.each(cases)('current Root recovery limits: $run.name', ({ run, input }) => {
  it('rejects lowered identifier and confirmation limits before loading records', async () => {
    deps.idMax = 2;
    await expect(run('root', input('op1'))).rejects.toMatchObject({ code: 'invalid_request' });
    deps.idMax = 200; deps.confirmationMax = 10;
    await expect(run('root', input('op1'))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(deps.query).not.toHaveBeenCalled(); expect(deps.find).not.toHaveBeenCalled();
  });
  it('accepts raised limits beyond the old 200/300 ceilings while retaining identifier syntax', async () => {
    deps.idMax = 300; deps.confirmationMax = 500;
    await expect(run('root', input('x'.repeat(280)))).rejects.toMatchObject({ code: run === adoptRootLegacyPublication ? 'conflict' : 'not_found' });
    expect(deps.query.mock.calls.length + deps.find.mock.calls.length).toBe(1);
    deps.query.mockClear(); deps.find.mockClear();
    await expect(run('root', input('bad/id'))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(deps.query).not.toHaveBeenCalled(); expect(deps.find).not.toHaveBeenCalled();
  });
  it('requires current Root before reading policy', async () => {
    deps.root.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    await expect(run('member', input('op1'))).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.config).not.toHaveBeenCalled();
  });
});
