/** HTTP/Fetch protocol invariants, not configurable authorization policy. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isWriteMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export type WriteOriginPolicy = {
  publicOrigin: string;
  developmentOrigins: readonly string[];
};

function originOf(value: string, exact: boolean): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return !exact || url.origin === value ? url.origin : null;
  } catch { return null; }
}

/**
 * Transport CSRF protection only: services still authenticate every operation,
 * enforce tenant/resource access, obtain exact consent and audit domain writes.
 * Never trust Host/Forwarded/X-Forwarded-* as a substitute for the Root origin.
 * Originless clients without cookies may reach independently authenticated OAuth,
 * provider callback and bearer endpoints; adding Authorization never bypasses a
 * cookie request's origin checks. Body/content-type cannot opt out of this guard.
 */
export function isAllowedWrite(request: Request, policy: WriteOriginPolicy): boolean {
  if (!isWriteMethod(request.method)) return true;
  const site = request.headers.get('sec-fetch-site')?.toLowerCase();
  // Same-site includes sibling origins which receive SameSite=Lax cookies.
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const trusted = new Set([policy.publicOrigin || new URL(request.url).origin, ...policy.developmentOrigins]);
  const origin = request.headers.get('origin');
  if (origin !== null) {
    const parsed = originOf(origin, true);
    return parsed !== null && trusted.has(parsed);
  }
  const referer = request.headers.get('referer');
  if (referer !== null) {
    const parsed = originOf(referer, false);
    return parsed !== null && trusted.has(parsed);
  }
  // Fetch Metadata is browser-controlled; same-origin proves browser provenance
  // when a privacy policy strips Origin and Referer. A raw HTTP client can forge
  // it, but cannot thereby authenticate or obtain another user's session cookie.
  if (site === 'same-origin') return true;
  return !request.headers.get('cookie');
}
