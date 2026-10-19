import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { clientIp } from '@/server/client-ip';
import { hit, forgive } from '@/server/rate-limit';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';
import { authenticateBearerHeader } from '@/server/mcp/bearer';
import { auditedReceipt, pageIdsFor, publishingActor } from '@/server/mcp/kit';
import { createPostForApi, listPostsWithFirstComment } from '@/modules/publishing/server/api';
import type { McpViewer } from '@/server/mcp/types';
import { REST_HOOK_ID_SCHEMA, REST_HOOK_SCHEMA, REST_POST_CREATE_SCHEMA, WEBHOOK_EVENTS, type IntegrationsActor } from '../contracts';
import { audit, authorize, notFound, parse, protect, requireEnabled, runtime, transact } from './core';
import { createWebhook, displayUrl, type WebhookView } from './webhooks';
import type { WebhookDeps } from './webhook-transport';
import { WEBHOOKS_FEATURE_ID } from '../manifest';

export class RateLimited extends OperationError {
  constructor(readonly retryAfterSeconds: number) { super('unavailable', 'Too many requests. Try again shortly.'); this.name = 'RateLimited'; }
}
/** A key resolved to the person and workspace it acts as. `viewer.permissions` is the owner's CURRENT access narrowed to the key's grants. */
export type ApiKeyContext = { keyId: string; viewer: McpViewer; actor: IntegrationsActor };

const invalid = () => new OperationError('unauthorized', 'Send a valid API key as "Authorization: Bearer mcp_...".');
const retryAfter = (resetAt: number, now: number) => Math.max(1, Math.ceil((resetAt - now) / 1000));

/**
 * Authenticate a REST request with a scoped workspace API key (the same `mcp_` keys Settings issues; this module issues none).
 * Cookies are never read. The shared bearer check re-reads the owner, role, plan, channel grants and the key's feature and resource
 * ceilings on every request, so a key can only narrow what its owner can do now, never widen it, never reach Root (installation
 * scope is not available here) and never cross workspaces. Invalid, revoked and expired keys are indistinguishable.
 * Every request first counts against the caller address; a success gives that count back, so only rejected credentials are throttled.
 */
export async function authenticateApiKey(request: Request, need?: { feature: string; write?: boolean }, now = new Date()): Promise<ApiKeyContext> {
  const rt = await runtime(); requireEnabled(rt, 'api');
  const ip = clientIp(request) ?? 'unknown';
  const failKey = `v1:bad:${ip}`;
  const bad = hit(failKey, { limit: rt.limits.apiFailedAuthPerMinute, windowMs: 60_000, now: now.getTime() });
  if (!bad.allowed) throw new RateLimited(retryAfter(bad.resetAt, now.getTime()));
  const viewer = await authenticateBearerHeader(request.headers.get('authorization'));
  if (!viewer || viewer.scope !== 'workspace' || !viewer.apiKeyId) throw invalid();
  forgive(failKey);
  const keyId = viewer.apiKeyId;
  const rate = hit(`v1:key:${keyId}`, { limit: rt.limits.apiRatePerMinute, windowMs: 60_000, now: now.getTime() });
  if (!rate.allowed) throw new RateLimited(retryAfter(rate.resetAt, now.getTime()));
  await assertWorkspaceNotPurging(viewer.workspaceId);
  if (need) {
    const allowed = Boolean(viewer.permissions) && canUseFeature(viewer.entitlements, need.feature as never) && canAccessFeature(viewer.permissions!, need.feature as never, need.write ? 'write' : 'read');
    if (!allowed) throw new OperationError('forbidden', need.write ? 'This API key cannot make that change.' : 'This API key cannot read that.');
  }
  return { keyId, viewer, actor: { userId: viewer.userId, workspaceId: viewer.workspaceId } };
}

/** Who the key is and what it may reach. Needs no feature grant: it only describes the key's own ceilings. */
export async function restMe(ctx: ApiKeyContext) {
  const { viewer } = ctx; const permissions = viewer.permissions;
  const granted = (access: 'read' | 'write') => Object.entries(permissions?.features ?? {}).filter(([, value]) => value[access]).map(([feature]) => feature).sort();
  return {
    workspace: { id: viewer.workspaceId, name: viewer.workspace.name, timezone: viewer.workspace.timezone }, role: viewer.role,
    access: { read: granted('read'), write: granted('write') },
    channels: permissions?.pageScope.all === false ? [...permissions.pageScope.ids] : 'all',
    events: [...WEBHOOK_EVENTS],
  };
}

/** The channels this key may use: selected, connected and entitled, inside the key's resource ceiling. Gated by the Connections read grant. */
export async function restPages(ctx: ApiKeyContext) {
  const { viewer } = ctx; const scope = viewer.permissions!.pageScope;
  if (!scope.all && !scope.ids.length) return { pages: [] };
  const connection = await selectedResourceConnectionWhere(viewer.workspaceId, entitledPlatformIds(viewer.entitlements));
  const rows = await prisma.target.findMany({
    where: { workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: connection }, ...(scope.all ? {} : { id: { in: [...scope.ids] } }) },
    select: { id: true, name: true, type: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: Math.max(1, viewer.maxResultItems ?? 100),
  });
  return { pages: rows.map(row => ({ id: row.id, name: row.name, type: row.type })) };
}

/** Subscriptions are workspace-wide events: a key restricted to selected channels may not create, list or remove them. */
function requireWorkspaceWide(ctx: ApiKeyContext) {
  if (ctx.viewer.resourceRestricted) throw new OperationError('forbidden', 'This API key is limited to selected channels and cannot manage webhooks.');
}

export async function restListHooks(ctx: ApiKeyContext) {
  requireWorkspaceWide(ctx);
  await authorize(ctx.actor, false);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; lastError: string | null; lastSentAt: Date | null; createdAt: Date }>>`SELECT id, name, url, events, enabled, "lastError", "lastSentAt", "createdAt" FROM webhook_endpoints WHERE "workspaceId" = ${ctx.actor.workspaceId} AND "apiTokenId" = ${ctx.keyId} ORDER BY "createdAt" DESC, id DESC`;
  return { hooks: rows.map(row => ({ id: row.id, name: row.name, url: displayUrl(row.url), events: row.events as WebhookView['events'], enabled: row.enabled, lastError: row.lastError, lastSentAt: row.lastSentAt, createdAt: row.createdAt })) };
}

/** The key's owner must still be an owner/admin holding the webhook grant (the service re-checks it); the secret is returned once, here only. */
export async function restSubscribe(ctx: ApiKeyContext, input: unknown, deps?: Pick<WebhookDeps, 'resolve'>) {
  requireWorkspaceWide(ctx);
  const data = parse(REST_HOOK_SCHEMA, input, 'Send a public https url and at least one event.');
  return createWebhook(ctx.actor, { name: data.name ?? 'REST hook', url: data.url, events: data.events }, { apiKeyId: ctx.keyId, skipConfirmation: true, ...(deps ? { deps } : {}) });
}

/** A key may remove only the subscriptions it made itself. */
export async function restUnsubscribe(ctx: ApiKeyContext, input: unknown) {
  requireWorkspaceWide(ctx);
  const data = parse(REST_HOOK_ID_SCHEMA, input);
  const rt = await runtime(); requireEnabled(rt, 'webhooks');
  await authorize(ctx.actor, true);
  return protect(transact(ctx.actor, rt.limits, async tx => {
    await authorize(ctx.actor, true);
    const removed = await tx.$queryRaw<Array<{ id: string }>>`DELETE FROM webhook_endpoints WHERE id = ${data.id} AND "workspaceId" = ${ctx.actor.workspaceId} AND "apiTokenId" = ${ctx.keyId} RETURNING id`;
    if (!removed[0]) throw notFound('webhook');
    await audit(tx, ctx.actor, 'webhook.deleted', { webhookId: data.id, viaApiKey: ctx.keyId });
    return { id: data.id, deleted: true as const };
  }));
}

export const REST_WEBHOOK_FEATURE = WEBHOOKS_FEATURE_ID;

/** The grant a key needs for /api/v1/posts: the same one the MCP post tools use, with its read/write split and channel ceiling. */
export const REST_POSTS_FEATURE = 'publishing/posts';
export const REST_POSTS_QUERY_KEYS = ['status', 'from', 'to', 'limit', 'channelId', 'pages', 'q'] as const;
export const REST_POSTS_BODY_MAX_BYTES = 256 * 1024;

/** Read a JSON body with a hard byte cap, checked before and after reading, so an oversized request is refused. */
export async function readCappedJson(request: Request, maxBytes = REST_POSTS_BODY_MAX_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new OperationError('invalid_request', 'This request is too large.');
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new OperationError('invalid_request', 'This request is too large.');
  try { return JSON.parse(text) as unknown; } catch { throw new OperationError('invalid_request', 'Enter valid details.'); }
}

/**
 * Posts visible to the key, newest first, through the Publishing list service: the key's channel ceiling, the owner's current access
 * and the key's result cap apply. `pages` (the legacy name) takes one channel id and is the same filter as `channelId`.
 */
export async function restListPosts(ctx: ApiKeyContext, query: Record<string, string>) {
  const { viewer } = ctx;
  const input: Record<string, unknown> = {};
  for (const key of ['status', 'from', 'to', 'q'] as const) if (query[key] !== undefined) input[key] = query[key];
  if (query.limit !== undefined) {
    if (!/^[1-9]\d{0,3}$/.test(query.limit)) throw new OperationError('invalid_request', 'Choose a valid result size.');
    input.limit = Number(query.limit);
  }
  if (query.channelId !== undefined && query.pages !== undefined && query.channelId !== query.pages) throw new OperationError('invalid_request', 'Choose one channel filter.');
  const channel = query.channelId ?? query.pages;
  if (channel !== undefined) {
    if (channel.includes(',')) throw new OperationError('invalid_request', 'Filter by one channel at a time.');
    input.channelId = channel;
  }
  const ids = pageIdsFor(viewer);
  const posts = await listPostsWithFirstComment({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(ids === undefined ? {} : { allowedTargetIds: ids }) }, input, viewer.maxResultItems ?? 100);
  return { posts };
}

/**
 * Create a draft, or schedule it when `scheduledAt` is given, through the Publishing `createPost` service: channel ceiling, format and
 * media validation, workspace approval holds (a held post is returned as `pending_approval`), versioning and audit all apply as in the
 * app and MCP. A key-level audit record is written like the MCP write receipt.
 */
export async function restCreatePost(ctx: ApiKeyContext, input: unknown) {
  const data = parse(REST_POST_CREATE_SCHEMA, input, 'Check the post details: message, targetIds and an optional future scheduledAt.');
  const { viewer } = ctx;
  const result = await createPostForApi(publishingActor(viewer), {
    message: data.message, targetIds: data.targetIds, ...(data.firstComment === undefined ? {} : { firstComment: data.firstComment }),
    ...(data.firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes: data.firstCommentDelayMinutes }),
    ...(data.link === undefined ? {} : { link: data.link }), ...(data.media === undefined ? {} : { media: data.media }),
    ...(data.destinationFormats === undefined ? {} : { destinationFormats: data.destinationFormats }),
    ...(data.scheduledAt === undefined ? {} : { scheduledAt: new Date(data.scheduledAt) }),
  });
  return auditedReceipt(viewer, 'rest.create_post', { postId: result.id, targetCount: data.targetIds.length, status: result.status }, { id: result.id, status: result.status, scheduledAt: result.scheduledAt, held: result.status === 'pending_approval' });
}
