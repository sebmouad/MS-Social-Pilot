import { prisma } from '@/server/data';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { runtimeConfigBatch } from '@/server/config/store';
import { platformAnalytics } from '@/server/platforms/registry';
import { readAnalyticsSnapshot } from '@/modules/analytics/server/read';
import { readChannelPostHistory } from '@/modules/analytics/server/stored-reads';
import { engagementHeatmap, type HeatmapCell } from './overview-pure';

const DAY = 86_400_000;
const KEYS = ['home.heatmapLookbackDays', 'home.heatmapMaxPostsPerChannel', 'home.heatmapMinPosts', 'home.maxChannels'] as const;

/**
 * The same weekday/hour engagement heatmap as Home's best-times card, for other screens (the calendar overlay).
 * Built from stored post history of the viewer's selected channels; null when Analytics cannot be read.
 */
export async function readBestTimeHeatmap(actor: { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] }, timeZone: string, now = new Date()): Promise<{ cells: HeatmapCell[]; measuredPosts: number } | null> {
  try {
    // Post history has no authorization of its own: require the same feature as Home's best-times card.
    const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId)]);
    if (!entitlements || !permissions || !canUseFeature(entitlements, 'analytics/posts') || !canAccessFeature(permissions, 'analytics/posts')) return null;
    const config = await runtimeConfigBatch(KEYS) as Record<(typeof KEYS)[number], unknown>;
    const snapshot = await readAnalyticsSnapshot({ userId: actor.userId, workspaceId: actor.workspaceId }, {}, { feature: 'analytics/overview', ...(actor.allowedChannelIds ? { allowedChannelIds: actor.allowedChannelIds } : {}) });
    const channels = snapshot.options.channels.filter(channel => snapshot.selected.channelIds.includes(channel.id)).slice(0, Number(config['home.maxChannels']));
    if (!channels.length) return { cells: [], measuredPosts: 0 };
    const rows = await prisma.$queryRaw<Array<{ id: string; provider: string }>>`SELECT t.id, a.provider FROM targets t JOIN social_accounts a ON a.id = t."socialAccountId" AND a."workspaceId" = t."workspaceId" WHERE t."workspaceId" = ${actor.workspaceId} AND t.id = ANY(${channels.map(channel => channel.id)}::text[])`;
    const byProvider = new Map<string, string[]>();
    for (const row of rows) byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row.id]);
    const from = new Date(now.getTime() - Number(config['home.heatmapLookbackDays']) * DAY);
    const groups = await Promise.all([...byProvider].map(async ([provider, targetIds]) => {
      const host = await platformAnalytics(provider);
      return host ? readChannelPostHistory(host, { workspaceId: actor.workspaceId, targetIds, from, to: now, limit: Number(config['home.heatmapMaxPostsPerChannel']), sort: 'publishedAt', direction: 'desc' }) : [];
    }));
    return engagementHeatmap(groups.flat(), timeZone, Number(config['home.heatmapMinPosts']));
  } catch {
    return null;
  }
}
