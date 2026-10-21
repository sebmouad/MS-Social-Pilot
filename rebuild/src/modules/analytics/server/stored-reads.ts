import type { DestinationMeasures, GoalMeasures, PlatformAnalyticsHost, PostPerformance, PostPerformanceRequest } from '@/server/platforms/host';

export type ChannelMeasuresRequest = {
  workspaceId: string;
  /** Already authorized, selected channels belonging to this host. */
  targetIds: readonly string[];
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
};
export type ChannelMeasures = {
  targetId: string;
  current: GoalMeasures | null;
  previous: GoalMeasures | null;
  mix: DestinationMeasures['measures'];
};

/**
 * Neutral optional storage ports. Adapters own SQL, metric semantics and tenant
 * checks. Batching must happen in storage, not by looping over the single read.
 * Kept with Analytics until the host owner registers these optional methods.
 */
export type BatchedAnalyticsReads = {
  channelMeasuresBatch?(request: ChannelMeasuresRequest): Promise<ChannelMeasures[]>;
  /** Limit applies independently to each target, in storage before hydration. */
  postPerformanceBatch?(request: Omit<PostPerformanceRequest, 'targetId' | 'offset'> & { targetIds: readonly string[] }): Promise<Array<{ targetId: string; posts: PostPerformance[] }>>;
};

export async function readChannelMeasures(host: PlatformAnalyticsHost & BatchedAnalyticsReads, request: ChannelMeasuresRequest): Promise<ChannelMeasures[]> {
  const targetIds = [...new Set(request.targetIds)];
  if (!targetIds.length) return [];
  if (host.channelMeasuresBatch) {
    const rows = await host.channelMeasuresBatch({ ...request, targetIds });
    const byId = new Map(rows.map(row => [row.targetId, row]));
    // Missing data stays unknown; never retry individual reads after a partial batch.
    return targetIds.map(targetId => byId.get(targetId) ?? { targetId, current: null, previous: null, mix: [] });
  }
  return Promise.all(targetIds.map(async targetId => {
    if (!host.goalMeasures) return { targetId, current: null, previous: null, mix: [] };
    const [current, previous, mix] = await Promise.all([
      host.goalMeasures({ workspaceId: request.workspaceId, targetId, ...request.current }),
      host.goalMeasures({ workspaceId: request.workspaceId, targetId, ...request.previous }),
      host.destinationMeasures?.({ workspaceId: request.workspaceId, targetId, ...request.current }),
    ]);
    return { targetId, current, previous, mix: mix?.measures ?? [] };
  }));
}

export async function readChannelPostHistory(host: PlatformAnalyticsHost & BatchedAnalyticsReads, request: Omit<PostPerformanceRequest, 'targetId' | 'offset'> & { targetIds: readonly string[] }): Promise<PostPerformance[][]> {
  const targetIds = [...new Set(request.targetIds)];
  if (!targetIds.length) return [];
  const rows = host.postPerformanceBatch ? await host.postPerformanceBatch({ ...request, targetIds })
    : await Promise.all(targetIds.map(async targetId => ({ targetId, posts: await host.postPerformance?.({ workspaceId: request.workspaceId, targetId, from: request.from, to: request.to, limit: request.limit, sort: request.sort, direction: request.direction }) ?? [] })));
  const byId = new Map(rows.map(row => [row.targetId, row.posts]));
  return targetIds.map(targetId => (byId.get(targetId) ?? [])
    .filter(post => post.publishedAt && post.publishedAt >= request.from && post.publishedAt < request.to && post.measuredAt && post.measuredAt <= request.to)
    .slice(0, request.limit));
}
