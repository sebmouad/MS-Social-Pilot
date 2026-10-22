
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { z } from 'zod';
import { addDaysToKey, instantToWall, isValidTimeZone, weekdayOfKey, wallTimeToInstant } from '@/lib/calendar-dates';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { platformAnalytics } from '@/server/platforms/registry';
import { authorizePublishing } from './access';
import { limits, validateTargets } from './lifecycle';
import type { PublishingActor } from './types';
import { describeChannelHistory, suggestBestTimes, type BestTimeSlot } from './best-time-ranking';

const inputSchema = z.object({ targetIds: z.array(z.string().trim().min(1).max(200)).min(1) }).strict();
export type BestTimeSuggestion = BestTimeSlot & { nextAt: string; date: string; time: string };
/** Why a channel has slots or honestly has none: insufficient history, no slot above its median, no stored hook, or no access. */
export type BestTimeChannelReason = 'ok' | 'insufficient_history' | 'no_lift' | 'unsupported' | 'no_access';
export type BestTimeChannel = { targetId: string; name: string; basis: number; reason: BestTimeChannelReason; slots: BestTimeSuggestion[] };
export type BestTimeSuggestions = { mode: 'suggest' | 'apply'; timeZone: string; windowDays: number; suggestions: BestTimeSuggestion[]; perTarget: BestTimeChannel[] };

function withNextOccurrences(slots: readonly BestTimeSlot[], timeZone: string, now: Date, horizonDays: number): BestTimeSuggestion[] {
  const today = instantToWall(now, timeZone).date;
  const dated: BestTimeSuggestion[] = [];
  for (const slot of slots) {
    const time = `${String(slot.hour).padStart(2, '0')}:00`;
    for (let offset = 0; offset <= horizonDays; offset++) {
      const date = addDaysToKey(today, offset);
      if (weekdayOfKey(date) !== slot.dayOfWeek) continue;
      const at = wallTimeToInstant(date, time, timeZone);
      if (!at.ok || at.instant <= now || at.instant.getTime() > now.getTime() + horizonDays * 86_400_000) continue;
      dated.push({ ...slot, nextAt: at.instant.toISOString(), date, time }); break;
    }
  }
  return dated;
}

/** UI, HTTP, MCP and queue all read the same current authority, selected destinations and stored-only measures. */
export async function getBestTimeSuggestions(actor: PublishingActor, input: unknown, now = new Date()): Promise<BestTimeSuggestions> {
  const errorText = await loadPublishingErrorText();
  const auth = await authorizePublishing(actor, 'publishing/posts', 'read');
  const parsed = inputSchema.safeParse(input);
  const maxTargets = (await limits()).maxTargets;
  if (!parsed.success || parsed.data.targetIds.length > maxTargets || new Set(parsed.data.targetIds).size !== parsed.data.targetIds.length) {
    throw new PublishingOperationError('invalid_request', 'chooseValidDistinctDestinationsChoisissezDesDestinationsDistinctesValides', {}, errorText);
  }
  const ids = parsed.data.targetIds;
  if (auth.actor.allowedTargetIds && ids.some(id => !auth.actor.allowedTargetIds!.includes(id))) throw new PublishingOperationError('forbidden', 'aDestinationIsOutsideYourChannelAccessUneDestination', {}, errorText);
  const targets = await validateTargets(auth.actor, ids, maxTargets);
  const [workspace] = await prisma.$queryRaw<Array<{ timezone: string; bestTimeMode: string }>>`SELECT timezone, "bestTimeMode" FROM workspaces WHERE id = ${actor.workspaceId}`;
  if (!workspace || !isValidTimeZone(workspace.timezone) || !['suggest', 'apply'].includes(workspace.bestTimeMode)) {
    throw new PublishingOperationError('unavailable', 'workspaceTimingSettingsAreUnavailableLesParamtresHorairesSont', {}, errorText);
  }
  const [lookbackDays, maxPosts, minHistory, minPostsPerSlot, minLift, maxSuggestions, horizonDays] = await Promise.all([
    runtimeConfig('publishing.bestTimeLookbackDays'), runtimeConfig('publishing.bestTimeMaxPosts'),
    runtimeConfig('publishing.bestTimeMinHistory'), runtimeConfig('publishing.bestTimeMinPostsPerSlot'),
    runtimeConfig('publishing.bestTimeMinLift'), runtimeConfig('publishing.bestTimeMaxSuggestions'), runtimeConfig('publishing.collab.queueLookaheadDays'),
  ]);
  const ranking = { minHistory: Number(minHistory), minPostsPerSlot: Number(minPostsPerSlot), minLift: Number(minLift), maxSuggestions: Number(maxSuggestions) };
  const result: BestTimeSuggestions = { mode: workspace.bestTimeMode as 'suggest' | 'apply', timeZone: workspace.timezone, windowDays: Number(lookbackDays), suggestions: [], perTarget: [] };
  const names = new Map((await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${ids})`).map(row => [row.id, row.name]));
  const channelName = (id: string) => names.get(id) ?? id;
  // Only members with current Analytics Posts read access contribute stored performance.
  if (!canUseFeature(auth.entitlements, 'analytics/posts') || !canAccessFeature(auth.permissions, 'analytics/posts')) {
    result.perTarget = targets.map(target => ({ targetId: target.id, name: channelName(target.id), basis: 0, reason: 'no_access' as const, slots: [] }));
    return result;
  }
  const from = new Date(now.getTime() - Number(lookbackDays) * 86_400_000);
  const histories = [];
  let allSupported = true;
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    const host = provider ? await platformAnalytics(provider) : null;
    if (!host?.postPerformance) {
      allSupported = false;
      result.perTarget.push({ targetId: target.id, name: channelName(target.id), basis: 0, reason: 'unsupported', slots: [] });
      histories.push([]);
      continue;
    }
    const posts = await host.postPerformance({ workspaceId: actor.workspaceId, targetId: target.id, from, to: now, limit: Number(maxPosts), sort: 'publishedAt', direction: 'desc' });
    const history = posts.filter(post => post.publishedAt && post.publishedAt >= from && post.publishedAt < now && post.measuredAt && post.measuredAt <= now);
    histories.push(history);
    const channel = describeChannelHistory(history, workspace.timezone, ranking);
    result.perTarget.push({
      targetId: target.id, name: channelName(target.id), basis: channel.measured,
      reason: channel.slots.length ? 'ok' : channel.measured < ranking.minHistory ? 'insufficient_history' : 'no_lift',
      slots: withNextOccurrences(channel.slots, workspace.timezone, now, Number(horizonDays)),
    });
  }
  // Combined suggestions still need every selected destination behind the same cell.
  if (!allSupported) return result;
  result.suggestions = withNextOccurrences(suggestBestTimes(histories, workspace.timezone, ranking), workspace.timezone, now, Number(horizonDays));
  return result;
}
