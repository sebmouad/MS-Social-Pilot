
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
import { suggestBestTimes, type BestTimeSlot } from './best-time-ranking';

const inputSchema = z.object({ targetIds: z.array(z.string().trim().min(1).max(200)).min(1) }).strict();
export type BestTimeSuggestion = BestTimeSlot & { nextAt: string; date: string; time: string };
export type BestTimeSuggestions = { mode: 'suggest' | 'apply'; timeZone: string; suggestions: BestTimeSuggestion[] };

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
  const result: BestTimeSuggestions = { mode: workspace.bestTimeMode as 'suggest' | 'apply', timeZone: workspace.timezone, suggestions: [] };
  // Only members with current Analytics Posts read access contribute stored performance.
  if (!canUseFeature(auth.entitlements, 'analytics/posts') || !canAccessFeature(auth.permissions, 'analytics/posts')) return result;
  const [lookbackDays, maxPosts, minHistory, minPostsPerSlot, minLift, maxSuggestions, horizonDays] = await Promise.all([
    runtimeConfig('publishing.bestTimeLookbackDays'), runtimeConfig('publishing.bestTimeMaxPosts'),
    runtimeConfig('publishing.bestTimeMinHistory'), runtimeConfig('publishing.bestTimeMinPostsPerSlot'),
    runtimeConfig('publishing.bestTimeMinLift'), runtimeConfig('publishing.bestTimeMaxSuggestions'), runtimeConfig('publishing.collab.queueLookaheadDays'),
  ]);
  const from = new Date(now.getTime() - Number(lookbackDays) * 86_400_000);
  const histories = [];
  for (const target of targets) {
    const provider = target.socialAccount?.provider;
    const host = provider ? await platformAnalytics(provider) : null;
    if (!host?.postPerformance) return result;
    const posts = await host.postPerformance({ workspaceId: actor.workspaceId, targetId: target.id, from, to: now, limit: Number(maxPosts), sort: 'publishedAt', direction: 'desc' });
    histories.push(posts.filter(post => post.publishedAt && post.publishedAt >= from && post.publishedAt < now && post.measuredAt && post.measuredAt <= now));
  }
  const slots = suggestBestTimes(histories, workspace.timezone, { minHistory: Number(minHistory), minPostsPerSlot: Number(minPostsPerSlot), minLift: Number(minLift), maxSuggestions: Number(maxSuggestions) });
  const today = instantToWall(now, workspace.timezone).date;
  for (const slot of slots) {
    const time = `${String(slot.hour).padStart(2, '0')}:00`;
    for (let offset = 0; offset <= Number(horizonDays); offset++) {
      const date = addDaysToKey(today, offset);
      if (weekdayOfKey(date) !== slot.dayOfWeek) continue;
      const at = wallTimeToInstant(date, time, workspace.timezone);
      if (!at.ok || at.instant <= now || at.instant.getTime() > now.getTime() + Number(horizonDays) * 86_400_000) continue;
      result.suggestions.push({ ...slot, nextAt: at.instant.toISOString(), date, time }); break;
    }
  }
  return result;
}
