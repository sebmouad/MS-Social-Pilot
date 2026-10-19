import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { hit } from '@/server/rate-limit';
import { decryptSecret, encryptSecret } from '@/server/secret-crypto';
import { DELIVERY_QUERY_SCHEMA, ID_CONFIRM_SCHEMA, WEBHOOK_CREATE_SCHEMA, WEBHOOK_EVENTS, WEBHOOK_UPDATE_SCHEMA, confirmations, newWebhookSecret, type IntegrationsActor, type WebhookEvent } from '../contracts';
import { audit, authorize, exact, notFound, pageOffset, parse, protect, requireEnabled, runtime, transact, type Tx } from './core';
import { checkReceiver, defaultWebhookDeps, sendSigned, type WebhookDeps } from './webhook-transport';

export type WebhookView = { id: string; name: string; urlDisplay: string; events: WebhookEvent[]; enabled: boolean; source: 'dashboard' | 'api_key'; lastError: string | null; lastSentAt: Date | null; createdAt: Date; pending: number; failed: number };
export type DeliveryView = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: Date; deliveredAt: Date | null; createdAt: Date };

/** The query string often carries a receiver token; lists never show it. */
export function displayUrl(raw: string) { try { const u = new URL(raw); return `${u.host}${u.pathname === '/' ? '' : u.pathname}`; } catch { return 'Invalid address'; } }
const toEvents = (value: string[]) => value.filter((event): event is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(event));

export async function listWebhooks(actor: IntegrationsActor) {
  await authorize(actor, false);
  const rt = await runtime();
  return protect((async () => {
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; apiTokenId: string | null; lastError: string | null; lastSentAt: Date | null; createdAt: Date; pending: bigint; failed: bigint }>>`SELECT e.id, e.name, e.url, e.events, e.enabled, e."apiTokenId", e."lastError", e."lastSentAt", e."createdAt",
      (SELECT COUNT(*) FROM webhook_deliveries d WHERE d."endpointId" = e.id AND d.status = 'pending') AS pending,
      (SELECT COUNT(*) FROM webhook_deliveries d WHERE d."endpointId" = e.id AND d.status = 'failed') AS failed
      FROM webhook_endpoints e WHERE e."workspaceId" = ${actor.workspaceId} ORDER BY e."createdAt" DESC, e.id DESC`;
    const webhooks: WebhookView[] = rows.map(row => ({ id: row.id, name: row.name, urlDisplay: displayUrl(row.url), events: toEvents(row.events), enabled: row.enabled, source: row.apiTokenId ? 'api_key' : 'dashboard', lastError: row.lastError, lastSentAt: row.lastSentAt, createdAt: row.createdAt, pending: Number(row.pending), failed: Number(row.failed) }));
    return { available: rt.enabled.webhooks, webhooks, events: [...WEBHOOK_EVENTS], maxEndpoints: rt.limits.webhookMaxEndpoints };
  })());
}

/** Shared by the dashboard, MCP and REST hooks. `apiKeyId` marks an endpoint an API key subscribed (stored in `apiTokenId`). */
export async function createWebhook(actor: IntegrationsActor, input: unknown, options: { apiKeyId?: string | null; deps?: Pick<WebhookDeps, 'resolve'>; skipConfirmation?: boolean } = {}) {
  const data = parse(WEBHOOK_CREATE_SCHEMA.extend({ confirmation: WEBHOOK_CREATE_SCHEMA.shape.confirmation.optional() }), input, 'Enter a name, a public https address and at least one event.');
  if (!options.skipConfirmation) exact(data.confirmation ?? '', confirmations.createWebhook(data.name));
  const rt = await runtime(); requireEnabled(rt, 'webhooks');
  await authorize(actor, true);
  const deps = options.deps ?? defaultWebhookDeps();
  await checkReceiver(data.url, rt.hostAllowlist, deps.resolve);
  const secret = newWebhookSecret(); const id = `wh_${randomUUID()}`;
  const events = [...new Set(data.events)];
  await protect(transact(actor, rt.limits, async tx => {
    await authorize(actor, true);
    const count = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM webhook_endpoints WHERE "workspaceId" = ${actor.workspaceId}`;
    if (Number(count[0]?.count ?? 0) >= rt.limits.webhookMaxEndpoints) throw new OperationError('conflict', 'This workspace has reached its webhook limit. Remove one first.');
    await tx.$executeRaw`INSERT INTO webhook_endpoints (id, "workspaceId", name, url, secret, events, enabled, "apiTokenId", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${data.name}, ${data.url}, ${encryptSecret(secret)}, ${events}::text[], true, ${options.apiKeyId ?? null}, NOW())`;
    await audit(tx, actor, 'webhook.created', { webhookId: id, events, viaApiKey: options.apiKeyId ?? null });
  }));
  return { id, name: data.name, events, secret, secretNotice: 'Copy the signing secret now. You can show it again later from the webhook list.' };
}

export async function updateWebhook(actor: IntegrationsActor, input: unknown) {
  const data = parse(WEBHOOK_UPDATE_SCHEMA, input); exact(data.confirmation, confirmations.updateWebhook(data.id));
  const rt = await runtime(); requireEnabled(rt, 'webhooks'); await authorize(actor, true);
  return protect(transact(actor, rt.limits, async tx => {
    await authorize(actor, true);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM webhook_endpoints WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    if (!rows[0]) throw notFound('webhook');
    const events = data.events ? [...new Set(data.events)] : null;
    await tx.$executeRaw`UPDATE webhook_endpoints SET enabled = COALESCE(${data.enabled ?? null}::boolean, enabled), events = COALESCE(${events}::text[], events), "lastError" = CASE WHEN ${data.enabled === true} THEN NULL ELSE "lastError" END WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor, 'webhook.updated', { webhookId: data.id, enabled: data.enabled ?? null, events });
    return { id: data.id, ...(data.enabled === undefined ? {} : { enabled: data.enabled }), ...(events ? { events } : {}) };
  }));
}

export async function deleteWebhook(actor: IntegrationsActor, input: unknown) {
  const data = parse(ID_CONFIRM_SCHEMA, input); exact(data.confirmation, confirmations.deleteWebhook(data.id));
  const rt = await runtime(); await authorize(actor, true);
  return protect(transact(actor, rt.limits, async tx => {
    await authorize(actor, true);
    const removed = await tx.$queryRaw<Array<{ id: string }>>`DELETE FROM webhook_endpoints WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} RETURNING id`;
    if (!removed[0]) throw notFound('webhook');
    await audit(tx, actor, 'webhook.deleted', { webhookId: data.id });
    return { id: data.id, deleted: true as const };
  }));
}

/** Old secret stops signing immediately; the new one is shown once (and can be revealed again by an owner/admin). */
export async function rotateWebhookSecret(actor: IntegrationsActor, input: unknown) {
  const data = parse(ID_CONFIRM_SCHEMA, input); exact(data.confirmation, confirmations.rotateWebhookSecret(data.id));
  const rt = await runtime(); requireEnabled(rt, 'webhooks'); await authorize(actor, true);
  const secret = newWebhookSecret();
  await protect(transact(actor, rt.limits, async tx => {
    await authorize(actor, true);
    const updated = await tx.$queryRaw<Array<{ id: string }>>`UPDATE webhook_endpoints SET secret = ${encryptSecret(secret)} WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} RETURNING id`;
    if (!updated[0]) throw notFound('webhook');
    await audit(tx, actor, 'webhook.secret_rotated', { webhookId: data.id });
  }));
  return { id: data.id, secret, secretNotice: 'Copy the new signing secret now. The previous secret no longer signs deliveries.' };
}

/**
 * Explicit reveal of a stored signing secret: write permission, exact confirmation, a per-person hourly bound and an audit record
 * that commits before the value leaves this function. Only the session UI/API calls this; there is no MCP or REST equivalent.
 */
export async function revealWebhookSecret(actor: IntegrationsActor, input: unknown, now = new Date()) {
  const data = parse(ID_CONFIRM_SCHEMA, input); exact(data.confirmation, confirmations.revealWebhookSecret(data.id));
  const rt = await runtime(); requireEnabled(rt, 'webhooks'); await authorize(actor, true);
  const limited = hit(`integrations:reveal:${actor.userId}`, { limit: rt.limits.webhookRevealsPerHour, windowMs: 3_600_000, now: now.getTime() });
  if (!limited.allowed) throw new OperationError('unavailable', 'Too many secrets shown recently. Try again later.');
  const envelope = await protect(transact(actor, rt.limits, async tx => {
    await authorize(actor, true);
    const rows = await tx.$queryRaw<Array<{ secret: string }>>`SELECT secret FROM webhook_endpoints WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    if (!rows[0]) throw notFound('webhook');
    await audit(tx, actor, 'webhook.secret_revealed', { webhookId: data.id });
    return rows[0].secret;
  }));
  let secret: string; try { secret = decryptSecret(envelope); } catch { throw new OperationError('unavailable', 'This webhook\'s signing secret is unavailable. Replace the secret to continue.'); }
  return { id: data.id, secret, secretNotice: 'Keep this secret private. Showing it was recorded in the activity history.' };
}

export async function listDeliveries(actor: IntegrationsActor, input: unknown) {
  const q = parse(DELIVERY_QUERY_SCHEMA, input);
  await authorize(actor, false);
  const rt = await runtime(); const size = rt.limits.webhookDeliveriesPageSize; const page = q.page ?? 1;
  return protect((async () => {
    const endpoint = await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM webhook_endpoints WHERE id = ${q.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (!endpoint[0]) throw notFound('webhook');
    const rows = await prisma.$queryRaw<DeliveryView[]>`SELECT id, event, status, attempts, "responseStatus", error, "nextAttemptAt", "deliveredAt", "createdAt" FROM webhook_deliveries WHERE "endpointId" = ${q.id} AND "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt" DESC, id DESC LIMIT ${size + 1} OFFSET ${pageOffset(page, size)}`;
    return { webhook: endpoint[0], deliveries: rows.slice(0, size), page, pageSize: size, hasMore: rows.length > size };
  })());
}

type Attempted = { deliveryId: string; delivered: boolean; status: number | null; error: string | null };
const reasonCap = (value: string | null) => value?.slice(0, 200) ?? null;

async function loadSecret(db: Tx | typeof prisma, endpointId: string, workspaceId: string) {
  const rows = await db.$queryRaw<Array<{ url: string; secret: string; enabled: boolean }>>`SELECT url, secret, enabled FROM webhook_endpoints WHERE id = ${endpointId} AND "workspaceId" = ${workspaceId}`;
  if (!rows[0]) throw notFound('webhook');
  let secret: string; try { secret = decryptSecret(rows[0].secret); } catch { throw new OperationError('unavailable', 'This webhook\'s signing secret is unavailable. Replace the secret to continue.'); }
  return { url: rows[0].url, secret, enabled: rows[0].enabled };
}
const bodyOf = (id: string, payload: unknown) => JSON.stringify({ id, ...((payload && typeof payload === 'object' ? payload : {}) as object) });

/** Record one attempt: only the claimant (status still pending) may settle it. `retryAfterSeconds` null means no further automatic attempts. */
export async function settleAttempt(db: Tx | typeof prisma, row: { id: string; endpointId: string; workspaceId: string; attempts: number }, outcome: { ok: boolean; status: number | null; error: string | null }, now: Date, retryAfterSeconds: number | null) {
  const attempts = row.attempts + 1; const status = outcome.ok ? 'delivered' : retryAfterSeconds === null ? 'failed' : 'pending';
  const next = new Date(now.getTime() + (retryAfterSeconds ?? 0) * 1000);
  const updated = await db.$executeRaw`UPDATE webhook_deliveries SET attempts = ${attempts}, "responseStatus" = ${outcome.status}, error = ${reasonCap(outcome.error)}, status = ${status}, "deliveredAt" = ${outcome.ok ? now : null}, "nextAttemptAt" = ${next} WHERE id = ${row.id} AND "workspaceId" = ${row.workspaceId} AND status = 'pending'`;
  if (Number(updated) > 0) {
    if (outcome.ok) await db.$executeRaw`UPDATE webhook_endpoints SET "lastSentAt" = ${now}, "lastError" = NULL WHERE id = ${row.endpointId}`;
    else await db.$executeRaw`UPDATE webhook_endpoints SET "lastError" = ${reasonCap(outcome.error)} WHERE id = ${row.endpointId}`;
  }
  return Number(updated) > 0;
}

/** A ping sent at once and not retried, so a wrong address shows now. */
export async function testWebhook(actor: IntegrationsActor, input: unknown, deps: WebhookDeps = defaultWebhookDeps(), now = new Date()): Promise<Attempted> {
  const data = parse(ID_CONFIRM_SCHEMA, input); exact(data.confirmation, confirmations.testWebhook(data.id));
  const rt = await runtime(); requireEnabled(rt, 'webhooks'); await authorize(actor, true);
  return protect((async () => {
    const endpoint = await loadSecret(prisma, data.id, actor.workspaceId);
    const deliveryId = `whd_${randomUUID()}`;
    const payload = { event: 'ping', occurredAt: now.toISOString(), data: {} };
    await prisma.$executeRaw`INSERT INTO webhook_deliveries (id, "endpointId", "workspaceId", event, payload, status, attempts, "nextAttemptAt", "createdAt") VALUES (${deliveryId}, ${data.id}, ${actor.workspaceId}, 'ping', ${JSON.stringify(payload)}::jsonb, 'pending', 0, ${new Date(now.getTime() + rt.limits.webhookLeaseSeconds * 1000)}, ${now})`;
    const outcome = await sendSigned({ url: endpoint.url, secret: endpoint.secret, deliveryId, event: 'ping', body: bodyOf(deliveryId, payload), now, timeoutMs: rt.limits.webhookSendTimeoutMs, allowlist: rt.hostAllowlist, deps });
    await settleAttempt(prisma, { id: deliveryId, endpointId: data.id, workspaceId: actor.workspaceId, attempts: 0 }, outcome, now, null);
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'webhook.tested', ${JSON.stringify({ webhookId: data.id, delivered: outcome.ok })}::jsonb, NOW())`;
    return { deliveryId, delivered: outcome.ok, status: outcome.status, error: outcome.error };
  })());
}

/** Send a past delivery again now. Same delivery id, so receivers can de-duplicate; only settled deliveries qualify, and the claim is atomic. */
export async function redeliverWebhook(actor: IntegrationsActor, input: unknown, deps: WebhookDeps = defaultWebhookDeps(), now = new Date()): Promise<Attempted> {
  const data = parse(ID_CONFIRM_SCHEMA, input); exact(data.confirmation, confirmations.redeliver(data.id));
  const rt = await runtime(); requireEnabled(rt, 'webhooks'); await authorize(actor, true);
  return protect((async () => {
    const claimed = await prisma.$queryRaw<Array<{ id: string; endpointId: string; workspaceId: string; event: string; payload: unknown; attempts: number }>>`UPDATE webhook_deliveries SET status = 'pending', "nextAttemptAt" = ${new Date(now.getTime() + rt.limits.webhookLeaseSeconds * 1000)} WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId} AND status IN ('delivered', 'failed') RETURNING id, "endpointId", "workspaceId", event, payload, attempts`;
    const row = claimed[0];
    if (!row) {
      const exists = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM webhook_deliveries WHERE id = ${data.id} AND "workspaceId" = ${actor.workspaceId}`;
      throw exists[0] ? new OperationError('conflict', 'This delivery is already being sent.') : notFound('delivery');
    }
    let endpoint; try { endpoint = await loadSecret(prisma, row.endpointId, actor.workspaceId); } catch (error) { await settleAttempt(prisma, row, { ok: false, status: null, error: 'Signing secret unavailable.' }, now, null); throw error; }
    const outcome = await sendSigned({ url: endpoint.url, secret: endpoint.secret, deliveryId: row.id, event: row.event, body: bodyOf(row.id, row.payload), now, timeoutMs: rt.limits.webhookSendTimeoutMs, allowlist: rt.hostAllowlist, deps });
    await settleAttempt(prisma, row, outcome, now, null);
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'webhook.redelivered', ${JSON.stringify({ deliveryId: row.id, webhookId: row.endpointId, delivered: outcome.ok })}::jsonb, NOW())`;
    return { deliveryId: row.id, delivered: outcome.ok, status: outcome.status, error: outcome.error };
  })());
}

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

/** Endpoints a key subscribed stop when that key is revoked or expires (the key's own record is owned by MCP access). */
export async function disableEndedKeyWebhooks(): Promise<number> {
  return Number(await prisma.$executeRaw`UPDATE webhook_endpoints e SET enabled = false, "lastError" = 'API key ended.' WHERE e."apiTokenId" IS NOT NULL AND e.enabled
    AND NOT EXISTS (SELECT 1 FROM mcp_api_keys k WHERE k.id = e."apiTokenId" AND k."revokedAt" IS NULL AND k."expiresAt" > NOW())`);
}

/** The worker's pass: queue post events, pause orphaned key hooks, claim due deliveries with SKIP LOCKED leases, send, back off per the Root schedule, then purge old settled rows. */
export async function deliverDueWebhooks(deps: WebhookDeps = defaultWebhookDeps(), now = new Date(), clock: () => Date = () => new Date()): Promise<{ delivered: number; retrying: number; failed: number; purged: number; events: number }> {
  const rt = await runtime(); const zero = { delivered: 0, retrying: 0, failed: 0, purged: 0, events: 0 };
  if (!rt.enabled.webhooks) return zero;
  await disableEndedKeyWebhooks();
  const scanned = await emitRecentPostEvents(now);
  const lease = new Date(now.getTime() + rt.limits.webhookLeaseSeconds * 1000);
  const claimed = await prisma.$queryRaw<Array<{ id: string; endpointId: string; workspaceId: string; event: string; payload: unknown; attempts: number }>>`UPDATE webhook_deliveries d SET "nextAttemptAt" = ${lease}
    WHERE d.id IN (SELECT d2.id FROM webhook_deliveries d2 JOIN webhook_endpoints e ON e.id = d2."endpointId" JOIN workspaces w ON w.id = d2."workspaceId"
      WHERE d2.status = 'pending' AND d2."nextAttemptAt" <= ${now} AND e.enabled AND w."suspendedAt" IS NULL ORDER BY d2."nextAttemptAt" ASC LIMIT ${rt.limits.webhookBatchSize} FOR UPDATE OF d2 SKIP LOCKED)
    RETURNING d.id, d."endpointId", d."workspaceId", d.event, d.payload, d.attempts`;
  const result = { ...zero, events: scanned.queued };
  const endpoints = new Map<string, Awaited<ReturnType<typeof loadSecret>> | null>();
  for (const row of claimed) {
    const key = `${row.workspaceId}:${row.endpointId}`;
    if (!endpoints.has(key)) endpoints.set(key, await loadSecret(prisma, row.endpointId, row.workspaceId).catch(() => null));
    const endpoint = endpoints.get(key);
    // The signature timestamp is taken at send time so a long batch never signs stale timestamps.
    const sentAt = clock();
    const outcome = endpoint ? await sendSigned({ url: endpoint.url, secret: endpoint.secret, deliveryId: row.id, event: row.event, body: bodyOf(row.id, row.payload), now: sentAt, timeoutMs: rt.limits.webhookSendTimeoutMs, allowlist: rt.hostAllowlist, deps }) : { ok: false, status: null, error: 'Signing secret unavailable.', retryable: false };
    const wait = !outcome.ok && outcome.retryable ? rt.retryDelaysSeconds[row.attempts] ?? null : null;
    await settleAttempt(prisma, row, outcome, sentAt, wait);
    if (outcome.ok) result.delivered += 1; else if (wait !== null) result.retrying += 1; else result.failed += 1;
  }
  const cutoff = new Date(now.getTime() - rt.limits.webhookRetentionDays * 86_400_000);
  result.purged = Number(await prisma.$executeRaw`DELETE FROM webhook_deliveries WHERE id IN (SELECT id FROM webhook_deliveries WHERE status <> 'pending' AND "createdAt" < ${cutoff} ORDER BY "createdAt" ASC LIMIT 1000)`);
  return result;
}
