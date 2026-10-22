import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type IntegrationsActor = { userId: string; workspaceId: string };

/** Event names are the stable receiver-facing protocol. They are shared product events, not provider names. */
export const WEBHOOK_EVENTS = ['post.scheduled', 'post.published', 'post.failed', 'comment.received', 'page.disconnected', 'report.ready'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const NOTIFICATION_FLAGS = ['onPublishFailure', 'onTokenExpiry', 'onApprovalRequest', 'onApprovalDecision', 'onNewInbox', 'onQueueEmpty', 'onDraftUpdated', 'onModerationAlert', 'onNoteMention'] as const;
export type NotificationFlag = (typeof NOTIFICATION_FLAGS)[number];
/** No stored row means "not configured": everything on except the opt-in inbox email. */
export const NOTIFICATION_DEFAULTS: Record<NotificationFlag, boolean> = {
  onPublishFailure: true, onTokenExpiry: true, onApprovalRequest: true, onApprovalDecision: true, onNewInbox: false,
  onQueueEmpty: true, onDraftUpdated: true, onModerationAlert: true, onNoteMention: true,
};
export const MUTE_EVENTS = ['publishFailure', 'newInbox', 'queueEmpty'] as const;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const NOTIFICATION_UPDATE_SCHEMA_BASE = z.object({
  ...Object.fromEntries(NOTIFICATION_FLAGS.map(flag => [flag, z.boolean().optional()])) as Record<NotificationFlag, z.ZodOptional<z.ZodBoolean>>,
  /** Replaces the whole mute list when present. */
  mutes: z.array(z.object({ targetId: id, event: z.enum(MUTE_EVENTS) }).strict()).optional(),
}).strict();
export const NOTIFICATION_SCHEMA = NOTIFICATION_UPDATE_SCHEMA_BASE.extend({ confirmation: z.string() }).strict()
  .refine(v => Object.keys(v).some(key => key !== 'confirmation'), 'Choose at least one change.');

export const WEBHOOK_CREATE_SCHEMA = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().min(1).max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  confirmation: z.string(),
}).strict();
export const WEBHOOK_UPDATE_SCHEMA = z.object({
  id, enabled: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(), confirmation: z.string(),
}).strict().refine(v => v.enabled !== undefined || v.events !== undefined);
export const ID_CONFIRM_SCHEMA = z.object({ id, confirmation: z.string() }).strict();
export const DELIVERY_QUERY_SCHEMA = z.object({ id, page: z.number().int().min(1).max(10000).optional() }).strict();

export const TOKEN_SCOPES = ['read', 'write'] as const;
export const TOKEN_CREATE_SCHEMA = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(TOKEN_SCOPES),
  /** Channels the key may touch; omitted means everything its owner can reach. A key never exceeds its owner. */
  targetIds: z.array(id).max(500).optional(),
  expiresInDays: z.number().int().min(1).max(1095).optional(),
  confirmation: z.string(),
}).strict();

export const OAUTH_REGISTER_SCHEMA = z.object({
  client_name: z.string().trim().min(1).max(100).default('Connector'),
  redirect_uris: z.array(z.string().max(2000)).min(1),
}).strip();

export const OAUTH_AUTHORIZE_SCHEMA = z.object({
  clientId: id, redirectUri: z.string().max(2000), codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeChallengeMethod: z.literal('S256'), scope: z.enum(TOKEN_SCOPES), state: z.string().max(500).optional(), confirmation: z.string(),
}).strict();
export const OAUTH_TOKEN_SCHEMA = z.object({
  grant_type: z.literal('authorization_code'), code: z.string().min(20).max(200), client_id: id,
  redirect_uri: z.string().max(2000), code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict();
export const TOKEN_REVOKE_SCHEMA = z.object({ id, confirmation: z.string() }).strict();
/** REST-hook subscription made with an API key (the key's owner and scope still apply). */
export const REST_HOOK_SCHEMA = z.object({
  name: z.string().trim().min(1).max(60).optional(), url: z.string().trim().min(1).max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
}).strict();

export const confirmations = {
  updateNotifications: () => 'UPDATE NOTIFICATION PREFERENCES',
  authorizeConnector: (clientId: string) => `AUTHORIZE CONNECTOR ${clientId}`,
  createWebhook: (name: string) => `CREATE WEBHOOK ${name}`,
  updateWebhook: (webhookId: string) => `UPDATE WEBHOOK ${webhookId}`,
  deleteWebhook: (webhookId: string) => `DELETE WEBHOOK ${webhookId}`,
  rotateWebhookSecret: (webhookId: string) => `ROTATE WEBHOOK SECRET ${webhookId}`,
  testWebhook: (webhookId: string) => `TEST WEBHOOK ${webhookId}`,
  redeliver: (deliveryId: string) => `REDELIVER WEBHOOK DELIVERY ${deliveryId}`,
  createToken: (name: string) => `CREATE API KEY ${name}`,
  revokeToken: (tokenId: string) => `REVOKE API KEY ${tokenId}`,
};

/** Same digest as the legacy app so migrated keys keep working. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const API_TOKEN_PREFIX = 'msp_';
export const API_TOKEN_SHAPE = /^msp_[A-Za-z0-9_-]{20,80}$/;
export const newApiToken = () => `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
export const tokenPrefix = (token: string) => token.slice(0, API_TOKEN_PREFIX.length + 6);
export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** `sha256=<hex>` over `<timestamp>.<body>`: the value of `X-MSP-Signature`. */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
export function verifyWebhookSignature(secret: string, timestamp: number, body: string, header: string) {
  const expected = Buffer.from(signWebhook(secret, timestamp, body)); const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** https anywhere, or http on this machine (desktop clients listen on loopback). No fragments. */
export function isAllowedRedirect(uri: string) {
  let url: URL; try { url = new URL(uri); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
export const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
