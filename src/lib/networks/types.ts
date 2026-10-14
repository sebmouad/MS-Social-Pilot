import { GraphError } from '../facebook/graph';
import { assertPublicUrl, assertResolvesPublicly } from '../safe-fetch';

/**
 * What every network connector speaks.
 *
 * Failures are thrown as `GraphError`s with the same kinds Facebook's are
 * sorted into, so the scheduler's retry rules — try a blip again soon, a
 * throttle later, a refusal never, a dead token not until reconnected — apply
 * to every network without knowing which one it is talking to.
 */

export const NETWORK_KEYS = ['bluesky', 'mastodon', 'linkedin', 'threads', 'x', 'pinterest', 'telegram', 'youtube', 'tiktok'] as const;
export type NetworkKey = (typeof NETWORK_KEYS)[number];

export function isNetworkKey(value: string): value is NetworkKey {
  return (NETWORK_KEYS as readonly string[]).includes(value);
}

export interface NetworkMedia {
  kind: 'image' | 'video';
  /** An https URL the network's servers can fetch. */
  url: string;
  mimeType?: string;
  altText?: string;
  /** The file itself, for networks that take an upload rather than a URL. */
  read: () => Promise<Buffer>;
}

export interface NetworkPost {
  text: string;
  link: string | null;
  media: NetworkMedia[];
  /** The link's card, when the composer fetched one. */
  linkPreview?: { title?: string | null; description?: string | null; image?: string | null } | null;
  /** Unique per destination: sent where a network accepts an idempotency key. */
  idempotencyKey: string;
}

export interface NetworkCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  meta: Record<string, unknown>;
}

export interface NetworkPublishResult {
  remotePostId: string;
  remoteUrl: string;
}

/** A published post's public counters, as the network reports them. */
export interface NetworkPostStats {
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  /** Quote posts, where the network has them. */
  quotes?: number | null;
  /** Views or impressions, where the network reports them. */
  views?: number | null;
}

/** A reply to a published post, shaped like a Facebook comment so the inbox stores it the same way. */
export interface NetworkReply {
  remoteId: string;
  /** The reply it answers; null when it answers the post itself. */
  parentRemoteId: string | null;
  message: string;
  fromName: string | null;
  fromId: string | null;
  likeCount: number;
  replyCount: number;
  isHidden: boolean;
  createdTime: Date;
}

export interface NetworkContext {
  credentials: NetworkCredentials;
  /** Store credentials a refresh produced, before anything else can fail. */
  saveCredentials: (next: NetworkCredentials) => Promise<void>;
}

export type { NetworkRules } from '../network-rules';
import type { NetworkRules } from '../network-rules';

export interface NetworkConnector {
  key: NetworkKey;
  label: string;
  rules: NetworkRules;
  /** Publish to one destination: an account, a company Page, a board. */
  publish: (target: { providerId: string; name: string }, post: NetworkPost, context: NetworkContext) => Promise<NetworkPublishResult>;
  /** Remove a post owned by this connection, where the provider permits it. */
  remove?: (remotePostId: string, context: NetworkContext) => Promise<void>;
  /** Read a published post's counters; absent where this app cannot read them yet. */
  stats?: (remotePostId: string, context: NetworkContext) => Promise<NetworkPostStats>;
  /** Read the replies to a published post; absent where this app cannot read them yet. */
  replies?: (remotePostId: string, context: NetworkContext) => Promise<NetworkReply[]>;
}

/** Turn an HTTP answer into the failure kind the scheduler understands. */
export function failureFor(status: number, message: string, network: string): GraphError {
  const kind =
    status === 401
      ? 'auth'
      : status === 403
        ? 'permission'
        : status === 429
          ? 'rate_limit'
          : status >= 500
            ? 'transient'
            : 'rejected';
  return new GraphError({ message: `${network}: ${message}`.slice(0, 500), kind, httpStatus: status });
}

/**
 * JSON over HTTPS with a timeout, every failure mapped to a kind.
 * `untrustedHost` checks the address first: a Mastodon server is whatever
 * somebody typed, and must not be allowed to point inside this network.
 */
export async function netJson<T>(
  network: string,
  url: string,
  init: RequestInit & { untrustedHost?: boolean } = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  if (init.untrustedHost) {
    const parsed = assertPublicUrl(url);
    await assertResolvesPublicly(parsed.hostname);
  }
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000), redirect: 'error' });
  } catch (error) {
    throw new GraphError({ message: `${network}: ${error instanceof Error ? error.message : 'network error'}`, kind: 'transient' });
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw failureFor(response.status, describeError(data) ?? `answered ${response.status}`, network);
  }
  return { data: data as T, headers: response.headers, status: response.status };
}

/** The human part of the error bodies the networks send back. */
export function describeError(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === 'string') return body.slice(0, 300);
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error_description', 'detail', 'error', 'title']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).message === 'string') {
      return (value as Record<string, string>).message!;
    }
  }
  const errors = record.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
    const first = errors[0] as Record<string, unknown>;
    if (typeof first.message === 'string') return first.message;
    if (typeof first.detail === 'string') return first.detail;
  }
  return null;
}


/** The text, with the link added at the end when the network has no card for it and it is not already there. */
export function textWithLink(post: NetworkPost): string {
  if (!post.link || post.text.includes(post.link)) return post.text;
  return `${post.text.trimEnd()}\n\n${post.link}`.trim();
}
