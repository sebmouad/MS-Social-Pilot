import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ query: vi.fn(), runtimeConfig: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));

import { readFacebookNativeScheduleEvidence } from '../src/platforms/facebook/formats/journal-recovery';

const row = (overrides: Record<string, unknown> = {}) => ({
  changeId: 'op-1:reschedule:1900000000', workspaceId: 'ws-1', publishOperationId: 'op-1', kind: 'reschedule',
  scheduledUnix: BigInt(1900000000), remoteId: 'video-1', remoteTargetId: 'page-1', revision: 1, state: 'published',
  createdAt: new Date('2026-10-20T10:00:00.000Z'), updatedAt: new Date('2026-10-20T10:01:00.000Z'),
  ownerToken: 'SECRET_TOKEN', ...overrides,
});

describe('Facebook native schedule change evidence', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.runtimeConfig.mockReset().mockImplementation(async (key: string) => key === 'meta.mediaHistoryLimit' ? 20 : false);
  });

  it('returns content-free rows with a hashed row key and no owner token', async () => {
    mocks.query.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([row(), row({ changeId: 'op-1:cancel', kind: 'cancel', scheduledUnix: null, state: 'uncertain' })]);
    const evidence = await readFacebookNativeScheduleEvidence(undefined, 5);
    expect(evidence.items).toHaveLength(2);
    expect(evidence.items[0]).toMatchObject({
      id: `native-schedule:${createHash('sha256').update('ws-1:op-1:reschedule:1900000000').digest('hex')}`,
      operationId: 'op-1', recordType: 'native_schedule_change', changeKind: 'Reschedule', newScheduleUnix: '1900000000', state: 'published',
    });
    expect(evidence.items[1]).toMatchObject({ changeKind: 'Cancel scheduled publication', newScheduleUnix: 'Not applicable', state: 'uncertain' });
    expect(JSON.stringify(evidence)).not.toContain('SECRET_');
    expect(evidence.actions).toEqual([]);
    const [strings, ...values] = mocks.query.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).not.toContain('ownerToken');
    expect(values).toEqual([6]);
  });

  it('reports truncation and filters by operation', async () => {
    mocks.query.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([row(), row({ changeId: 'op-1:cancel' })]);
    const evidence = await readFacebookNativeScheduleEvidence('op-1', 1);
    expect(evidence.items).toHaveLength(1);
    expect(evidence.truncated).toBe(true);
    expect((mocks.query.mock.calls[1] as unknown[]).slice(1)).toEqual(['op-1', 2]);
  });

  it('returns an empty list when the migration is not applied', async () => {
    mocks.query.mockResolvedValueOnce([{ present: false }]);
    const evidence = await readFacebookNativeScheduleEvidence();
    expect(evidence.items).toEqual([]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('validates the cap and operation before querying', async () => {
    await expect(readFacebookNativeScheduleEvidence(undefined, 0)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readFacebookNativeScheduleEvidence('bad\noperation', 1)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
