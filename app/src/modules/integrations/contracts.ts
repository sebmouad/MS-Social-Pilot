import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { INTEGRATIONS_INPUT_HARD_MAX } from './config';

export type IntegrationsActor = { userId: string; workspaceId: string };

/** Event names are the stable receiver-facing protocol. They are shared product events, not provider names. */
export const WEBHOOK_EVENTS = ['post.scheduled', 'post.published', 'post.failed', 'comment.received', 'page.disconnected', 'report.ready'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** Events this installation actually emits. Every one is derived from durable state by the worker (see server/events.ts). */
export const EMITTED_EVENTS: readonly WebhookEvent[] = [...WEBHOOK_EVENTS];

/** Parser safety ceiling. The live Root policy is checked by the owning service and stays below this bound. */
const id = z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX).regex(/^[A-Za-z0-9_-]+$/);
const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);

export const WEBHOOK_CREATE_SCHEMA = z.object({
  name: z.string().trim().min(1).max(INTEGRATIONS_INPUT_HARD_MAX),
  url: z.string().trim().min(1).max(INTEGRATIONS_INPUT_HARD_MAX),
  events,
  confirmation: z.string(),
}).strict();
export const WEBHOOK_UPDATE_SCHEMA = z.object({
  id, enabled: z.boolean().optional(), events: events.optional(), confirmation: z.string(),
}).strict().refine(v => v.enabled !== undefined || v.events !== undefined);
export const ID_CONFIRM_SCHEMA = z.object({ id, confirmation: z.string() }).strict();
export const DELIVERY_QUERY_SCHEMA = z.object({ id, page: z.number().int().min(1).max(INTEGRATIONS_INPUT_HARD_MAX).optional() }).strict();
/** REST-hook subscription made with an API key (the key's owner and ceilings still apply). */
export const REST_HOOK_SCHEMA = z.object({
  name: z.string().trim().min(1).max(INTEGRATIONS_INPUT_HARD_MAX).optional(), url: z.string().trim().min(1).max(INTEGRATIONS_INPUT_HARD_MAX), events,
}).strict();
/** Body of POST /api/v1/posts. Strict and bounded; Publishing applies its own Root limits on top. */
export const REST_POST_CREATE_SCHEMA = z.object({
  message: z.string().max(INTEGRATIONS_INPUT_HARD_MAX),
  targetIds: z.array(z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX)).min(1).max(INTEGRATIONS_INPUT_HARD_MAX),
  firstComment: z.string().max(INTEGRATIONS_INPUT_HARD_MAX).optional(),
  firstCommentDelayMinutes: z.number().int().min(0).max(INTEGRATIONS_INPUT_HARD_MAX).optional(),
  link: z.string().max(INTEGRATIONS_INPUT_HARD_MAX).optional(),
  media: z.array(z.object({ kind: z.enum(['image', 'video']), url: z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX), altText: z.string().max(INTEGRATIONS_INPUT_HARD_MAX).optional() }).strict()).max(INTEGRATIONS_INPUT_HARD_MAX).optional(),
  destinationFormats: z.record(z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX), z.string().min(1).max(INTEGRATIONS_INPUT_HARD_MAX)).refine(v => Object.keys(v).length <= INTEGRATIONS_INPUT_HARD_MAX).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export const REST_HOOK_ID_SCHEMA = z.object({ id }).strict();

export const confirmations = {
  createWebhook: (name: string) => `CREATE WEBHOOK ${name}`,
  updateWebhook: (webhookId: string) => `UPDATE WEBHOOK ${webhookId}`,
  deleteWebhook: (webhookId: string) => `DELETE WEBHOOK ${webhookId}`,
  rotateWebhookSecret: (webhookId: string) => `ROTATE WEBHOOK SECRET ${webhookId}`,
  revealWebhookSecret: (webhookId: string) => `REVEAL WEBHOOK SECRET ${webhookId}`,
  testWebhook: (webhookId: string) => `TEST WEBHOOK ${webhookId}`,
  redeliver: (deliveryId: string) => `REDELIVER WEBHOOK DELIVERY ${deliveryId}`,
};

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** `sha256=<hex>` over `<timestamp>.<body>`: the value of `X-MSP-Signature`. */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
/** Constant-time check, for receivers and tests. */
export function verifyWebhookSignature(secret: string, timestamp: number, body: string, header: string) {
  const expected = Buffer.from(signWebhook(secret, timestamp, body)); const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
