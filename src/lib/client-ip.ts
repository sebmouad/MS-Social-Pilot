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
 * can send any of them. That is why neither caller treats the result as an
 * identity: the click count is an estimate, and the load-bearing half of the
 * sign-in limit is the email address, which cannot be forged.
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

export function clientIp(request: Request): string | null {
  const cloudflare = request.headers.get(CLOUDFLARE)?.trim();
  if (cloudflare) return cloudflare;

  // The left-most entry is the original client; everything after it is the
  // chain of proxies that forwarded it.
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  return request.headers.get('x-real-ip')?.trim() || null;
}
