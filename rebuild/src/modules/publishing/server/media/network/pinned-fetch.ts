import * as nodeHttp from 'node:http';
import * as nodeHttps from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { isNonPublicAddress, NetGuardError, type Fetcher, type FetchRequest } from './net-guard';

/**
 * Address-pinning transport (closes DNS rebinding for feeds and media import).
 *
 * `guardedFetch` resolves a name once, validates every answer and hands the validated
 * list to this fetcher as `request.resolved`. The connection is made ONLY to one of those
 * addresses: Node's `lookup` hook is replaced so the socket layer never resolves the name
 * again, while `host` stays the original hostname so the Host header, the TLS SNI name and
 * certificate verification all keep using the real name. No automatic redirects, no
 * content decoding (the byte cap in guardedFetch therefore bounds wire bytes), no proxy.
 */
export type PinnedRequestOptions = {
  protocol: 'http:' | 'https:'; host: string; port: number; path: string; method: 'GET'; headers: Record<string, string>; signal: AbortSignal;
  servername?: string;
  lookup: (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void;
};
export type PinnedResponse = { status: number; headers: Array<[string, string]>; body: ReadableStream<Uint8Array> | null; peerAddress: string | null };
/** Transport port. The default uses node:http(s); tests inject a fake and never open a socket. */
export type PinnedTransport = (options: PinnedRequestOptions) => Promise<PinnedResponse>;

/** A `lookup` that can only ever answer with the validated address (handles both callback shapes). */
export function pinnedLookup(address: string): PinnedRequestOptions['lookup'] {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

export const nodeTransport: PinnedTransport = options => new Promise<PinnedResponse>((resolve, reject) => {
  const lib = options.protocol === 'https:' ? nodeHttps : nodeHttp;
  let socket: import('node:net').Socket | undefined;
  let peerAddress: string | null = null;
  const request = lib.request({
    host: options.host, port: options.port, path: options.path, method: options.method, headers: options.headers, signal: options.signal,
    lookup: options.lookup as never, agent: false, ...(options.servername ? { servername: options.servername } : {}),
  }, response => {
    const headers: Array<[string, string]> = [];
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) value.forEach(v => headers.push([name, v])); else if (typeof value === 'string') headers.push([name, value]);
    }
    const status = response.statusCode ?? 0;
    const body = status === 204 || status === 304 ? null : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>);
    if (!body) response.resume();
    resolve({ status, headers, body, peerAddress });
  });
  request.on('socket', connectedSocket => {
    socket = connectedSocket;
    const markConnected = () => { peerAddress = socket?.remoteAddress ?? null; };
    if (socket.connecting) socket.once('connect', markConnected);
    else markConnected();
  });
  request.on('error', reject);
  request.end();
});

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

function normalizedPeer(raw: string): string | null {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  const version = isIP(address);
  if (version === 4) return `4:${address}`;
  if (version !== 6) return null;
  let canonical: string;
  try { canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1); } catch { return null; }
  if (canonical.startsWith('::ffff:')) {
    const tail = canonical.slice('::ffff:'.length);
    if (tail.includes('.')) return `4:${tail}`;
    const groups = tail.split(':');
    if (groups.length !== 2) return null;
    const high = Number.parseInt(groups[0]!, 16); const low = Number.parseInt(groups[1]!, 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    return `4:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `6:${canonical}`;
}

export type PinnedFetcherOptions = { transport?: PinnedTransport };

/** Build a Fetcher that connects only to the validated addresses, trying them in order. */
export function createPinnedFetcher(options: PinnedFetcherOptions = {}): Fetcher {
  const transport = options.transport ?? nodeTransport;
  return async (request: FetchRequest): Promise<Response> => {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new NetGuardError('blocked_scheme', 'Use an https address.');
    // Defence in depth: the pinned list must exist and be public even if a caller skipped the guard.
    const candidates = request.resolved.filter(address => isIP(address) !== 0);
    if (!candidates.length || candidates.length !== request.resolved.length || candidates.some(isNonPublicAddress)) throw new NetGuardError('blocked_address', 'This address cannot be fetched.');
    const name = hostOf(url);
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    const headers: Record<string, string> = { ...request.headers, host: url.host, 'accept-encoding': 'identity', connection: 'close' };
    let last: unknown;
    for (const address of candidates) {
      if (request.signal.aborted) break;
      try {
        const response = await transport({
          protocol: url.protocol, host: name, port, path: `${url.pathname}${url.search}`, method: 'GET', headers, signal: request.signal,
          ...(url.protocol === 'https:' && !isIP(name) ? { servername: name } : {}), lookup: pinnedLookup(address),
        });
        if (!response.peerAddress || normalizedPeer(response.peerAddress) !== normalizedPeer(address)) {
          void response.body?.cancel().catch(() => undefined);
          throw new NetGuardError('blocked_address', 'This address cannot be fetched.');
        }
        if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
          void response.body?.cancel().catch(() => undefined);
          throw new NetGuardError('bad_status', 'The address did not return a usable response.', 'upstream_failure');
        }
        const encodings = response.headers.filter(([name]) => name.toLowerCase() === 'content-encoding').map(([, value]) => value.trim().toLowerCase());
        if (encodings.some(encoding => encoding !== 'identity')) {
          void response.body?.cancel().catch(() => undefined);
          throw new NetGuardError('bad_status', 'The address returned an unsupported response encoding.', 'upstream_failure');
        }
        const hasBody = response.body && ![204, 205, 304].includes(response.status);
        return new Response(hasBody ? response.body : null, { status: response.status, headers: response.headers });
      } catch (error) { last = error; }
    }
    throw last instanceof Error ? last : new Error('unreachable');
  };
}

export const pinnedFetcher: Fetcher = createPinnedFetcher();
