import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  runtimeConfig: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  parentState: 'started',
}));

vi.mock('@/server/data', () => ({ prisma: { $transaction: db.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: db.runtimeConfig }));

import { assertFacebookMediaResolution, assertFacebookMediaSettled, facebookMediaJournal } from '@/platforms/facebook/media-journal';

const parent = {
  workspaceId: 'workspace-1', postId: 'post-1', postTargetId: 'post-target-1',
  targetId: 'target-1', actorId: 'actor-1', providerId: 'remote-page-1',
};
const tx = { $queryRaw: db.queryRaw, $executeRaw: db.executeRaw };

function sql(strings: TemplateStringsArray) { return strings.join('?'); }

describe('Facebook media upload journal', () => {
  beforeEach(() => {
    db.rows = [];
    db.parentState = 'started';
    db.transaction.mockImplementation(async (work: (client: unknown) => unknown) => work(tx));
    db.runtimeConfig.mockImplementation(async (key: string) => key === 'publishing.maxRemoteMediaPerPost' ? 10 : 100);
    db.queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql(strings);
      if (query.includes('FROM rebuild_publication_attempts')) {
        return db.parentState === 'started' ? [parent] : [];
      }
      if (query.includes('SELECT id FROM rebuild_facebook_media_steps')) {
        return db.rows.filter(row => row.operationId === values[0] && row.phase === values[1] && row.ordinal === values[2]).map(row => ({ id: row.id }));
      }
      if (query.includes("AND \"phase\" = 'photo'")) {
        return db.rows.filter(row => row.workspaceId === values[0] && row.operationId === values[1] && row.phase === 'photo').sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
      }
      if (query.includes('SELECT step.id FROM rebuild_facebook_media_steps')) {
        return db.rows.filter(row => row.workspaceId === values[0] && (
          row.state === 'started' || row.state === 'uncertain'
          || row.phase === 'photo' && row.state === 'recorded' && !db.rows.some(feed => feed.operationId === row.operationId && feed.phase === 'feed' && feed.state === 'recorded')
        )).map(row => ({ id: row.id }));
      }
      if (query.includes('FROM rebuild_facebook_media_steps')) {
        return db.rows.filter(row => row.workspaceId === values[0] && row.operationId === values[1]
          && (values[2] === undefined || row.phase === values[2]) && (values[3] === undefined || row.ordinal === values[3]));
      }
      return [];
    });
    db.executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql(strings);
      if (query.includes('INSERT INTO rebuild_facebook_media_steps')) {
        db.rows.push({ id: values[0], workspaceId: values[1], operationId: values[2], postId: values[3], postTargetId: values[4], targetId: values[5], actorId: values[6], remoteTargetId: values[7], phase: values[8], ordinal: values[9], state: 'started', remoteId: null });
        return 1;
      }
      if (query.includes('UPDATE rebuild_facebook_media_steps')) {
        const [state, remoteId, , , workspaceId, operationId, phase, ordinal] = values;
        const row = db.rows.find(item => item.workspaceId === workspaceId && item.operationId === operationId && item.phase === phase && item.ordinal === ordinal && item.state === 'started');
        if (!row) return 0;
        Object.assign(row, { state, remoteId });
        return 1;
      }
      return 0;
    });
  });

  it('commits each ordered photo intent and receipt before opening the feed step', async () => {
    const journal = facebookMediaJournal('operation-1', 'remote-page-1');
    await journal.beginPhoto(1);
    expect(db.rows[0]).toMatchObject({ workspaceId: 'workspace-1', operationId: 'operation-1', phase: 'photo', ordinal: 1, state: 'started' });
    await journal.recordPhoto(1, 'photo-1');
    await journal.beginPhoto(2);
    await journal.recordPhoto(2, 'photo-2');
    await journal.beginFeed(['photo-1', 'photo-2']);
    await journal.recordFeed('feed-1');

    expect(db.transaction).toHaveBeenCalledTimes(6);
    expect(db.rows.map(row => [row.phase, row.ordinal, row.state, row.remoteId])).toEqual([
      ['photo', 1, 'recorded', 'photo-1'], ['photo', 2, 'recorded', 'photo-2'], ['feed', 0, 'recorded', 'feed-1'],
    ]);
  });

  it('holds a started upload and refuses replay or later photos until it is resolved', async () => {
    const journal = facebookMediaJournal('operation-1', 'remote-page-1');
    await journal.beginPhoto(1);
    await expect(journal.beginPhoto(1)).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.beginPhoto(2)).rejects.toMatchObject({ code: 'conflict' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ state: 'started', remoteId: null });
  });

  it('requires the exact ordered receipts and an active Facebook parent before feed dispatch', async () => {
    const journal = facebookMediaJournal('operation-1', 'remote-page-1');
    await journal.beginPhoto(1);
    await journal.recordPhoto(1, 'photo-1');
    await journal.beginPhoto(2);
    await journal.recordPhoto(2, 'photo-2');
    await expect(journal.beginFeed(['photo-2', 'photo-1'])).rejects.toMatchObject({ code: 'conflict' });

    db.parentState = 'uncertain';
    await expect(journal.beginFeed(['photo-1', 'photo-2'])).rejects.toMatchObject({ code: 'conflict' });
    expect(db.rows.filter(row => row.phase === 'feed')).toHaveLength(0);
  });

  it('records a definite rejection without a remote receipt and prevents subsequent photos', async () => {
    const journal = facebookMediaJournal('operation-1', 'remote-page-1');
    await journal.beginPhoto(1);
    await journal.rejectPhoto(1);
    expect(db.rows[0]).toMatchObject({ state: 'rejected', remoteId: null });

    await journal.beginPhoto(2).catch(() => undefined);
    expect(db.rows).toHaveLength(1);
  });

  it('permits PUBLISHED only with a matching feed receipt and holds unresolved workspace evidence', async () => {
    const journal = facebookMediaJournal('operation-1', 'remote-page-1');
    await journal.beginPhoto(1);
    await journal.recordPhoto(1, 'photo-1');
    await journal.beginPhoto(2);
    await journal.recordPhoto(2, 'photo-2');
    await journal.beginFeed(['photo-1', 'photo-2']);

    await expect(assertFacebookMediaResolution(tx as never, 'workspace-1', 'operation-1', 'PUBLISHED', 'feed-1'))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaSettled(tx as never, 'workspace-1'))
      .rejects.toMatchObject({ code: 'conflict' });

    await journal.recordFeed('feed-1');
    await expect(assertFacebookMediaResolution(tx as never, 'workspace-1', 'operation-1', 'PUBLISHED', 'another-feed'))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(assertFacebookMediaResolution(tx as never, 'workspace-1', 'operation-1', 'PUBLISHED', 'feed-1')).resolves.toBeUndefined();
    await expect(assertFacebookMediaSettled(tx as never, 'workspace-1')).resolves.toBeUndefined();
  });

  it('blocks ABSENT when a known staged photo could still be attached to a post', async () => {
    const journal = facebookMediaJournal('operation-1', 'remote-page-1');
    await journal.beginPhoto(1);
    await journal.recordPhoto(1, 'photo-1');
    await expect(assertFacebookMediaResolution(tx as never, 'workspace-1', 'operation-1', 'ABSENT'))
      .rejects.toMatchObject({ code: 'conflict' });
  });
});
