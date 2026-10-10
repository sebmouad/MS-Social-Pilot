import { env } from '../env';
import { hmacHex } from '../crypto';
import { noteAppUsage, noteThrottled } from './budget';

/**
 * A thin, typed client over the Facebook Graph API.
 *
 * Two things matter more than the HTTP plumbing:
 *
 * 1. `appsecret_proof` — every call signs the access token with the app
 *    secret. Meta lets you *require* this in app settings, and once required a
 *    stolen token is useless without the secret. We always send it.
 *
 * 2. Error classification — Graph reports everything as HTTP 400 with a code in
 *    the body. Whether the scheduler should retry, give up, or mark the whole
 *    account dead depends entirely on that code, so it is decoded here once
 *    rather than guessed at each call site.
 */

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export type GraphFailureKind =
  /** Token expired, revoked, or password changed. The account must reconnect. */
  | 'auth'
  /** Missing permission or the app lacks a required feature/review. */
  | 'permission'
  /** Throttled by Meta. Retry, but slowly. */
  | 'rate_limit'
  /** Transient Meta-side fault or a network blip. Retry soon. */
  | 'transient'
  /** Facebook rejected the content itself (duplicate, spam, bad URL). */
  | 'rejected'
  /** Our bug: malformed request, unknown field. Retrying will not help. */
  | 'invalid_request';

export class GraphError extends Error {
  readonly kind: GraphFailureKind;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly httpStatus: number | null;
  readonly traceId: string | null;
  /** Meta's user-facing copy, when present — better than `message` for the UI. */
  readonly userMessage: string | null;

  constructor(options: {
    message: string;
    kind: GraphFailureKind;
    code?: number | null;
    subcode?: number | null;
    httpStatus?: number | null;
    traceId?: string | null;
    userMessage?: string | null;
  }) {
    super(options.message);
    this.name = 'GraphError';
    this.kind = options.kind;
    this.code = options.code ?? null;
    this.subcode = options.subcode ?? null;
    this.httpStatus = options.httpStatus ?? null;
    this.traceId = options.traceId ?? null;
    this.userMessage = options.userMessage ?? null;
  }

  /** Whether the scheduler should schedule another attempt. */
  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'rate_limit';
  }

  /** Whether the connected account should be flagged as needing reconnection. */
  get invalidatesToken(): boolean {
    return this.kind === 'auth';
  }

  /** Short, human-readable explanation for the UI. */
  get displayMessage(): string {
    return this.userMessage ?? this.message;
  }
}

/**
 * Graph error codes we act on. Anything unlisted falls through to a
 * conservative default based on the HTTP status.
 *
 * Reference: developers.facebook.com/docs/graph-api/guides/error-handling
 */
/** "Application request limit reached": the whole app is over its allowance. */
const APP_RATE_LIMIT_CODE = 4;

const ERROR_CODE_KINDS: Record<number, GraphFailureKind> = {
  1: 'transient', // Unknown error — Meta explicitly advises retrying.
  2: 'transient', // Service temporarily unavailable.
  4: 'rate_limit', // Application request limit reached.
  17: 'rate_limit', // User request limit reached.
  32: 'rate_limit', // Page request limit reached.
  613: 'rate_limit', // Custom-rate-limit hit.
  80001: 'rate_limit', // Pages API throttling.
  80002: 'rate_limit', // Instagram/other bucket throttling.
  10: 'permission', // Permission denied.
  190: 'auth', // Invalid/expired OAuth access token.
  200: 'permission', // Permissions error.
  283: 'permission', // Missing a required permission for the read.
  294: 'permission', // Managing advertisements requires an ad account role.
  3: 'permission', // Unknown method / app not authorised for this call.
  100: 'invalid_request', // Invalid parameter.
  368: 'rejected', // Temporarily blocked for policy violations.
  506: 'rejected', // Duplicate post.
  1609005: 'rejected', // Error scraping the shared link.
};

/**
 * Subcodes under code 190 that all mean the same thing operationally: the user
 * must log in again. Listed for clarity in logs rather than for branching.
 */
const AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);

export interface GraphRequestOptions {
  accessToken: string;
  /** Query parameters. Undefined values are dropped. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Form body for POST requests. Objects/arrays are JSON-encoded per Graph's convention. */
  body?: Record<string, string | number | boolean | object | undefined>;
  method?: 'GET' | 'POST' | 'DELETE';
  /** Overrides the pinned API version, for endpoints that need a specific one. */
  version?: string;
  signal?: AbortSignal;
}

export interface GraphResponse<T> {
  data: T;
  /** Parsed from x-app-usage, when Facebook sends it. */
  appUsagePercent: number | null;
}

/**
 * Sending a file is not a request that answers in a moment.
 *
 * One timeout covered both, at a minute, which is generous for a JSON call and
 * short for a video: a 25 MB upload needs better than 3.5 Mbit/s upstream to
 * finish in time, and when it does not the abort arrives as a network error,
 * is classed transient, and retries until the attempt limit — so the post fails
 * with a message that says nothing about the actual problem.
 */

function buildUrl(path: string, version: string): URL {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  return new URL(`${env.graphBaseUrl}/${version}/${normalized}`);
}

/**
 * HMAC-SHA256 of the access token, keyed by the app secret. Proves the caller
 * possesses the app secret and not merely a stolen token.
 */
export function appSecretProof(accessToken: string): string {
  return hmacHex(env.facebookAppSecret, accessToken);
}

/** Graph expects nested values as JSON strings inside form fields. */
function encodeFormValue(value: string | number | boolean | object): string {
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parseAppUsage(header: string | null): number | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(header) as { call_count?: number; total_time?: number; total_cputime?: number };
    const values = [parsed.call_count, parsed.total_time, parsed.total_cputime].filter(
      (value): value is number => typeof value === 'number',
    );
    return values.length ? Math.max(...values) : null;
  } catch {
    return null;
  }
}

function classify(body: GraphErrorBody | null, httpStatus: number): GraphFailureKind {
  if (body?.code !== undefined) {
    const mapped = ERROR_CODE_KINDS[body.code];
    if (mapped) return mapped;
  }
  if (httpStatus === 401 || httpStatus === 403) return 'permission';
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus >= 500) return 'transient';
  return 'invalid_request';
}

function toGraphError(body: GraphErrorBody | null, httpStatus: number, fallback: string): GraphError {
  const kind = classify(body, httpStatus);
  const codeNote =
    body?.code === 190 && body.error_subcode && AUTH_SUBCODES.has(body.error_subcode)
      ? ` (subcode ${body.error_subcode})`
      : '';

  return new GraphError({
    message: `${body?.message ?? fallback}${codeNote}`,
    kind,
    code: body?.code ?? null,
    subcode: body?.error_subcode ?? null,
    httpStatus,
    traceId: body?.fbtrace_id ?? null,
    userMessage: body?.error_user_msg ?? null,
  });
}

/**
 * Perform a Graph request.
 *
 * Throws {@link GraphError} for anything that is not a 2xx, including network
 * failures (classified as transient so the scheduler retries them).
 */
export async function graphRequest<T = unknown>(
  path: string,
  options: GraphRequestOptions,
): Promise<GraphResponse<T>> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path, options.version ?? env.graphVersion);

  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const init: RequestInit = { method, signal: options.signal };
  const headers = new Headers();

  // The token travels in the body for writes and the query for reads. Keeping
  // it out of the URL on writes keeps it out of proxy access logs.
  if (method === 'GET' || method === 'DELETE') {
    url.searchParams.set('access_token', options.accessToken);
    url.searchParams.set('appsecret_proof', appSecretProof(options.accessToken));
  } else {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(options.body ?? {})) {
      if (value !== undefined) form.set(key, encodeFormValue(value));
    }
    form.set('access_token', options.accessToken);
    form.set('appsecret_proof', appSecretProof(options.accessToken));
    init.body = form;
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }

  init.headers = headers;

  let response: Response;
  try {
    response = await withTimeout(
      (signal) => fetch(url, { ...init, signal: options.signal ?? signal }),
      env.graphTimeoutMs,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GraphError({
      message: `Network error calling Graph API: ${reason}`,
      kind: 'transient',
    });
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Graph occasionally returns an HTML error page from an edge proxy.
      if (!response.ok) {
        throw new GraphError({
          message: `Graph API returned a non-JSON error (HTTP ${response.status}).`,
          kind: response.status >= 500 ? 'transient' : 'invalid_request',
          httpStatus: response.status,
        });
      }
    }
  }

  // Every answer says how much of the app's allowance is gone; the budget
  // keeps the last word, so background syncs stop before publishing has to.
  const appUsagePercent = parseAppUsage(response.headers.get('x-app-usage'));
  noteAppUsage(appUsagePercent);

  if (!response.ok) {
    const body = (parsed as { error?: GraphErrorBody } | null)?.error ?? null;
    const error = toGraphError(body, response.status, `Graph API request failed (HTTP ${response.status}).`);
    // Code 4 is the app's own limit — the one every Page shares. A Page's or
    // a user's limit (32, 17) holds only that Page back.
    if (error.code === APP_RATE_LIMIT_CODE) noteThrottled();
    throw error;
  }

  return { data: parsed as T, appUsagePercent };
}

interface PagedResponse<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Read every page of a Graph edge.
 *
 * Graph pages with opaque cursors and will happily hand back an endless chain,
 * so `maxPages` is a required guard rather than an option nobody sets: a Page
 * with 400,000 comments must not be able to run the worker out of memory.
 */
export async function graphPaged<T>(
  path: string,
  options: GraphRequestOptions & { maxPages: number; limit?: number },
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;

  for (let page = 0; page < options.maxPages; page += 1) {
    const { data } = await graphRequest<PagedResponse<T>>(path, {
      ...options,
      params: { ...options.params, limit: options.limit ?? 100, after },
    });

    items.push(...(data.data ?? []));

    after = data.paging?.cursors?.after;
    // No `next` means this was the last page, whatever the cursor says.
    if (!after || !data.paging?.next) break;
  }

  return items;
}

/**
 * Upload binary media (photo or video) as multipart/form-data.
 *
 * Kept separate from {@link graphRequest} because Facebook needs the raw
 * `source` part, and letting fetch set the multipart boundary means we must not
 * touch the content-type header.
 */
export async function graphUpload<T = unknown>(
  path: string,
  options: {
    accessToken: string;
    file: { data: Uint8Array | Buffer; filename: string; contentType: string };
    fields?: Record<string, string | number | boolean | object | undefined>;
    version?: string;
    signal?: AbortSignal;
  },
): Promise<T> {
  const url = buildUrl(path, options.version ?? env.graphVersion);
  const form = new FormData();

  for (const [key, value] of Object.entries(options.fields ?? {})) {
    if (value !== undefined) form.set(key, encodeFormValue(value));
  }
  form.set('access_token', options.accessToken);
  form.set('appsecret_proof', appSecretProof(options.accessToken));
  form.set(
    'source',
    // No `new Uint8Array(...)` around this: a Buffer is one already, and the
    // wrapper only copies the file a second time on its way into the Blob.
    new Blob([options.file.data], { type: options.file.contentType }),
    options.file.filename,
  );

  let response: Response;
  try {
    response = await withTimeout(
      (signal) => fetch(url, { method: 'POST', body: form, signal: options.signal ?? signal }),
      env.graphUploadTimeoutMs,
    );
  } catch (error) {
    // An abort here is the timeout above, and saying so is the difference
    // between a person knowing their file is too big for the link this server
    // sits on and reading "the operation was aborted" five times.
    if (error instanceof Error && error.name === 'AbortError') {
      const seconds = Math.round(env.graphUploadTimeoutMs / 1000);
      const megabytes = (options.file.data.byteLength / (1024 * 1024)).toFixed(1);
      throw new GraphError({
        message:
          `Uploading ${options.file.filename} (${megabytes} MB) did not finish within ${seconds} seconds. ` +
          'Use a smaller file, or raise the media upload timeout in Configuration.',
        kind: 'transient',
      });
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new GraphError({ message: `Network error uploading media: ${reason}`, kind: 'transient' });
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = (parsed as { error?: GraphErrorBody } | null)?.error ?? null;
    throw toGraphError(body, response.status, `Media upload failed (HTTP ${response.status}).`);
  }
  return parsed as T;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

/** Wraps a non-Graph exception so callers only ever handle one error type. */
export function asGraphError(error: unknown): GraphError {
  if (error instanceof GraphError) return error;
  return new GraphError({
    message: error instanceof Error ? error.message : String(error),
    kind: 'transient',
  });
}

/** The major number of a Graph version string: "v25.0" is 25. NaN if unreadable. */
export function graphMajor(version: string): number {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : Number.NaN;
}

/** The last Graph version that serves Page ratings. */
export const RATINGS_GRAPH_VERSION = 'v21.0';

/** When Meta retires v21.0, and with it the last way to read Page ratings. */
export const RATINGS_VERSION_RETIRES = new Date('2027-01-21T00:00:00Z');

/**
 * Whether Page ratings can still be read.
 *
 * Meta deprecated `GET /{page-id}/ratings` in v22.0 ("Page recommendations
 * have been deprecated for v22.0 and future versions"), so on a later pinned
 * version the edge is asked on v21.0 explicitly (see fetchReviews). That works
 * until v21.0 itself is retired; after that there is no version left to ask,
 * the edge is not asked at all, and what was stored before stays readable.
 */
export function pageRatingsAvailable(version: string, now: Date = new Date()): boolean {
  const major = graphMajor(version);
  if (Number.isFinite(major) && major < 22) return true;
  return now < RATINGS_VERSION_RETIRES;
}

/**
 * Facebook no longer has the object: the post was deleted, or moved to the
 * bin, on Facebook itself. Code 100 with subcode 33 ("does not exist, cannot
 * be loaded due to missing permissions, or does not support this operation").
 */
export function isMissingObject(error: unknown): boolean {
  return error instanceof GraphError && error.code === 100 && error.subcode === 33;
}
