import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching a URL somebody typed, from inside the network this server sits in.
 *
 * Two features do it: link previews and RSS feeds. Both take an address from a
 * user and have the server open it, which makes the server a way into whatever
 * it can reach and the user cannot — the cloud metadata endpoint, the database,
 * an admin panel bound to localhost. The RSS poller used to do this with no
 * check at all and `redirect: 'follow'`, and reported the status code back to
 * the screen, which is a port scanner with a friendly interface.
 *
 * Three layers, because each closes something the one before it cannot:
 *
 * 1. **The address as written.** Loopback, private and link-local literals and
 *    the obvious internal names are refused before anything is sent.
 * 2. **The address it resolves to.** `metadata.example.com` pointing at
 *    169.254.169.254 passes the first check, so the name is looked up and every
 *    answer checked. A failed lookup is let through: the fetch will fail on the
 *    same lookup, and refusing would only turn an ordinary "cannot reach" into
 *    a misleading "blocked".
 * 3. **Every redirect.** Followed by hand, so each hop goes through both checks
 *    again. `redirect: 'follow'` would let a public page bounce the request
 *    anywhere.
 *
 * A name that answers publicly to the check and privately to the fetch (DNS
 * rebinding) still gets through; an egress proxy is the answer to that, and the
 * deployment notes say so.
 */

export class UnsafeUrlError extends Error {
  constructor(message = 'That address points at a private network, which this server does not fetch.') {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOOKUP_TIMEOUT_MS = 5_000;

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d{1,3}$/.test(part) || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** [first address, prefix length] for every IPv4 range that is not the public internet. */
const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
];

function inV4Range(value: number, [base, bits]: [string, number]): boolean {
  const start = ipv4ToNumber(base)!;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

/**
 * Whether an IP address literal is anywhere but the public internet.
 * Not an IP at all is `false`: this answers for addresses, not names.
 */
export function isPrivateAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(address);

  if (version === 4) {
    const value = ipv4ToNumber(address);
    return value === null || PRIVATE_V4.some((range) => inV4Range(value, range));
  }

  if (version === 6) {
    return (
      address === '::' ||
      address === '::1' ||
      // Unique-local (fc00::/7) and link-local (fe80::/10).
      /^f[cd]/.test(address) ||
      /^fe[89ab]/.test(address) ||
      // IPv4-mapped and NAT64: both carry a v4 address past a v4-only check.
      address.startsWith('::ffff:') ||
      address.startsWith('64:ff9b:')
    );
  }

  return false;
}

/** Refused on sight, before any lookup: internal names and private literals. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  return isPrivateAddress(host);
}

/**
 * Parse and check a URL as written. Throws {@link UnsafeUrlError} for a private
 * host; a plain `TypeError` for something that is not an http(s) URL at all.
 */
export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Only http and https URLs can be fetched.');
  }
  if (isBlockedHost(url.hostname)) throw new UnsafeUrlError();
  return url;
}

type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

let resolver: Resolver = systemResolver;

/** Test seam: answer lookups without a network. `null` restores the real one. */
export function setResolverForTests(replacement: Resolver | null): void {
  resolver = replacement ?? systemResolver;
}

export async function assertResolvesPublicly(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  // A literal was already judged by `isBlockedHost`; there is nothing to look up.
  if (isIP(host)) return;

  let addresses: string[];
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    addresses = await Promise.race([
      resolver(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('lookup timed out')), LOOKUP_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch {
    // Unresolvable here is unresolvable for fetch too, which then fails with an
    // honest network error rather than a misleading refusal.
    return;
  }

  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError();
}

/**
 * `fetch`, for a URL a user supplied: every hop checked as written and as
 * resolved, redirects followed by hand. Throws {@link UnsafeUrlError} when any
 * hop is private, and an ordinary `Error` when redirects do not settle.
 *
 * A 304 is returned as it is — it is a 3xx, but not a redirect, and a feed
 * poller depends on seeing it.
 */
export async function fetchPublic(
  raw: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
  maxRedirects = 3,
): Promise<Response> {
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = assertPublicUrl(current);
    await assertResolvesPublicly(url.hostname);

    const response = await fetch(url, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    // Nothing to follow: hand back what there is and let the caller judge it.
    if (!location) return response;

    // Not reading the body of a hop we are leaving; release the connection.
    await response.body?.cancel().catch(() => undefined);
    current = new URL(location, url).toString();
  }

  throw new Error(`Gave up after ${maxRedirects} redirects.`);
}

/**
 * Read at most `maxBytes` of a body, then stop. A URL that streams without end
 * must not be able to fill the heap.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder('utf-8').decode(await readCappedBytes(response, maxBytes));
}

/** {@link readCapped}, as bytes. */
export async function readCappedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const room = maxBytes - total;
      const chunk = value.length > room ? value.subarray(0, room) : value;
      chunks.push(chunk);
      total += chunk.length;
    }
  }
  await reader.cancel().catch(() => undefined);

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
