import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import type { WebhookEvent } from '../contracts';
import { runtime } from './core';

type ScanResult = { examined: number; queued: number };
const none: ScanResult = { examined: 0, queued: 0 };

/**
 * Queue an event for every enabled endpoint of the workspace that listens for it. Never throws: a webhook must not break what it
 * reports on. `eventId` makes emitting idempotent per endpoint: the check and the insert run under one advisory lock, so two
 * concurrent emitters of the same event queue it once.
 */
export async function emitWebhook(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>, options: { eventId?: string; now?: Date; occurredAt?: Date } = {}): Promise<{ queued: number; dropped: boolean }> {
  try {
    const rt = await runtime(); if (!rt.enabled.webhooks) return { queued: 0, dropped: false };
    const now = options.now ?? new Date(); const eventId = options.eventId ?? randomUUID(); const occurredAt = options.occurredAt ?? now;
    const payload = JSON.stringify({ event, eventId, occurredAt: occurredAt.toISOString(), data });
    if (Buffer.byteLength(payload) > rt.limits.webhookMaxPayloadBytes) return { queued: 0, dropped: true };
    const queued = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integrations:event:${workspaceId}:${eventId}`}, 0))::text`;
      return Number(await tx.$executeRaw`INSERT INTO webhook_deliveries (id, "endpointId", "workspaceId", event, payload, status, attempts, "nextAttemptAt", "createdAt")
        SELECT 'whd_' || gen_random_uuid()::text, e.id, e."workspaceId", ${event}, ${payload}::jsonb, 'pending', 0, ${now}, ${now}
        FROM webhook_endpoints e JOIN workspaces w ON w.id = e."workspaceId"
        WHERE e."workspaceId" = ${workspaceId} AND e.enabled AND ${event} = ANY(e.events) AND w."suspendedAt" IS NULL AND e."createdAt" <= ${occurredAt}
          AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d."endpointId" = e.id AND d.payload ->> 'eventId' = ${eventId})`);
    }, { timeout: rt.limits.transactionTimeoutMs, maxWait: rt.limits.transactionMaxWaitMs });
    return { queued, dropped: false };
  } catch { return { queued: 0, dropped: false }; }
}

/**
 * Turn recent post results into `post.published` / `post.failed` events without touching Publishing code: each result has a stable
 * event id (destination + outcome [+ attempt count]), so scanning an overlapping window repeatedly queues each event once.
 * Only workspaces with an enabled endpoint that listens for these events are scanned.
 */
export async function emitRecentPostEvents(now = new Date()): Promise<{ examined: number; queued: number }> {
  const rt = await runtime(); if (!rt.enabled.webhooks) return { examined: 0, queued: 0 };
  const since = new Date(now.getTime() - rt.limits.webhookEventLookbackMinutes * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string; postId: string; targetId: string; targetName: string; workspaceId: string; status: string; attempts: number; remoteUrl: string | null; errorCode: string | null; publishedAt: Date | null; updatedAt: Date }>>`
    SELECT pt.id, pt."postId", pt."targetId", t.name AS "targetName", p."workspaceId", pt.status::text AS status, pt.attempts, pt."remoteUrl", pt."errorCode", pt."publishedAt", pt."updatedAt"
    FROM post_targets pt JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId"
    WHERE pt.status::text IN ('published', 'failed') AND pt."updatedAt" >= ${since} AND pt."updatedAt" <= ${now}
      AND EXISTS (SELECT 1 FROM webhook_endpoints e WHERE e."workspaceId" = p."workspaceId" AND e.enabled AND e.events && ARRAY['post.published', 'post.failed']::text[])
    ORDER BY pt."updatedAt" ASC LIMIT ${rt.limits.webhookEventScanLimit}`;
  let queued = 0;
  for (const row of rows) {
    const published = row.status === 'published';
    const occurredAt = (published ? row.publishedAt : null) ?? row.updatedAt;
    const result = await emitWebhook(row.workspaceId, published ? 'post.published' : 'post.failed', {
      postId: row.postId, destinationId: row.targetId, destinationName: row.targetName,
      ...(published ? { url: row.remoteUrl } : { errorCode: row.errorCode?.slice(0, 80) ?? null }),
    }, { eventId: `post_target:${row.id}:${published ? 'published' : `failed:${row.attempts}`}`, now, occurredAt });
    queued += result.queued;
  }
  return { examined: rows.length, queued };
}


/** Only workspaces with an enabled endpoint listening for one of these events are scanned. */
const listening = (events: readonly WebhookEvent[]) => events as string[];

/**
 * `post.scheduled`: a post that is now waiting for its publishing time. Source is the durable Publishing audit trail: scheduling
 * ("publishing.post_scheduled") and approval of a held post ("publishing.post_approved"). A post held for approval, rejected or
 * returned to draft by scan time is not reported, because it is not scheduled. One event per audit row (stable id), so repeats never
 * double-queue; a later reschedule is a different fact and is not reported.
 */
export async function emitRecentScheduledEvents(now = new Date()): Promise<ScanResult> {
  const rt = await runtime(); if (!rt.enabled.webhooks) return none;
  const since = new Date(now.getTime() - rt.limits.webhookEventLookbackMinutes * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; postId: string; scheduledAt: Date; createdAt: Date; destinationIds: string[] }>>`
    SELECT l.id, l."workspaceId", p.id AS "postId", p."scheduledAt", l."createdAt",
      COALESCE((SELECT array_agg(pt."targetId" ORDER BY pt."targetId") FROM post_targets pt WHERE pt."postId" = p.id), '{}') AS "destinationIds"
    FROM activity_logs l JOIN posts p ON p.id = l.detail ->> 'postId' AND p."workspaceId" = l."workspaceId"
    WHERE l.action IN ('publishing.post_scheduled', 'publishing.post_approved') AND l."createdAt" >= ${since} AND l."createdAt" <= ${now}
      AND p."scheduledAt" IS NOT NULL AND p.status::text IN ('scheduled', 'publishing', 'published', 'partially_failed', 'failed')
      AND EXISTS (SELECT 1 FROM webhook_endpoints e WHERE e."workspaceId" = l."workspaceId" AND e.enabled AND e.events && ${listening(['post.scheduled'])}::text[])
    ORDER BY l."createdAt" ASC LIMIT ${rt.limits.webhookEventScanLimit}`;
  let queued = 0;
  for (const row of rows) {
    queued += (await emitWebhook(row.workspaceId, 'post.scheduled', { postId: row.postId, scheduledAt: row.scheduledAt.toISOString(), destinationIds: row.destinationIds.slice(0, 50) }, { eventId: `post_scheduled:${row.id}`, now, occurredAt: row.createdAt })).queued;
  }
  return { examined: rows.length, queued };
}

/**
 * `comment.received`: a comment on one of the workspace's posts that the Inbox stored for the first time inside the window
 * (post_comments.firstSeenAt). Comments written by the connected channel itself or sent from this app are not "received". Reads the
 * stored rows only; it never contacts a platform and never touches Inbox code. The text is capped.
 */
export async function emitRecentCommentEvents(now = new Date()): Promise<ScanResult> {
  const rt = await runtime(); if (!rt.enabled.webhooks) return none;
  const since = new Date(now.getTime() - rt.limits.webhookEventLookbackMinutes * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; postId: string; targetId: string; targetName: string; fromName: string | null; message: string; createdTime: Date; firstSeenAt: Date }>>`
    SELECT c.id, p."workspaceId", pt."postId", t.id AS "targetId", t.name AS "targetName", c."fromName", c.message, c."createdTime", c."firstSeenAt"
    FROM post_comments c JOIN post_targets pt ON pt.id = c."postTargetId" JOIN posts p ON p.id = pt."postId" JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = p."workspaceId"
    WHERE c."firstSeenAt" >= ${since} AND c."firstSeenAt" <= ${now} AND c."sentById" IS NULL AND (c."fromId" IS NULL OR c."fromId" <> t."providerId")
      AND EXISTS (SELECT 1 FROM webhook_endpoints e WHERE e."workspaceId" = p."workspaceId" AND e.enabled AND e.events && ${listening(['comment.received'])}::text[])
    ORDER BY c."firstSeenAt" ASC LIMIT ${rt.limits.webhookEventScanLimit}`;
  let queued = 0;
  for (const row of rows) {
    queued += (await emitWebhook(row.workspaceId, 'comment.received', {
      commentId: row.id, postId: row.postId, destinationId: row.targetId, destinationName: row.targetName,
      authorName: row.fromName?.slice(0, 120) ?? null, text: row.message.slice(0, 500), createdAt: row.createdTime.toISOString(),
    }, { eventId: `comment:${row.id}`, now, occurredAt: row.firstSeenAt })).queued;
  }
  return { examined: rows.length, queued };
}

/**
 * `page.disconnected`: a connection whose credentials were marked invalid (social_accounts.invalidatedAt, set when a person
 * disconnects it or the platform rejects it). One event per affected channel; the event id carries the invalidation instant, so a
 * channel that is reconnected and disconnected again is reported again, and a repeated scan is not.
 */
export async function emitRecentDisconnectEvents(now = new Date()): Promise<ScanResult> {
  const rt = await runtime(); if (!rt.enabled.webhooks) return none;
  const since = new Date(now.getTime() - rt.limits.webhookEventLookbackMinutes * 60_000);
  const rows = await prisma.$queryRaw<Array<{ workspaceId: string; targetId: string; targetName: string; invalidatedAt: Date; reason: string | null }>>`
    SELECT a."workspaceId", t.id AS "targetId", t.name AS "targetName", a."invalidatedAt", a."invalidReason" AS reason
    FROM social_accounts a JOIN targets t ON t."socialAccountId" = a.id AND t."workspaceId" = a."workspaceId"
    WHERE a."invalidatedAt" >= ${since} AND a."invalidatedAt" <= ${now}
      AND EXISTS (SELECT 1 FROM webhook_endpoints e WHERE e."workspaceId" = a."workspaceId" AND e.enabled AND e.events && ${listening(['page.disconnected'])}::text[])
    ORDER BY a."invalidatedAt" ASC, t.id ASC LIMIT ${rt.limits.webhookEventScanLimit}`;
  let queued = 0;
  for (const row of rows) {
    queued += (await emitWebhook(row.workspaceId, 'page.disconnected', { destinationId: row.targetId, destinationName: row.targetName, reason: row.reason?.slice(0, 120) ?? null }, { eventId: `target:${row.targetId}:disconnected:${row.invalidatedAt.getTime()}`, now, occurredAt: row.invalidatedAt })).queued;
  }
  return { examined: rows.length, queued };
}

/**
 * `report.ready`: a report run that finished with its output produced or delivered (completed or partially delivered). Failed,
 * skipped and uncertain runs are not "ready". Metadata only: the report body and recipients are never put in the event.
 */
export async function emitRecentReportEvents(now = new Date()): Promise<ScanResult> {
  const rt = await runtime(); if (!rt.enabled.webhooks) return none;
  const since = new Date(now.getTime() - rt.limits.webhookEventLookbackMinutes * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; targetId: string; kind: string; periodStart: string; periodEnd: string; rowCount: number | null; status: string; finishedAt: Date }>>`
    SELECT r.id, r."workspaceId", r."targetId", r.kind, r."periodStart", r."periodEnd", r."rowCount", r.status, r."finishedAt"
    FROM report_runs r
    WHERE r.status IN ('completed', 'partial') AND r."finishedAt" >= ${since} AND r."finishedAt" <= ${now}
      AND EXISTS (SELECT 1 FROM webhook_endpoints e WHERE e."workspaceId" = r."workspaceId" AND e.enabled AND e.events && ${listening(['report.ready'])}::text[])
    ORDER BY r."finishedAt" ASC LIMIT ${rt.limits.webhookEventScanLimit}`;
  let queued = 0;
  for (const row of rows) {
    queued += (await emitWebhook(row.workspaceId, 'report.ready', { reportRunId: row.id, destinationId: row.targetId, kind: row.kind, periodStart: row.periodStart, periodEnd: row.periodEnd, rowCount: row.rowCount, status: row.status }, { eventId: `report_run:${row.id}`, now, occurredAt: row.finishedAt })).queued;
  }
  return { examined: rows.length, queued };
}

/** One worker pass over every event source. A failing source never stops the others. */
export async function emitRecentEvents(now = new Date()): Promise<ScanResult> {
  const total = { examined: 0, queued: 0 };
  for (const scan of [emitRecentPostEvents, emitRecentScheduledEvents, emitRecentCommentEvents, emitRecentDisconnectEvents, emitRecentReportEvents]) {
    try { const result = await scan(now); total.examined += result.examined; total.queued += result.queued; } catch { /* a source failure is retried on the next pass */ }
  }
  return total;
}
