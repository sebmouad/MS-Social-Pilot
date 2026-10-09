/**
 * Whether a request is a write that another site started.
 *
 * The session cookie is `SameSite=Lax`, which already keeps it off a
 * cross-site POST — but only a cross-*site* one. A page on a sibling subdomain
 * (a blog, a marketing site, anything else on the same registrable domain) is
 * the same site, gets the cookie sent, and can post a `text/plain` body that
 * `request.json()` parses happily. `Sec-Fetch-Site` is set by the browser and
 * cannot be forged by the page, so it closes that without tokens in every form.
 *
 * Only browsers send it. Meta's callbacks, the cron endpoint and `curl` send
 * nothing, and nothing is exactly what lets them through: this is a check on
 * what browsers were tricked into, not an access control.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isCrossSiteWrite(method: string, secFetchSite: string | null): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  const site = secFetchSite?.toLowerCase() ?? null;
  return site === 'cross-site' || site === 'same-site';
}
