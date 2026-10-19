import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ query: vi.fn(), runtimeConfig: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));

import {
  assertFacebookNativeResolution, assertFacebookNativeSettled, readFacebookNativeEvidence,
  readFacebookNativeProofEvidence,
} from '../src/platforms/facebook/formats/journal-recovery';

function queryCapture(mock: ReturnType<typeof vi.fn>, call = 0) {
  const [strings, ...values] = mock.mock.calls[call] as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join('?'), values };
}

const nativeRow = (overrides: Record<string, unknown> = {}) => ({
  operationId: 'operation-1', workspaceId: 'workspace-1', targetId: 'target-1', remoteTargetId: 'page-1',
  format: 'video', state: 'uncertain', remoteId: 'final-1', knownIds: ['final-1'],
  steps: [{ phase: 'video_create', dispatched: true, confirmed: true }], revision: 3, conflicted: false, parentState: 'uncertain', parentRemoteId: null,
  createdAt: new Date('2026-10-19T10:00:00.000Z'), updatedAt: new Date('2026-10-19T10:05:00.000Z'), ...overrides,
});

describe('Facebook native status proof evidence', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.runtimeConfig.mockReset().mockImplementation(async (key: string) => key === 'meta.mediaHistoryLimit' ? 20 : false);
  });

  it('offers a Root status-only action only when enabled and the native row is eligible', async () => {
    mocks.runtimeConfig.mockImplementation(async (key: string) => key === 'meta.mediaHistoryLimit' ? 20 : true);
    mocks.query.mockResolvedValue([nativeRow()]);
    const evidence = await readFacebookNativeEvidence(undefined, 5);
    expect(evidence.actions).toHaveLength(1);
    expect(evidence.actions?.[0]).toMatchObject({
      rowId: `native:${createHash('sha256').update('operation-1').digest('hex')}`,
      actionId: 'refresh_native_status', subjectId: 'operation-1', label: 'Check final publication status',
      acknowledgmentLabel: expect.stringContaining('will not resend'),
      description: expect.stringContaining('will not resend or remove'),
      context: [
        { label: 'Workspace', value: 'workspace-1' }, { label: 'Target', value: 'target-1' },
        { label: 'Facebook Page', value: 'page-1' }, { label: 'Format', value: 'video' },
        { label: 'Final publication ID', value: 'final-1' }, { label: 'Journal revision', value: '3' },
      ],
    });
    const query = queryCapture(mocks.query);
    expect(query.sql).toContain('j.steps');
    expect(query.values).toEqual([6]);
    expect(mocks.runtimeConfig).toHaveBeenCalledWith('facebook.native.statusRecoveryEnabled');
  });

  it.each([
    ['disabled', false, nativeRow()],
    ['conflicted', true, nativeRow({ conflicted: true })],
    ['multiple known IDs', true, nativeRow({ knownIds: ['staged', 'final-1'] })],
    ['nonterminal state', true, nativeRow({ state: 'started' })],
    ['incomplete phase chain', true, nativeRow({ steps: [] })],
  ])('hides status actions for %s rows', async (_label, enabled, row) => {
    mocks.runtimeConfig.mockImplementation(async (key: string) => key === 'meta.mediaHistoryLimit' ? 20 : enabled);
    mocks.query.mockResolvedValue([row]);
    expect((await readFacebookNativeEvidence()).actions).toEqual([]);
  });

  it('reads bounded, content-free proof observations with a safe stable row key', async () => {
    mocks.query.mockResolvedValue([{
      id: 'proof-private-id', operationId: 'operation-1', workspaceId: 'workspace-1', format: 'reel',
      remoteTargetId: 'page-1', remoteId: 'final-1', actorId: 'root-user', outcome: 'published', detail: null,
      observedRevision: 7, appliedRevision: 8, accepted: true,
      observedAt: new Date('2026-10-19T10:00:00.000Z'), createdAt: new Date('2026-10-19T10:00:01.000Z'),
      payloadHash: 'SECRET_HASH', accessToken: 'SECRET_TOKEN',
    }]);
    const evidence = await readFacebookNativeProofEvidence(undefined, 1);
    expect(evidence.items).toEqual([{
      id: `native-proof:${createHash('sha256').update('operation-1:proof-private-id').digest('hex')}`,
      operationId: 'operation-1', workspaceId: 'workspace-1', format: 'reel', state: 'published',
      recordType: 'native_status_proof', remoteId: 'final-1', remoteTargetId: 'page-1', actorId: 'root-user', detail: null,
      accepted: 'Accepted at recorded revision', observedRevision: 7, appliedRevision: 8,
      observedAt: '2026-10-19T10:00:00.000Z', createdAt: '2026-10-19T10:00:01.000Z', updatedAt: '2026-10-19T10:00:01.000Z',
    }]);
    const query = queryCapture(mocks.query);
    expect(query.values).toEqual([2]);
    expect(query.sql).toContain('FROM rebuild_facebook_native_status_proofs p');
    expect(query.sql).not.toContain('payloadHash');
    expect(query.sql).not.toContain('accessToken');
    expect(query.sql).not.toContain('ownerToken');
    expect(evidence.columns.map(column => column.key)).not.toContain('payloadHash');
    expect(JSON.stringify(evidence)).not.toContain('SECRET_');
  });

  it('filters proof history by operation and validates cap and operation before querying', async () => {
    mocks.query.mockResolvedValue([]);
    await readFacebookNativeProofEvidence('operation-1', 4);
    expect(queryCapture(mocks.query).values).toEqual(['operation-1', 5]);
    mocks.query.mockClear();
    await expect(readFacebookNativeProofEvidence(undefined, 0)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readFacebookNativeProofEvidence('bad\noperation', 1)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('requires an accepted published proof at the current revision for both native safety guards', async () => {
    const db = { $queryRaw: mocks.query } as never;
    mocks.query.mockResolvedValue([]);
    await assertFacebookNativeSettled(db, 'workspace-1');
    const settled = queryCapture(mocks.query);
    expect(settled.sql).toContain('FROM rebuild_facebook_native_status_proofs p');
    expect(settled.sql).toContain('p."appliedRevision" = j.revision');
    expect(settled.sql).toContain('p.accepted AND p.outcome = \'published\'');

    mocks.query.mockResolvedValueOnce([{ state: 'confirmed', knownIds: ['final-1'], remoteId: 'final-1', conflicted: false, parentProvider: 'facebook', hasAcceptedProof: false }]);
    await expect(assertFacebookNativeResolution(db, 'workspace-1', 'operation-1', 'PUBLISHED', 'final-1'))
      .rejects.toMatchObject({ code: 'conflict' });
    mocks.query.mockResolvedValueOnce([{ state: 'confirmed', knownIds: ['final-1'], remoteId: 'final-1', conflicted: false, parentProvider: 'facebook', hasAcceptedProof: true }]);
    await expect(assertFacebookNativeResolution(db, 'workspace-1', 'operation-1', 'PUBLISHED', 'final-1')).resolves.toBeUndefined();
    const resolution = queryCapture(mocks.query, 2);
    expect(resolution.sql).toContain('p."appliedRevision" = j.revision');
    expect(resolution.sql).toContain('FOR UPDATE OF j');
  });
});
