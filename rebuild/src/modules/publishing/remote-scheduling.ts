import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { OperationError } from '@/lib/operation-error';
import type { PublishingFormatDescriptor } from '@/platforms/types';

/**
 * Where a scheduled post waits: `application` (our worker publishes at the time) or `remote` (the destination's own platform
 * holds it, so it still goes out if this app is offline). The choice is offered only for destinations whose module declares
 * provider-held scheduling; shared code never names a provider.
 */
export const SCHEDULE_MODES = ['application', 'remote'] as const;
export type ScheduleMode = typeof SCHEDULE_MODES[number];

export const REMOTE_SCHEDULING_CONFIG = [
  entry({ key: 'publishing.remoteScheduling.offered', group: 'Publishing · Scheduling', label: 'Offer platform-held scheduling', kind: 'boolean', description: 'Show the choice between app scheduling and platform-held scheduling when a selected destination supports it. Turning this off keeps existing platform-held posts but stops new ones.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'publishing.remoteScheduling.defaultMode', group: 'Publishing · Scheduling', label: 'Default scheduling place', kind: 'text', description: 'Where new scheduled posts wait when the author does not choose: "application" or "remote". Destinations that cannot hold a post at the platform always use the application.', defaultValue: 'application', schema: z.enum(SCHEDULE_MODES), consumption: 'active' }),
  entry({ key: 'publishing.remoteScheduling.leadMarginSeconds', group: 'Publishing · Scheduling', label: 'Platform-held lead margin (seconds)', kind: 'number', description: 'Extra seconds added to a platform\'s minimum lead time before handing a post over, so a request that clears the floor here is not refused on arrival. Posts inside the margin stay with the application.', defaultValue: 60, schema: z.number().int().min(0).max(3600), consumption: 'active' }),
  entry({ key: 'publishing.remoteScheduling.handOffBatch', group: 'Publishing · Scheduling', label: 'Platform hand-off batch size', kind: 'number', description: 'Most automatically scheduled posts (content mix, recycle) handed to their platforms per run.', defaultValue: 25, schema: z.number().int().min(1).max(500), consumption: 'active' }),
] as const;

export function parseScheduleMode(value: unknown): ScheduleMode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'application' || value === 'remote') return value;
  throw new OperationError('invalid_request', 'Choose whether the application or the platform holds the schedule.');
}

export type RemoteHoldDecision = { hold: true } | { hold: false; reason: 'unsupported' | 'too_soon' | 'too_far' | 'invalid' };

/** Decide, from the module's own declaration only, whether a destination can hold a post for `scheduledAt`. */
export function remoteHoldDecision(format: Pick<PublishingFormatDescriptor, 'scheduling'> | undefined, scheduledAt: Date, now: Date, marginSeconds: number): RemoteHoldDecision {
  const lead = format?.scheduling.native ? format.scheduling.nativeLeadSeconds : undefined;
  if (!lead) return { hold: false, reason: 'unsupported' };
  const delta = Math.floor((scheduledAt.getTime() - now.getTime()) / 1000);
  if (!Number.isFinite(delta)) return { hold: false, reason: 'invalid' };
  if (delta < lead.min + marginSeconds) return { hold: false, reason: 'too_soon' };
  if (delta > lead.max) return { hold: false, reason: 'too_far' };
  return { hold: true };
}

export type RemoteFallbackReason = Exclude<RemoteHoldDecision, { hold: true }>['reason'];

/** Customer wording for a destination left with the application. */
export function remoteFallbackMessage(reason: RemoteFallbackReason): string {
  if (reason === 'too_soon') return 'This time is too close for the platform to hold the post, so the application will publish it.';
  if (reason === 'too_far') return 'This time is too far ahead for the platform to hold the post, so the application will publish it.';
  if (reason === 'unsupported') return 'This destination cannot hold a scheduled post, so the application will publish it.';
  return 'The publishing time could not be checked, so the application will publish it.';
}
