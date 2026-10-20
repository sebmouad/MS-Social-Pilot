import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ rootQuery: vi.fn(), runtimeConfig: vi.fn() }));

vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: mocks.rootQuery } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));

import { OperationError } from '../src/lib/operation-error';
import {
  assertFacebookNativeResolution,
  assertFacebookNativeSettled,
  readFacebookNativeEvidence,
} from '../src/platforms/facebook/formats/journal-recovery';

function queryCapture(mock: ReturnType<typeof vi.fn>, call = 0) {
  const [strings, ...values] = mock.mock.calls[call] as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join('?'), values };
}

function transaction(query: ReturnType<typeof vi.fn>) {
  return { $queryRaw: query } as never;
}

describe('Facebook native journal recovery guards', () => {
  let query: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    query = vi.fn();
    mocks.rootQuery.mockReset();
    mocks.runtimeConfig.mockReset().mockResolvedValue(100);
  });

  it('short-circuits an explicit empty target selection', async () => {
    await expect(assertFacebookNativeSettled(transaction(query), 'workspace-a', [])).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('uses workspace and requested target scope and blocks unresolved child receipts', async () => {
    query.mockResolvedValue([{ operationId: 'operation-a' }]);

    await expect(assertFacebookNativeSettled(transaction(query), 'workspace-a', ['target-a', 'target-b']))
      .rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });

    const captured = queryCapture(query);
    expect(captured.sql).toContain('FROM rebuild_facebook_native_journal j');
    expect(captured.sql).toContain('JOIN rebuild_publication_attempts a');
    expect(captured.sql).toContain('a."workspaceId" = j."workspaceId" AND a.id = j."operationId"');
    expect(captured.sql).toContain('j."targetId" = ANY(?::text[])');
    expect(captured.values).toEqual(['workspace-a', ['target-a', 'target-b']]);
    expect(captured.sql).toContain('SELECT j."operationId"');
    expect(captured.sql).toContain('LIMIT 1');
    expect(captured.sql).toContain("j.state = 'rejected' AND j.\"knownIds\" = '[]'::jsonb AND NOT j.conflicted");
    expect(captured.sql).toContain("j.state = 'deleted' AND NOT j.conflicted");
    expect(captured.sql).toContain("j.state = 'confirmed' AND NOT j.conflicted");
    expect(captured.sql).toContain("a.state IN ('receipt_recorded', 'projected')");
    expect(captured.sql).toContain('a."remotePostId" = j."remoteId"');
  });

  it('allows the guard when the scoped journal has no unresolved receipts', async () => {
    query.mockResolvedValue([]);
    await expect(assertFacebookNativeSettled(transaction(query), 'workspace-a')).resolves.toBeUndefined();
    expect(queryCapture(query).values).toEqual(['workspace-a']);
  });

  it('holds removal while a schedule change may have reached Facebook', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ changeId: 'operation-a:cancel' }]);
    await expect(assertFacebookNativeSettled(transaction(query), 'workspace-a', ['target-a']))
      .rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
    const captured = queryCapture(query, 2);
    expect(captured.sql).toContain('FROM rebuild_facebook_native_schedule_changes c');
    expect(captured.sql).toContain("c.state IN ('started', 'uncertain')");
    expect(captured.sql).toContain('j."targetId" = ANY(?::text[])');
    expect(captured.values).toEqual(['workspace-a', ['target-a']]);
  });

  it('ignores schedule changes when their table is absent or all are settled', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ present: false }]);
    await expect(assertFacebookNativeSettled(transaction(query), 'workspace-a')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    query.mockReset();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([]);
    await expect(assertFacebookNativeSettled(transaction(query), 'workspace-a')).resolves.toBeUndefined();
    expect(queryCapture(query, 2).values).toEqual(['workspace-a']);
  });

  it('leaves publications without a child journal to the existing neutral outcome guard', async () => {
    query.mockResolvedValue([]);
    await expect(assertFacebookNativeResolution(transaction(query), 'workspace-a', 'operation-a', 'ABSENT')).resolves.toBeUndefined();
    const captured = queryCapture(query);
    expect(captured.values).toEqual(['workspace-a', 'operation-a']);
    expect(captured.sql).toContain('LEFT JOIN rebuild_publication_attempts a');
    expect(captured.sql).toContain('a."workspaceId" = j."workspaceId" AND a.id = j."operationId"');
  });

  it.each([
    { outcome: 'ABSENT' as const, row: { state: 'rejected', knownIds: [], remoteId: null, conflicted: false, parentProvider: 'facebook' } },
    { outcome: 'ABSENT' as const, row: { state: 'deleted', knownIds: ['staged-photo'], remoteId: 'final', conflicted: false, parentProvider: 'facebook' } },
  ])('allows only settled $outcome receipts for native resolution', async ({ outcome, row }) => {
    query.mockResolvedValue([row]);
    await expect(assertFacebookNativeResolution(transaction(query), 'workspace-a', 'operation-a', outcome)).resolves.toBeUndefined();
  });

  it.each([
    { state: 'rejected', knownIds: ['orphan-photo'], remoteId: null, conflicted: false, parentProvider: 'facebook' },
    { state: 'deleted', knownIds: [], remoteId: null, conflicted: true, parentProvider: 'facebook' },
    { state: 'confirmed', knownIds: ['remote-final'], remoteId: 'remote-final', conflicted: false, parentProvider: 'facebook' },
  ])('holds ABSENT resolution when native delivery is not safely absent', async row => {
    query.mockResolvedValue([row]);
    await expect(assertFacebookNativeResolution(transaction(query), 'workspace-a', 'operation-a', 'ABSENT'))
      .rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
  });

  it('requires an unconflicted final confirmed ID match for PUBLISHED resolution', async () => {
    query.mockResolvedValue([{ state: 'confirmed', knownIds: ['remote-final'], remoteId: 'remote-final', conflicted: false, parentProvider: 'facebook', hasAcceptedProof: true }]);
    await expect(assertFacebookNativeResolution(transaction(query), 'workspace-a', 'operation-a', 'PUBLISHED', 'remote-final')).resolves.toBeUndefined();

    await expect(assertFacebookNativeResolution(transaction(query), 'workspace-a', 'operation-a', 'PUBLISHED', 'upload-id'))
      .rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('holds a confirmed flag that has no accepted identity-bound proof', async () => {
    query.mockResolvedValue([{ state: 'confirmed', knownIds: ['remote-final'], remoteId: 'remote-final',
      conflicted: false, parentProvider: 'facebook', hasAcceptedProof: false }]);
    await expect(assertFacebookNativeResolution(transaction(query), 'workspace-a', 'operation-a', 'PUBLISHED', 'remote-final'))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('reads bounded content-free Root evidence and omits private payload and fence fields', async () => {
    const createdAt = new Date('2026-10-18T10:00:00.000Z');
    const updatedAt = new Date('2026-10-18T10:05:00.000Z');
    mocks.rootQuery.mockResolvedValue([
      { operationId: 'operation-a', workspaceId: 'workspace-a', targetId: 'target-a', format: 'reel', state: 'uncertain', remoteId: null, knownIds: ['upload-a'], conflicted: false, createdAt, updatedAt },
      { operationId: 'operation-b', workspaceId: 'workspace-b', targetId: 'target-b', format: 'video', state: 'confirmed', remoteId: 'remote-b', knownIds: ['upload-b', 'remote-b'], conflicted: true, createdAt, updatedAt },
    ]);

    const evidence = await readFacebookNativeEvidence(undefined, 1);
    expect(evidence).toMatchObject({ title: expect.any(String), truncated: true });
    expect(evidence.items).toEqual([{
      id: `native:${createHash('sha256').update('operation-a').digest('hex')}`, operationId: 'operation-a', workspaceId: 'workspace-a', targetId: 'target-a', format: 'reel', state: 'uncertain',
      recordType: 'native', remoteId: null, knownIds: 'upload-a', conflicted: 'No',
      createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:05:00.000Z',
    }]);

    const captured = queryCapture(mocks.rootQuery);
    expect(captured.values).toEqual([2]);
    expect(mocks.runtimeConfig).toHaveBeenCalledWith('meta.mediaHistoryLimit');
    expect(captured.sql).toContain('JOIN rebuild_publication_attempts a');
    expect(captured.sql).toContain("WHERE a.provider = 'facebook'");
    expect(captured.sql).not.toContain('"payloadHash"');
    expect(captured.sql).not.toContain('"ownerToken"');
    expect(captured.sql).toContain('j.steps'); // Used privately to decide eligibility; never returned as a cell.
    expect(evidence.items[0]).not.toHaveProperty('steps');
    expect(captured.sql).not.toContain('j."workspaceId" =');
    expect(evidence.columns.map(column => column.key)).not.toContain('payloadHash');
    expect(evidence.columns.map(column => column.key)).not.toContain('ownerToken');
  });

  it('keeps schema-valid long receipt lists inside the shared evidence wire bound', async () => {
    mocks.rootQuery.mockResolvedValue([{ operationId: 'o'.repeat(2048), workspaceId: 'w', targetId: 't', format: 'reel',
      state: 'published', remoteId: 'x'.repeat(2048), knownIds: ['x'.repeat(2048), 'y'.repeat(2048)], conflicted: false,
      createdAt: new Date('2026-10-18T10:00:00Z'), updatedAt: new Date('2026-10-18T10:00:00Z') }]);
    const evidence = await readFacebookNativeEvidence(undefined, 1);
    const row = evidence.items[0];
    expect(row.state).toBe('submitted');
    expect(row.knownIds).toBe('2 known IDs (list summarized)');
    expect(String(row.id).length).toBeLessThan(2048);
    expect(Object.values(row).every(value => typeof value !== 'string' || value.length <= 2048)).toBe(true);
  });

  it('binds operation filtering and rejects invalid caller limits before querying', async () => {
    mocks.rootQuery.mockResolvedValue([]);
    await readFacebookNativeEvidence('operation-a', 4);
    const filtered = queryCapture(mocks.rootQuery);
    expect(filtered.values).toEqual(['operation-a', 5]);
    expect(filtered.sql).toContain('j."operationId" = ?');

    mocks.rootQuery.mockClear();
    await expect(readFacebookNativeEvidence(undefined, 0)).rejects.toMatchObject({ name: 'OperationError', code: 'invalid_request' });
    await expect(readFacebookNativeEvidence('bad\noperation', 4)).rejects.toMatchObject({ name: 'OperationError', code: 'invalid_request' });
    expect(mocks.rootQuery).not.toHaveBeenCalled();
  });

  it('uses the configured cap when caller omits one and applies one query lookahead row', async () => {
    mocks.runtimeConfig.mockResolvedValue(4);
    mocks.rootQuery.mockResolvedValue([]);
    await readFacebookNativeEvidence();
    expect(queryCapture(mocks.rootQuery).values).toEqual([5]);
  });

  it('accepts Root’s lookahead row while enforcing the configured media-history ceiling', async () => {
    mocks.runtimeConfig.mockResolvedValue(1000);
    mocks.rootQuery.mockResolvedValue([]);
    await readFacebookNativeEvidence(undefined, 1001);
    expect(queryCapture(mocks.rootQuery).values).toEqual([1001]);
  });

  it('fails closed when the configured media-history limit is not a positive safe integer', async () => {
    mocks.runtimeConfig.mockResolvedValue(Number.NaN);
    await expect(readFacebookNativeEvidence(undefined, 1)).rejects.toMatchObject({ name: 'OperationError', code: 'unavailable' });
    expect(mocks.rootQuery).not.toHaveBeenCalled();
  });
});
