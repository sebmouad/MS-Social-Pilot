import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { decryptSecret, encryptSecret } from './crypto';
import { AppError } from './errors';
import { prisma } from './prisma';
import { assertPublicUrl, assertResolvesPublicly, UnsafeUrlError } from './safe-fetch';

/**
 * Outgoing webhooks (NEXT_PHASES H18): what happens in a workspace, POSTed as
 * JSON to an address its admins chose — Zapier, n8n, Make or their own server.
 *
 * An event never waits on the receiver: `emitWebhook` only writes one delivery
 * row per endpoint, and the worker sends them, signed, retrying with backoff.
 * The receiver checks `X-MSP-Signature` (HMAC-SHA256 of `<timestamp>.<body>`
 * with the endpoint's secret) and may refuse a timestamp that is too old.
 *
 * Addresses are typed by users, so every send goes through the same private-
 * network checks as link previews, and redirects are not followed.
 */

export const WEBHOOK_EVENTS = [
  'post.scheduled',
  'post.published',
  'post.failed',
  'comment.received',
  'page.disconnected',
  'report.ready',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Waits before attempts 2…6; after the sixth failure the delivery gives up. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const SEND_TIMEOUT_MS = 10_000;
/** A delivery being sent is pushed this far ahead, so a second worker leaves it alone. */
const LEASE_MS = 2 * 60_000;
const KEEP_DAYS = 30;
const BATCH = 50;

export const webhookSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => {
      try {
        return assertPublicUrl(value).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Use a public https:// address.'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
export type WebhookInput = z.infer<typeof webhookSchema>;

export const webhookUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
});

export function webhookNotFound(): AppError {
  return new AppError({ key: 'errors.webhookNotFound', fallback: 'That webhook does not exist.', status: 404 });
}

/** Make an endpoint. The secret is returned here once and stored encrypted. */
export async function createWebhook(
  workspaceId: string,
  input: WebhookInput,
  apiTokenId: string | null = null,
): Promise<{ id: string; secret: string }> {
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const row = await prisma.webhookEndpoint.create({
    data: { workspaceId, name: input.name, url: input.url, events: input.events, secret: encryptSecret(secret), apiTokenId },
    select: { id: true },
  });
  return { id: row.id, secret };
}

/** `sha256=<hex>` over `<timestamp>.<body>`, the value of `X-MSP-Signature`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Queue `event` for every endpoint in the workspace that listens for it.
 * Never throws: a webhook must not break what it reports on.
 */
export async function emitWebhook(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>, now = new Date()): Promise<number> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { workspaceId, enabled: true, events: { has: event } },
      select: { id: true },
    });
    if (endpoints.length === 0) return 0;
    const payload = { event, occurredAt: now.toISOString(), data } as Prisma.InputJsonValue;
    const { count } = await prisma.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({ endpointId: endpoint.id, workspaceId, event, payload, nextAttemptAt: now })),
    });
    return count;
  } catch (error) {
    console.error('[webhooks] could not queue', event, error);
    return 0;
  }
}

/** The body as sent: the delivery id (stable across retries, for de-duplication) first. */
function bodyOf(delivery: { id: string; payload: Prisma.JsonValue }): string {
  const payload = (delivery.payload ?? {}) as Record<string, unknown>;
  return JSON.stringify({ id: delivery.id, ...payload });
}

/** One POST. Resolves with the status code; throws with a reason a person can read. */
async function post(url: string, secret: string, delivery: { id: string; event: string; payload: Prisma.JsonValue }, now: Date): Promise<number> {
  const target = assertPublicUrl(url);
  await assertResolvesPublicly(target.hostname);
  const body = bodyOf(delivery);
  const timestamp = Math.floor(now.getTime() / 1000);
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'MS-Social-Pilot-Webhooks/1',
      'x-msp-event': delivery.event,
      'x-msp-delivery': delivery.id,
      'x-msp-timestamp': String(timestamp),
      'x-msp-signature': signWebhook(secret, timestamp, body),
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}

function reasonOf(error: unknown): string {
  if (error instanceof UnsafeUrlError) return error.message;
  if (error instanceof Error && error.name === 'TimeoutError') return `No answer within ${SEND_TIMEOUT_MS / 1000} seconds.`;
  if (error instanceof Error) return (error.cause instanceof Error ? error.cause.message : error.message).slice(0, 300);
  return 'Could not send.';
}

interface Attempted {
  delivered: boolean;
  status: number | null;
  error: string | null;
}

/** Send one delivery now and record the result; schedules the retry when there is one. */
async function attempt(deliveryId: string, now: Date, retry: boolean): Promise<Attempted> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: { select: { id: true, url: true, secret: true } } },
  });
  if (!delivery) return { delivered: false, status: null, error: 'Not found.' };

  let status: number | null = null;
  let error: string | null = null;
  try {
    status = await post(delivery.endpoint.url, decryptSecret(delivery.endpoint.secret), delivery, now);
    if (status < 200 || status >= 300) error = status >= 300 && status < 400 ? `Answered ${status} (redirects are not followed).` : `Answered ${status}.`;
  } catch (caught) {
    error = reasonOf(caught);
  }

  const attempts = delivery.attempts + 1;
  const delivered = error === null;
  const delay = retry ? RETRY_DELAYS_MS[attempts - 1] : undefined;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      responseStatus: status,
      error,
      status: delivered ? 'delivered' : delay === undefined ? 'failed' : 'pending',
      deliveredAt: delivered ? now : null,
      nextAttemptAt: delivered || delay === undefined ? now : new Date(now.getTime() + delay),
    },
  });
  await prisma.webhookEndpoint.update({
    where: { id: delivery.endpoint.id },
    data: delivered ? { lastSentAt: now, lastError: null } : { lastError: error },
  });
  return { delivered, status, error };
}

/** The worker's job: send what is due, then forget deliveries older than a month. */
export async function deliverDueWebhooks(now = new Date()): Promise<{ delivered: number; failed: number }> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: now }, endpoint: { enabled: true } },
    orderBy: { nextAttemptAt: 'asc' },
    take: BATCH,
    select: { id: true, nextAttemptAt: true },
  });
  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    // Claim it: only the worker whose update matched sends it.
    const { count } = await prisma.webhookDelivery.updateMany({
      where: { id: row.id, status: 'pending', nextAttemptAt: row.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (count === 0) continue;
    const result = await attempt(row.id, now, true);
    if (result.delivered) delivered += 1;
    else failed += 1;
  }
  await prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } });
  return { delivered, failed };
}

/** A `ping`, sent at once and not retried, so a wrong address shows now. */
export async function testWebhook(id: string, workspaceId: string, now = new Date()): Promise<Attempted> {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!endpoint) throw webhookNotFound();
  const delivery = await prisma.webhookDelivery.create({
    data: {
      endpointId: id,
      workspaceId,
      event: 'ping',
      payload: { event: 'ping', occurredAt: now.toISOString(), data: {} },
      nextAttemptAt: now,
    },
    select: { id: true },
  });
  return attempt(delivery.id, now, false);
}

/** Send a past delivery again now (its id stays, so the receiver can tell). */
export async function redeliverWebhook(deliveryId: string, workspaceId: string, now = new Date()): Promise<Attempted> {
  const delivery = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, workspaceId }, select: { id: true } });
  if (!delivery) throw webhookNotFound();
  return attempt(delivery.id, now, false);
}
