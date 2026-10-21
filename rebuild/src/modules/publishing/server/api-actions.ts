
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { auditedReceipt, publishingActor } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';
import { REST_POST_CREATE_SCHEMA } from '@/modules/integrations/contracts';
import { parse } from '@/modules/integrations/server/core';
import { assertRestPostLimits } from '@/modules/integrations/server/rest';
import { SCHEDULE_MODES } from '../remote-scheduling';
import { createPostForApi } from './api';
import { cancelScheduledPost, reschedulePostToInstant, schedulePost } from './lifecycle';
import { queuePostRequest } from './queue';

/**
 * Key-authenticated (REST v1) entry points for compose, schedule, reschedule, cancel and queue. They call the same Publishing
 * services as the app and MCP; the key's feature/write grant and channel ceiling were enforced by the caller and are enforced again
 * by those services. Writes beyond creation ask for the same exact confirmation strings as the MCP tools of the same name.
 */
const MODE = z.enum(SCHEDULE_MODES);
const DESTINATION_MODES = z.record(z.string().min(1), MODE);
const CREATE = REST_POST_CREATE_SCHEMA.extend({ scheduleMode: MODE.optional(), destinationScheduleModes: DESTINATION_MODES.optional() }).strict();
const INSTANT = z.string().datetime({ offset: true });
const WHEN = z.object({ scheduledAt: INSTANT, confirmation: z.string() }).strict();
const SCHEDULE = WHEN.extend({ scheduleMode: MODE.optional(), destinationScheduleModes: DESTINATION_MODES.optional() }).strict();
const CONFIRM_ONLY = z.object({ confirmation: z.string() }).strict();

const confirmed = (actual: string, expected: string, errorText: PublishingErrorText = defaultPublishingErrorText) => {
  if (actual !== expected) throw new PublishingOperationError('invalid_request', 'confirmationRequiredRepeatTheCallWithConfirmationExactlyValue0', {value0: expected}, errorText);
};

/** Compose: a draft, or a scheduled post with an optional platform-held choice per post or per destination. */
export async function keyCreatePost(viewer: McpViewer, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(CREATE, input, 'Check the post details: message, targetIds, an optional future scheduledAt and optional scheduleMode.');
  if (!data.scheduledAt && (data.scheduleMode || data.destinationScheduleModes)) throw new PublishingOperationError('invalid_request', 'chooseAScheduledAtBeforeChoosingWhereTheScheduleIs', {}, errorText);
  await assertRestPostLimits(data);
  const result = await createPostForApi(publishingActor(viewer), {
    message: data.message, targetIds: data.targetIds, ...(data.firstComment === undefined ? {} : { firstComment: data.firstComment }),
    ...(data.firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes: data.firstCommentDelayMinutes }),
    ...(data.link === undefined ? {} : { link: data.link }), ...(data.media === undefined ? {} : { media: data.media }),
    ...(data.destinationFormats === undefined ? {} : { destinationFormats: data.destinationFormats }),
    ...(data.scheduledAt === undefined ? {} : { scheduledAt: new Date(data.scheduledAt) }),
    ...(data.scheduleMode ? { scheduleMode: data.scheduleMode } : {}), ...(data.destinationScheduleModes ? { destinationScheduleModes: data.destinationScheduleModes } : {}),
  });
  return auditedReceipt(viewer, 'rest.create_post', { postId: result.id, targetCount: data.targetIds.length, status: result.status, ...(result.scheduleMode ? { scheduleMode: result.scheduleMode } : {}) },
    { id: result.id, status: result.status, scheduledAt: result.scheduledAt, held: result.status === 'pending_approval', ...(result.scheduleMode ? { scheduleMode: result.scheduleMode, destinationScheduleModes: result.destinationScheduleModes, remoteHold: result.remoteHold } : {}) });
}

export const KEY_POST_ACTIONS = ['schedule', 'reschedule', 'cancel-schedule', 'queue'] as const;

export async function keyPostAction(viewer: McpViewer, postId: string, action: string, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const actor = publishingActor(viewer);
  switch (action) {
    case 'schedule': {
      const data = parse(SCHEDULE, input, 'Send scheduledAt, confirmation and optional scheduleMode.');
      confirmed(data.confirmation, `SCHEDULE POST ${postId} ${data.scheduledAt}`, errorText);
      const date = new Date(data.scheduledAt);
      const outcome = await schedulePost(actor, postId, date, { ...(data.scheduleMode ? { scheduleMode: data.scheduleMode } : {}), ...(data.destinationScheduleModes ? { destinationScheduleModes: data.destinationScheduleModes } : {}) });
      return auditedReceipt(viewer, 'rest.schedule_post', { postId, scheduledAt: date.toISOString(), scheduleMode: outcome.scheduleMode }, { postId, status: 'scheduled', scheduledAt: date.toISOString(), scheduleMode: outcome.scheduleMode, destinationScheduleModes: outcome.destinationScheduleModes, remoteHold: outcome.remoteHold });
    }
    case 'reschedule': {
      const data = parse(WHEN, input, 'Send scheduledAt and confirmation.');
      confirmed(data.confirmation, `RESCHEDULE POST ${postId} ${data.scheduledAt}`, errorText);
      const outcome = await reschedulePostToInstant(actor, postId, new Date(data.scheduledAt));
      return auditedReceipt(viewer, 'rest.reschedule_post', { postId, scheduledAt: outcome.scheduledAt.toISOString() }, { postId, status: 'scheduled', scheduledAt: outcome.scheduledAt.toISOString() });
    }
    case 'cancel-schedule': {
      const data = parse(CONFIRM_ONLY, input, 'Send the confirmation.');
      confirmed(data.confirmation, `CANCEL SCHEDULE ${postId}`, errorText);
      await cancelScheduledPost(actor, postId);
      return auditedReceipt(viewer, 'rest.cancel_scheduled_post', { postId }, { postId, status: 'draft' });
    }
    case 'queue': {
      const outcome = await queuePostRequest(actor, { ...(input && typeof input === 'object' && !Array.isArray(input) ? input : {}), postId });
      return auditedReceipt(viewer, 'rest.queue_post', { postId, scheduledAt: outcome.scheduledAt.toISOString(), status: outcome.status, scheduleMode: outcome.scheduleMode },
        { postId, scheduledAt: outcome.scheduledAt.toISOString(), status: outcome.status, scheduleMode: outcome.scheduleMode, destinationScheduleModes: outcome.destinationScheduleModes, remoteHold: outcome.remoteHold });
    }
    default:
      throw new PublishingOperationError('not_found', 'unknownPostAction', {}, errorText);
  }
}
