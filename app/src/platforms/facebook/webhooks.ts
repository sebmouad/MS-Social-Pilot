import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { META_WEBHOOK_DELIVERIES_COPY_DEFAULTS, metaWebhookDeliveriesCopySchema, type MetaWebhookDeliveriesCopy } from './webhook-copy';

export { META_WEBHOOK_DELIVERIES_COPY_DEFAULTS, metaWebhookDeliveriesCopySchema, type MetaWebhookDeliveriesCopy };

/**
 * Meta inbound webhooks for Facebook Pages (feed posts, comments, messages).
 *
 * Meta signs every POST with `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of
 * the raw body keyed with the app secret>`, and verifies the endpoint once with
 * a GET handshake carrying the Root-chosen verify token. Both secrets fail
 * closed: without them every delivery is refused and nothing is stored.
 *
 * Ingestion is idempotent: each change/message hashes to a stable event id and
 * the delivery receipt is unique on it, while the store writes themselves use
 * the existing natural keys (external_posts, post_comments, conversation
 * messages), so a retried delivery converges instead of duplicating. No provider
 * request is ever made here: events resolve against stored targets, posts and
 * threads only. Anything unresolvable is recorded as unmatched, never guessed.
 */

const PROVIDER = 'facebook';
/** Raw JSON bodies beyond this are refused; real Meta deliveries are tiny. */
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ENTRIES = 50;
const MAX_CHANGES = 100;
const MAX_MESSAGING = 100;
/** One delivery fans out to at most this many workspaces holding the same Page. */
const MAX_MATCHED_TARGETS = 50;

export type MetaWebhookEventKind = 'feed_post' | 'feed_comment' | 'message' | 'unknown';
export type MetaWebhookDeliveryStatus = 'accepted' | 'duplicate' | 'unmatched' | 'ignored';

export type MetaWebhookEvent = {
  eventId: string;
  pageId: string;
  kind: MetaWebhookEventKind;
  verb: string | null;
  postId: string | null;
  commentId: string | null;
  parentId: string | null;
  messageId: string | null;
  senderId: string | null;
  text: string | null;
  fromName: string | null;
  fromId: string | null;
  link: string | null;
  createdAt: Date | null;
};

export type MetaWebhookIngestSummary = {
  received: number;
  accepted: number;
  duplicates: number;
  unmatched: number;
  ignored: number;
};

/** Pure: only an exact `sha256=<hex>` HMAC of the raw body passes. */
export function verifyMetaWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}

/** Pure: the handshake token Meta echoes must equal the Root secret exactly. */
export function verifyMetaWebhookToken(provided: string | null, expected: string): boolean {
  if (!expected || !provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

const pageIdSchema = z.string().regex(/^[0-9]{1,40}$/);
// Post/comment ids are `digits_digits`; message mids carry dots and `$` (e.g. `mid.$...`).
const remoteIdSchema = z.string().regex(/^[A-Za-z0-9_.:$-]{1,200}$/);
const unixSeconds = z.number().int().positive().max(4102444800);

function eventIdOf(parts: Record<string, unknown>): string {
  return `evt_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`;
}

function asDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 4102444800 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function textOrNull(value: unknown, max = 20000): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Pure: normalize one Meta `object=page` callback into ingestion events.
 * Unknown fields stay `unknown` (recorded, never stored); anything outside the
 * documented shape throws `invalid_request`.
 */
export function parseMetaWebhookPayload(payload: unknown): MetaWebhookEvent[] {
  const root = payload as { object?: unknown; entry?: unknown };
  if (!root || typeof root !== 'object' || root.object !== 'page' || !Array.isArray(root.entry)) {
    throw new OperationError('invalid_request', 'This Meta webhook payload is not a Page event batch.');
  }
  if (root.entry.length > MAX_ENTRIES) throw new OperationError('invalid_request', 'This Meta webhook batch is too large.');
  const events: MetaWebhookEvent[] = [];
  for (const rawEntry of root.entry) {
    const entry = (rawEntry ?? {}) as { id?: unknown; changes?: unknown; messaging?: unknown };
    const pageId = pageIdSchema.safeParse(entry.id);
    if (!pageId.success) throw new OperationError('invalid_request', 'A Meta webhook entry has no Page id.');
    const changes = entry.changes === undefined ? [] : entry.changes;
    const messaging = entry.messaging === undefined ? [] : entry.messaging;
    if (!Array.isArray(changes) || !Array.isArray(messaging)) throw new OperationError('invalid_request', 'A Meta webhook entry is malformed.');
    if (changes.length > MAX_CHANGES || messaging.length > MAX_MESSAGING) throw new OperationError('invalid_request', 'A Meta webhook entry is too large.');
    for (const rawChange of changes) events.push(parseChange(pageId.data, rawChange));
    for (const rawMessage of messaging) events.push(parseMessaging(pageId.data, rawMessage));
  }
  return events;
}

function parseChange(pageId: string, raw: unknown): MetaWebhookEvent {
  const change = (raw ?? {}) as { field?: unknown; value?: unknown };
  const value = (change.value ?? {}) as Record<string, unknown>;
  const blank = (kind: MetaWebhookEventKind): MetaWebhookEvent => ({
    eventId: eventIdOf({ pageId, change: raw }), pageId, kind,
    verb: typeof value.verb === 'string' ? value.verb.slice(0, 40) : null,
    postId: null, commentId: null, parentId: null, messageId: null, senderId: null,
    text: null, fromName: null, fromId: null, link: null, createdAt: null,
  });
  if (change.field !== 'feed') return blank('unknown');
  const item = value.item;
  const postId = typeof value.post_id === 'string' && remoteIdSchema.safeParse(value.post_id).success ? value.post_id : null;
  const commentId = typeof value.comment_id === 'string' && remoteIdSchema.safeParse(value.comment_id).success ? value.comment_id : null;
  const createdAt = asDate(value.created_time ?? value.updated_time);
  const from = (value.from ?? {}) as { id?: unknown; name?: unknown };
  const fromId = typeof from.id === 'string' ? from.id.slice(0, 200) : null;
  if (item === 'comment' && commentId && postId) {
    return {
      ...blank('feed_comment'), postId, commentId,
      parentId: typeof value.parent_id === 'string' && remoteIdSchema.safeParse(value.parent_id).success ? value.parent_id : null,
      text: textOrNull(value.message), fromName: textOrNull(from.name, 500), fromId, createdAt,
    };
  }
  if ((item === 'post' || item === 'status') && postId) {
    return {
      ...blank('feed_post'), postId, text: textOrNull(value.message),
      link: typeof value.link === 'string' ? value.link.slice(0, 2000) : null,
      fromName: textOrNull(from.name, 500), fromId, createdAt,
    };
  }
  return blank('unknown');
}

function parseMessaging(pageId: string, raw: unknown): MetaWebhookEvent {
  const item = (raw ?? {}) as { sender?: unknown; recipient?: unknown; timestamp?: unknown; message?: unknown };
  const sender = (item.sender ?? {}) as { id?: unknown };
  const message = (item.message ?? {}) as { mid?: unknown; text?: unknown };
  const senderId = typeof sender.id === 'string' ? sender.id.slice(0, 200) : null;
  const mid = typeof message.mid === 'string' && remoteIdSchema.safeParse(message.mid).success ? message.mid : null;
  const event: MetaWebhookEvent = {
    eventId: eventIdOf({ pageId, messaging: raw }), pageId, kind: 'unknown',
    verb: null, postId: null, commentId: null, parentId: null,
    messageId: mid, senderId, text: null, fromName: null, fromId: senderId, link: null,
    createdAt: asDate(item.timestamp),
  };
  if (!senderId || !mid || !event.createdAt) return event;
  // Text (or a text-bearing attachment message) from the visitor is ingestible;
  // echoes of Page-sent messages and non-message events wait for the next sync.
  if (senderId === pageId) return event;
  if (typeof message.text !== 'string' || !message.text) return event;
  return { ...event, kind: 'message', text: textOrNull(message.text) };
}

type MatchedTarget = { id: string; workspaceId: string };

async function eligibleTargets(pageId: string): Promise<MatchedTarget[]> {
  return prisma.$queryRaw<MatchedTarget[]>`
    SELECT t.id, t."workspaceId" FROM targets t
    JOIN social_accounts sa ON sa.id = t."socialAccountId"
      AND sa."workspaceId" = t."workspaceId" AND sa.provider = 'facebook' AND sa."invalidatedAt" IS NULL
    JOIN workspaces w ON w.id = t."workspaceId" AND w."suspendedAt" IS NULL
    WHERE t."providerId" = ${pageId} AND t.type = 'page' AND t.enabled = true
    ORDER BY t."workspaceId" ASC, t.id ASC LIMIT ${MAX_MATCHED_TARGETS + 1}`;
}

async function storeFeedPost(targetId: string, event: MetaWebhookEvent, now: Date): Promise<boolean> {
  if (!event.postId) return false;
  await prisma.$executeRaw`INSERT INTO external_posts (id, "targetId", "remoteId", message, permalink, "statusType", "pictureUrl", "createdTime", insights, "insightsSyncedAt", "fetchedAt")
    VALUES (${`fb_${randomUUID()}`}, ${targetId}, ${event.postId}, ${event.text}, NULL, NULL, NULL, ${event.createdAt ?? now}, NULL, NULL, ${now})
    ON CONFLICT ("targetId", "remoteId") DO UPDATE SET message = EXCLUDED.message, "fetchedAt" = EXCLUDED."fetchedAt"`;
  return true;
}

async function storeFeedComment(targetId: string, event: MetaWebhookEvent, now: Date): Promise<boolean> {
  if (!event.postId || !event.commentId) return false;
  const post = await prisma.postTarget.findFirst({ where: { targetId, remotePostId: event.postId }, select: { id: true } });
  if (!post) return false;
  await prisma.postComment.upsert({
    where: { postTargetId_remoteId: { postTargetId: post.id, remoteId: event.commentId } },
    create: {
      id: `comment_${randomUUID()}`, postTargetId: post.id, remoteId: event.commentId,
      parentRemoteId: event.parentId, message: event.text ?? '', fromName: event.fromName, fromId: event.fromId,
      createdTime: event.createdAt ?? now, fetchedAt: now,
    },
    update: { parentRemoteId: event.parentId, message: event.text ?? '', fromName: event.fromName, fromId: event.fromId, fetchedAt: now },
  });
  return true;
}

async function storeMessage(targetId: string, event: MetaWebhookEvent, now: Date): Promise<boolean> {
  if (!event.messageId || !event.senderId || !event.text || !event.createdAt) return false;
  // A webhook carries no conversation id, so the message joins the visitor's
  // existing thread only when exactly one thread on this channel holds them.
  // Anything else waits for the next sync rather than forking a duplicate.
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT c.id FROM conversations c
    JOIN conversation_messages m ON m."conversationId" = c.id
    WHERE c."targetId" = ${targetId} AND m."fromId" = ${event.senderId}
    ORDER BY c.id ASC LIMIT 2`;
  if (candidates.length !== 1) return false;
  const conversation = candidates[0]!;
  await prisma.conversationMessage.upsert({
    where: { conversationId_remoteId: { conversationId: conversation.id, remoteId: event.messageId } },
    create: {
      id: `msg_${randomUUID()}`, conversationId: conversation.id, remoteId: event.messageId,
      fromName: event.fromName, fromId: event.senderId, message: event.text, createdTime: event.createdAt,
    },
    update: { fromName: event.fromName, fromId: event.senderId, message: event.text, createdTime: event.createdAt },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { snippet: event.text.slice(0, 500), updatedTime: event.createdAt } });
  return true;
}

async function alreadyReceived(eventId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM meta_webhook_deliveries WHERE "eventId" = ${eventId} LIMIT 1`;
  return rows.length > 0;
}

async function recordDelivery(input: {
  event: MetaWebhookEvent; status: MetaWebhookDeliveryStatus; matchedTargets: number;
  detail: Record<string, unknown>; now: Date;
}): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO meta_webhook_deliveries (id, provider, "eventId", "pageId", "eventKind", status, "matchedTargets", detail, "receivedAt")
    VALUES (${`mwd_${randomUUID()}`}, ${PROVIDER}, ${input.event.eventId}, ${input.event.pageId}, ${input.event.kind}, ${input.status}, ${input.matchedTargets}, ${JSON.stringify(input.detail)}::jsonb, ${input.now})
    ON CONFLICT ("eventId") DO NOTHING RETURNING id`;
  return rows.length === 1;
}

/**
 * Verify, parse and ingest one raw Meta delivery. Every verified event ends in
 * exactly one content-free receipt row; retries converge on the same rows.
 */
export async function ingestMetaWebhookDelivery(rawBody: string, signature: string | null, now = new Date()): Promise<MetaWebhookIngestSummary> {
  const summary: MetaWebhookIngestSummary = { received: 0, accepted: 0, duplicates: 0, unmatched: 0, ignored: 0 };
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) throw new OperationError('invalid_request', 'This Meta webhook payload is too large.');
  const appSecret = await runtimeSecret('meta.appSecret').catch(() => null);
  if (!appSecret) throw new OperationError('unavailable', 'Meta webhook signing is not configured.');
  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) throw new OperationError('unauthorized', 'Invalid Meta webhook signature.');
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    throw new OperationError('invalid_request', 'This Meta webhook payload is not valid JSON.');
  }
  const events = parseMetaWebhookPayload(payload);
  summary.received = events.length;
  const enabled = await runtimeConfig('meta.webhooksEnabled').catch(() => true);
  for (const event of events) {
    if (event.kind === 'unknown' || enabled !== true) {
      summary.ignored++;
      await recordDelivery({ event, status: 'ignored', matchedTargets: 0, detail: enabled === true ? { reason: 'unknown_event' } : { reason: 'webhooks_disabled' }, now });
      continue;
    }
    if (await alreadyReceived(event.eventId)) {
      summary.duplicates++;
      continue;
    }
    const targets = await eligibleTargets(event.pageId);
    const matched = targets.slice(0, MAX_MATCHED_TARGETS);
    let written = 0;
    const errors: string[] = [];
    for (const target of matched) {
      try {
        const stored = event.kind === 'feed_post' ? await storeFeedPost(target.id, event, now)
          : event.kind === 'feed_comment' ? await storeFeedComment(target.id, event, now)
          : await storeMessage(target.id, event, now);
        if (stored) written++;
      } catch {
        if (errors.length < 5) errors.push('write_failed');
      }
    }
    const status: MetaWebhookDeliveryStatus = written > 0 ? 'accepted' : 'unmatched';
    summary[status === 'accepted' ? 'accepted' : 'unmatched']++;
    const recorded = await recordDelivery({
      event, status, matchedTargets: matched.length,
      detail: {
        ...(event.verb ? { verb: event.verb } : {}),
        written, ...(targets.length > matched.length ? { truncatedTargets: true } : {}),
        ...(errors.length ? { errors } : {}),
      },
      now,
    });
    // A concurrent retry recorded first: this attempt converged on its rows.
    if (!recorded) {
      summary[status === 'accepted' ? 'accepted' : 'unmatched']--;
      summary.duplicates++;
    }
  }
  return summary;
}

/** Meta's one-time GET handshake: echo the challenge only for the Root token. */
export async function verifyMetaWebhookSubscription(query: { mode: string | null; token: string | null; challenge: string | null }): Promise<{ ok: boolean; challenge?: string }> {
  if (query.mode !== 'subscribe' || !query.challenge || query.challenge.length > 500) return { ok: false };
  const expected = await runtimeSecret('meta.webhookVerifyToken').catch(() => null);
  if (!expected) return { ok: false };
  if (!verifyMetaWebhookToken(query.token, expected)) return { ok: false };
  return { ok: true, challenge: query.challenge };
}

/** Bounded retention sweep for the delivery log; called by the inbox worker job. */
export async function purgeExpiredWebhookDeliveries(now = new Date()): Promise<number> {
  const retentionDays = await runtimeConfig('meta.webhookDeliveryRetentionDays').catch(() => 30);
  const days = typeof retentionDays === 'number' && Number.isSafeInteger(retentionDays) ? Math.min(365, Math.max(1, retentionDays)) : 30;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM meta_webhook_deliveries WHERE "receivedAt" < ${cutoff} AND id IN (
      SELECT id FROM meta_webhook_deliveries WHERE "receivedAt" < ${cutoff} ORDER BY "receivedAt" ASC LIMIT 1000
    ) RETURNING id`;
  return rows.length;
}

export type MetaWebhookDeliveryRow = {
  id: string; receivedAt: Date; pageId: string; eventKind: MetaWebhookEventKind;
  status: MetaWebhookDeliveryStatus; matchedTargets: number;
  detail: { verb?: string; written?: number; reason?: string; errors?: string[] };
};

/** Recent delivery receipts for the private Root diagnostics panel. */
export async function readMetaWebhookDeliveries(limit: number): Promise<MetaWebhookDeliveryRow[]> {
  const take = Number.isSafeInteger(limit) ? Math.min(200, Math.max(1, limit)) : 50;
  const rows = await prisma.$queryRaw<Array<{
    id: string; receivedAt: Date; pageId: string; eventKind: string; status: string; matchedTargets: number; detail: unknown;
  }>>`SELECT id, "receivedAt", "pageId", "eventKind", status, "matchedTargets", detail
    FROM meta_webhook_deliveries WHERE provider = ${PROVIDER} ORDER BY "receivedAt" DESC, id DESC LIMIT ${take}`;
  const kinds: MetaWebhookEventKind[] = ['feed_post', 'feed_comment', 'message', 'unknown'];
  const statuses: MetaWebhookDeliveryStatus[] = ['accepted', 'duplicate', 'unmatched', 'ignored'];
  return rows.map(row => ({
    id: row.id, receivedAt: row.receivedAt, pageId: row.pageId,
    eventKind: (kinds.includes(row.eventKind as MetaWebhookEventKind) ? row.eventKind : 'unknown') as MetaWebhookEventKind,
    status: (statuses.includes(row.status as MetaWebhookDeliveryStatus) ? row.status : 'ignored') as MetaWebhookDeliveryStatus,
    matchedTargets: row.matchedTargets,
    detail: (row.detail && typeof row.detail === 'object' ? row.detail : {}) as MetaWebhookDeliveryRow['detail'],
  }));
}

export async function metaWebhookDeliveriesCopy(locale: 'en' | 'fr'): Promise<MetaWebhookDeliveriesCopy> {
  try {
    const catalog = metaWebhookDeliveriesCopySchema.parse(await runtimeConfig('meta.webhookDeliveriesCopy'));
    return catalog[locale];
  } catch {
    return META_WEBHOOK_DELIVERIES_COPY_DEFAULTS[locale];
  }
}
