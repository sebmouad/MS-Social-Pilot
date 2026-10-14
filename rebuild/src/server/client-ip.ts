/**
 * Which address a request came from, as well as it can be known.
 *
 * Two callers, and they want it for different reasons: the short-link redirect
 * hashes it so a click is counted once, and the sign-in route uses it as one
 * of two rate-limit keys. Named once here because the two had their own copies
 * and a proxy header added to one would not have reached the other.
 *
 * **None of this is trustworthy on its own.** Every header below is set by
 * whatever is in front of the app, and a client talking to the app directly
 * can send any of them. So they are read only when the operator says a proxy
 * is in front (`TRUST_PROXY`); otherwise a visitor could pick a fresh address
 * for every sign-in attempt and never meet the per-client limit. Even then
 * neither caller treats the result as an identity: the click count is an
 * estimate, and the load-bearing half of the sign-in limit is the email
 * address, which cannot be forged.
 */

/**
 * Cloudflare's own header, read first.
 *
 * Cloudflare overwrites it on every request with the address it accepted the
 * connection from, so behind Cloudflare it is the one header a visitor cannot
 * choose for themselves — `x-forwarded-for` arrives as a list that begins with
 * whatever the client sent. In front of any other proxy this header is absent
 * and the list is used instead.
 */
const CLOUDFLARE = 'cf-connecting-ip';

/**
 * Whether a proxy in front of the app sets the headers above.
 *
 * Read from `process.env` directly rather than through `env`: it describes how
 * the machine is wired, which only whoever deployed it knows, so it is not a
 * setting anybody should be able to flip from the configuration screen.
 */
export function trustProxy(): boolean {
  const value = process.env.TRUST_PROXY?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * The client's address, or null when it cannot be known.
 *
 * Next's route handlers are not handed the socket, so with no trusted proxy
 * there is nothing honest to return — and null, rather than a placeholder,
 * lets each caller decide what an unknown address means.
 */
export function clientIp(request: Request): string | null {
  return clientIpFromHeaders(request.headers);
}

/** The same, from the headers alone (server components and actions). */
export function clientIpFromHeaders(headers: Headers): string | null {
  if (!trustProxy()) return null;

  const cloudflare = headers.get(CLOUDFLARE)?.trim();
  if (cloudflare) return cloudflare;

  // The left-most entry is the original client; everything after it is the
  // chain of proxies that forwarded it.
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  return headers.get('x-real-ip')?.trim() || null;
}

/** Cloudflare's two-letter country for the visitor, behind a trusted proxy only. */
export function clientCountry(headers: Headers): string | null {
  if (!trustProxy()) return null;
  const country = headers.get('cf-ipcountry')?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;
}
