import { isIP } from 'node:net';
import { OperationError } from '@/lib/operation-error';

/**
 * Shared outbound-fetch guard for user-supplied URLs (feed sources, media import).
 *
 * Layers: URL shape (scheme, credentials, port), host allowlist, literal and
 * resolved-address checks (every answer must be public, an empty answer fails
 * closed), manual redirect following with the same checks per hop, an overall
 * deadline and a streaming byte cap. Transport and DNS are injected ports so
 * tests never touch a network. DNS rebinding is closed because the name is resolved
 * once here and the default transport (./pinned-fetch) connects only to one of the
 * validated `resolved` addresses, keeping the original Host/SNI.
 */
export type NetGuardReason = 'invalid_url' | 'blocked_scheme' | 'blocked_host' | 'blocked_address' | 'not_allowlisted' | 'too_many_redirects' | 'too_large' | 'timeout' | 'bad_status' | 'unreachable';

export class NetGuardError extends OperationError {
  constructor(readonly reason: NetGuardReason, message: string, code: 'invalid_request' | 'upstream_failure' = 'invalid_request') {
    super(code, message);
    this.name = 'NetGuardError';
  }
}

export type Resolver = (hostname: string, signal?: AbortSignal) => Promise<string[]>;
export type FetchRequest = { url: string; headers: Record<string, string>; signal: AbortSignal; resolved: readonly string[]; /** Defaults to GET. POST is used by callers that deliver a small body (outbound webhooks). */ method?: 'GET' | 'POST'; body?: string };
export type Fetcher = (request: FetchRequest) => Promise<Response>;
export type FetchPolicy = { timeoutMs: number; maxBytes: number; maxRedirects: number; allowHttp: boolean; hostAllowlist: readonly string[] };
export type FetchDeps = { resolve: Resolver; fetcher: Fetcher };
export type FetchResult =
  | { notModified: true; finalUrl: string }
  | { notModified: false; finalUrl: string; status: number; bytes: Buffer; contentType: string; etag: string | null; lastModified: string | null };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Protocol-level web ports only; arbitrary ports are a scanning primitive. */
const WEB_PORTS = new Set(['', '80', '443']);
const V4_BLOCKED: Array<[number, number, number, number]> = [
  [0, 0, 0, 8], [10, 0, 0, 8], [100, 64, 0, 10], [127, 0, 0, 8], [169, 254, 0, 16], [172, 16, 0, 12],
  [192, 0, 0, 24], [192, 0, 2, 24], [192, 88, 99, 24], [192, 168, 0, 16], [198, 18, 0, 15], [198, 51, 100, 24], [203, 0, 113, 24], [224, 0, 0, 4], [240, 0, 0, 4],
];

function v4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

/** True for any literal that is not public unicast. Non-IP strings return false. */
export function isNonPublicAddress(raw: string): boolean {
  const address = canonicalAddress(raw);
  const version = isIP(address);
  if (version === 4) {
    const value = v4ToNumber(address);
    return value === null || V4_BLOCKED.some(([a, b, c, bits]) => { const base = v4Base(a, b, c, bits); return value >= base && value < base + 2 ** (32 - bits); });
  }
  if (version === 6) return !isPublicGlobalIpv6(address);
  return false;
}

function canonicalAddress(raw: string): string {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  if (isIP(address) !== 6) return address;
  try { return new URL(`http://[${address}]/`).hostname.slice(1, -1); } catch { return address; }
}

/** Only global-unicast IPv6 is fetchable. Special-purpose ranges are rejected conservatively. */
function isPublicGlobalIpv6(address: string): boolean {
  if (address === '::' || address === '::1' || address.startsWith('::ffff:') || /^::\d/.test(address)) return false;
  const groups = address.split(':');
  const first = Number.parseInt(groups[0] || '0', 16);
  const second = Number.parseInt(groups[1] || '0', 16);
  if (first < 0x2000 || first > 0x3fff) return false; // outside 2000::/3
  // IANA special-purpose 2001::/23 and 2001:db8::/32, 6to4 2002::/16, documentation 3fff::/20.
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && second <= 0x0fff) return false;
  return true;
}
// The table stores [a, b, c, prefix]; the prefix always lands on a whole octet boundary or a known partial one.
function v4Base(a: number, b: number, c: number, bits: number): number {
  const raw = ((a * 256 + b) * 256 + c) * 256;
  const size = 2 ** (32 - bits);
  return Math.floor(raw / size) * size;
}

function blockedName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain') || !host.includes('.') && !isIP(host);
}
const allowlisted = (host: string, list: readonly string[]) => list.length === 0 || list.some(entry => { const e = entry.toLowerCase().replace(/^\*?\./, ''); return host === e || host.endsWith(`.${e}`); });

/** Validate a URL as written (no network). Returns the parsed URL. */
export function checkUrlShape(raw: string, policy: Pick<FetchPolicy, 'allowHttp' | 'hostAllowlist'>): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new NetGuardError('invalid_url', 'Enter a valid web address.'); }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) throw new NetGuardError('blocked_scheme', policy.allowHttp ? 'Use an http or https address.' : 'Use an https address.');
  if (url.username || url.password) throw new NetGuardError('invalid_url', 'Web addresses with credentials are not accepted.');
  if (!WEB_PORTS.has(url.port)) throw new NetGuardError('blocked_host', 'This address cannot be fetched.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || blockedName(host) || isNonPublicAddress(host)) throw new NetGuardError('blocked_host', 'This address cannot be fetched.');
  if (!allowlisted(host, policy.hostAllowlist)) throw new NetGuardError('not_allowlisted', 'This site is not on the allowed list for this workspace installation.');
  return url;
}

function timeoutError(): NetGuardError { return new NetGuardError('timeout', 'The address took too long to respond.', 'upstream_failure'); }

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal, onLateValue?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(timeoutError()); };
    operation.then(value => {
      if (settled) { onLateValue?.(value); return; }
      settled = true; cleanup(); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    });
    if (signal.aborted) onAbort();
    else {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}

async function resolvePublic(url: URL, deps: FetchDeps, signal: AbortSignal): Promise<string[]> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return [host];
  let answers: string[];
  try { answers = await raceAbort(deps.resolve(host, signal), signal); }
  catch (error) {
    if (error instanceof NetGuardError) throw error;
    throw new NetGuardError(signal.aborted ? 'timeout' : 'unreachable', signal.aborted ? 'The address took too long to respond.' : 'The address could not be reached.', 'upstream_failure');
  }
  // Fail closed: no answer, or any private answer, is a refusal.
  if (!answers.length || answers.some(isNonPublicAddress)) throw new NetGuardError('blocked_address', 'This address cannot be fetched.');
  return answers;
}

async function readCapped(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { void response.body?.cancel().catch(() => undefined); throw new NetGuardError('too_large', 'The file is larger than the allowed size.'); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new NetGuardError('timeout', 'The address took too long to respond.', 'upstream_failure');
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new NetGuardError('too_large', 'The file is larger than the allowed size.');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof NetGuardError) throw error;
    throw new NetGuardError(signal.aborted ? 'timeout' : 'unreachable', signal.aborted ? 'The address took too long to respond.' : 'The address could not be reached.', 'upstream_failure');
  }
  return Buffer.concat(chunks);
}

/** Fetch a public URL under the policy. Never returns provider/transport text. */
export async function guardedFetch(rawUrl: string, policy: FetchPolicy, deps: FetchDeps, options: { headers?: Record<string, string>; acceptNotModified?: boolean; signal?: AbortSignal } = {}): Promise<FetchResult> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
  try {
    if (controller.signal.aborted) throw timeoutError();
    let current = rawUrl;
    let headers = options.headers ?? {};
    for (let hop = 0; hop <= policy.maxRedirects; hop += 1) {
      const url = checkUrlShape(current, policy);
      const resolved = await resolvePublic(url, deps, controller.signal);
      let response: Response;
      try {
        const pending = Promise.resolve().then(() => deps.fetcher({ url: url.toString(), headers, signal: controller.signal, resolved }));
        response = await raceAbort(pending, controller.signal, late => { void late.body?.cancel().catch(() => undefined); });
      }
      catch (error) {
        if (error instanceof NetGuardError) throw error;
        throw new NetGuardError(controller.signal.aborted ? 'timeout' : 'unreachable', controller.signal.aborted ? 'The address took too long to respond.' : 'The address could not be reached.', 'upstream_failure');
      }
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        void response.body?.cancel().catch(() => undefined);
        if (!location) throw new NetGuardError('bad_status', 'The address returned an unusable redirect.', 'upstream_failure');
        try {
          const next = new URL(location, url);
          if (next.origin !== url.origin) {
            const redirectSafe = new Set(['accept', 'user-agent', 'if-none-match', 'if-modified-since']);
            headers = Object.fromEntries(Object.entries(headers).filter(([name]) => redirectSafe.has(name.toLowerCase())));
          }
          current = next.toString();
        } catch { throw new NetGuardError('invalid_url', 'The address returned an unusable redirect.', 'upstream_failure'); }
        continue;
      }
      if (response.status === 304 && options.acceptNotModified) { void response.body?.cancel().catch(() => undefined); return { notModified: true, finalUrl: url.toString() }; }
      if (response.status < 200 || response.status > 299) { void response.body?.cancel().catch(() => undefined); throw new NetGuardError('bad_status', 'The address did not return a usable response.', 'upstream_failure'); }
      const bytes = await readCapped(response, policy.maxBytes, controller.signal);
      return { notModified: false, finalUrl: url.toString(), status: response.status, bytes, contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
    }
    throw new NetGuardError('too_many_redirects', 'The address redirected too many times.', 'upstream_failure');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', forwardAbort); }
}

/**
 * Unpinned transport (global fetch). It cannot connect to a validated address, so it is NOT
 * the default; it exists only for callers that accept the DNS-rebinding residual explicitly.
 */
export const unpinnedFetcher: Fetcher = ({ url, headers, signal }) => fetch(url, { method: 'GET', headers, signal, redirect: 'manual', cache: 'no-store' });
export const defaultResolver: Resolver = async hostname => {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(hostname, { all: true, verbatim: true })).map(answer => answer.address);
};
/** Production deps: the address-pinning transport from ./pinned-fetch, loaded lazily to keep this module free of node socket imports. */
export const defaultFetchDeps = (): FetchDeps => ({
  resolve: defaultResolver,
  fetcher: async request => (await import('./pinned-fetch')).pinnedFetcher(request),
});
