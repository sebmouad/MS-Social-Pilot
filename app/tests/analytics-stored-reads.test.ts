import { describe, expect, it, vi } from 'vitest';
import type { PlatformAnalyticsHost, PostPerformance } from '@/server/platforms/host';
import { readChannelMeasures, readChannelPostHistory, type BatchedAnalyticsReads, type ChannelMeasuresRequest } from '@/modules/analytics/server/stored-reads';

const current = { from: new Date('2026-10-01'), to: new Date('2026-11-01') };
const previous = { from: new Date('2026-09-01'), to: current.from };
const request: ChannelMeasuresRequest = { workspaceId: 'tenant', targetIds: ['a', 'b', 'a'], current, previous };
const measures = { views: 12, engagements: 2, audienceGained: null };
const host = (reads: BatchedAnalyticsReads & Partial<PlatformAnalyticsHost>): PlatformAnalyticsHost & BatchedAnalyticsReads => ({ load: vi.fn(), ...reads });
const post = (id: string, at = '2026-10-10', measuredAt = '2026-10-11'): PostPerformance => ({ postId: id, publishedAt: new Date(at), measuredAt: new Date(measuredAt), text: '', url: null, rankValue: 1, rankLabel: '', measures: [] });

describe('neutral stored analytics batch ports', () => {
  it('uses one batch, keeps missing channels unknown and excludes foreign results', async () => {
    const batch = vi.fn(async () => [{ targetId: 'a', current: measures, previous: null, mix: [] }, { targetId: 'foreign', current: measures, previous: measures, mix: [] }]);
    const single = vi.fn();
    const result = await readChannelMeasures(host({ channelMeasuresBatch: batch, goalMeasures: single }), request);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith({ ...request, targetIds: ['a', 'b'] });
    expect(single).not.toHaveBeenCalled();
    expect(result).toEqual([{ targetId: 'a', current: measures, previous: null, mix: [] }, { targetId: 'b', current: null, previous: null, mix: [] }]);
  });

  it('preserves old adapter semantics using two goal reads and one mix read per unique channel', async () => {
    const goals = vi.fn(async () => measures), mix = vi.fn(async () => ({ measures: [] }));
    const result = await readChannelMeasures(host({ goalMeasures: goals, destinationMeasures: mix }), request);
    expect(result).toHaveLength(2);
    expect(goals).toHaveBeenCalledTimes(4);
    expect(mix).toHaveBeenCalledTimes(2);
    expect(goals).toHaveBeenCalledWith({ workspaceId: 'tenant', targetId: 'a', ...previous });
  });

  it('never fans out after a failed batch', async () => {
    const batch = vi.fn(async () => { throw new Error('stored read failed'); }), single = vi.fn();
    await expect(readChannelMeasures(host({ channelMeasuresBatch: batch, goalMeasures: single }), request)).rejects.toThrow('stored read failed');
    expect(batch).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });

  it('bounds history per channel and rejects future/out-of-window/foreign observations', async () => {
    const batch = vi.fn(async () => [
      { targetId: 'b', posts: [post('before', '2026-09-30'), post('future', '2026-11-01'), post('measured-later', '2026-10-12', '2026-11-02'), post('b')] },
      { targetId: 'a', posts: [post('a'), post('a2')] }, { targetId: 'foreign', posts: [post('secret')] },
    ]);
    const single = vi.fn();
    const result = await readChannelPostHistory(host({ postPerformanceBatch: batch, postPerformance: single }), { workspaceId: 'tenant', targetIds: ['a', 'b', 'missing', 'a'], ...current, limit: 1, sort: 'publishedAt', direction: 'desc' });
    expect(result.map(posts => posts.map(item => item.postId))).toEqual([['a'], ['b'], []]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });

  it('does no storage work for empty target selections', async () => {
    const batch = vi.fn(), posts = vi.fn();
    const adapter = host({ channelMeasuresBatch: batch, postPerformanceBatch: posts });
    expect(await readChannelMeasures(adapter, { ...request, targetIds: [] })).toEqual([]);
    expect(await readChannelPostHistory(adapter, { workspaceId: 'tenant', targetIds: [], ...current, limit: 10 })).toEqual([]);
    expect(batch).not.toHaveBeenCalled(); expect(posts).not.toHaveBeenCalled();
  });
});
