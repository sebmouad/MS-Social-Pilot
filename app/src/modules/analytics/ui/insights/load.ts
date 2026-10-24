import { runtimeConfigBatch } from '@/server/config/store';
import { prisma } from '@/server/data';
import { platformAnalytics } from '@/server/platforms/registry';
import { engagementHeatmap, type HeatmapCell, type PerformancePost } from '@/modules/home/server/overview-pure';

/**
 * Stored-data insights for the Analytics overview: best times and the interaction mix per channel.
 * Reads only authorized, already selected channels through each channel's installed module; the
 * measure keys and history bounds are the Root-managed Home settings, so one policy drives both screens.
 */
const KEYS = ['home.heatmapLookbackDays', 'home.heatmapMaxPostsPerChannel', 'home.heatmapMinPosts', 'home.interactionMeasureKeys'] as const;
const DAY = 86_400_000; // Fixed UTC calendar duration, not an operational setting.

export type InsightChannel = { id: string; name: string; providerId?: string };
export type InteractionStack = { categories: string[]; series: Array<{ id: string; name: string; values: Array<number | null> }> };
export type Insights = {
  bestTimes: { cells: HeatmapCell[]; measuredPosts: number; timeZone: string } | null;
  interactions: InteractionStack | null;
};

export async function loadInsights(workspaceId: string, channels: readonly InsightChannel[], window: { from: Date; to: Date }): Promise<Insights> {
  if (!channels.length) return { bestTimes: null, interactions: null };
  const config = await runtimeConfigBatch(KEYS) as Record<(typeof KEYS)[number], unknown>;
  const lookback = Number(config['home.heatmapLookbackDays']), perChannel = Number(config['home.heatmapMaxPostsPerChannel']), minPosts = Number(config['home.heatmapMinPosts']);
  const interactionKeys = Array.isArray(config['home.interactionMeasureKeys']) ? config['home.interactionMeasureKeys'] as string[] : [];
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  const timeZone = workspace?.timezone ?? 'UTC';
  const now = new Date();
  const from = new Date(now.getTime() - lookback * DAY);

  const histories: PerformancePost[][] = [];
  const mix = new Map<string, Map<string, { label: string; value: number | null }>>();
  for (const channel of channels) {
    const host = channel.providerId ? await platformAnalytics(channel.providerId).catch(() => null) : null;
    if (!host) continue;
    if (host.postPerformance) {
      const posts = await host.postPerformance({ workspaceId, targetId: channel.id, from, to: now, limit: perChannel, sort: 'publishedAt', direction: 'desc' }).catch(() => []);
      histories.push(posts.filter(post => post.publishedAt && post.publishedAt >= from && post.publishedAt < now && post.measuredAt && post.measuredAt <= now));
    }
    if (host.destinationMeasures && interactionKeys.length) {
      const measures = await host.destinationMeasures({ workspaceId, targetId: channel.id, ...window }).catch(() => ({ measures: [] }));
      const byKey = new Map<string, { label: string; value: number | null }>();
      for (const measure of measures.measures) if (interactionKeys.includes(measure.key)) byKey.set(measure.key, { label: measure.label, value: measure.value });
      if (byKey.size) mix.set(channel.id, byKey);
    }
  }

  const heat = engagementHeatmap(histories, timeZone, minPosts);
  const stackChannels = channels.filter(channel => mix.has(channel.id));
  const keys = interactionKeys.filter(key => stackChannels.some(channel => mix.get(channel.id)!.has(key)));
  const interactions: InteractionStack | null = stackChannels.length && keys.length ? {
    categories: stackChannels.map(channel => channel.name),
    series: keys.map(key => ({
      id: key,
      name: stackChannels.map(channel => mix.get(channel.id)!.get(key)?.label).find(Boolean) ?? key,
      values: stackChannels.map(channel => mix.get(channel.id)!.get(key)?.value ?? null),
    })),
  } : null;
  return { bestTimes: heat.cells.length ? { ...heat, timeZone } : null, interactions };
}
