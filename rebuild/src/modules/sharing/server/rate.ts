/**
 * Per-visitor brake for the public sharing and bio routes, with a store of its own. It is deliberately NOT the
 * shared `server/rate-limit` map: that one holds login windows, and a stranger sending arbitrary public keys
 * must never be able to evict them. Memory is bounded by the Root-managed `capacity`; when it is full, expired
 * windows go first and then the oldest live ones, so the worst a flood can do is reset other public windows.
 *
 * With a trusted proxy the visitor address keys the bucket. Without one the address is unknowable (Next gives
 * route handlers no socket), so counting all strangers in one bucket would let a single flood lock every client
 * out. Instead each resource (link or page) gets its own anonymous bucket, scaled by the Root-managed factor.
 * Callers create resource buckets only for resources that exist (a validated token or slug that resolved), so
 * guessing keys cannot grow the store. Counts are per process and reset on restart; behind several processes or
 * without a proxy header they are approximate. Edge rate limiting remains the deployment's responsibility.
 */
type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function take(key: string, limit: number, windowMs: number, capacity: number, now: number): boolean {
  const existing = windows.get(key);
  if (existing && existing.resetAt > now) { existing.count += 1; return existing.count <= limit; }
  if (windows.size >= capacity) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    while (windows.size >= capacity) { const oldest = windows.keys().next(); if (oldest.done) break; windows.delete(oldest.value); }
  }
  windows.delete(key);
  windows.set(key, { count: 1, resetAt: now + windowMs });
  return 1 <= limit;
}

export function visitorAllowed(scope: string, address: string | null, resource: string, limit: number, windowMs: number, anonymousFactor: number, capacity: number, now = Date.now()): boolean {
  if (address) return take(`${scope}:ip:${address}`, limit, windowMs, capacity, now);
  return take(`${scope}:anon:${resource}`, limit * Math.max(1, anonymousFactor), windowMs, capacity, now);
}
/** A shared allowance for one resource regardless of address (for example all answers to one link). */
export function resourceAllowed(scope: string, resource: string, limit: number, windowMs: number, capacity: number, now = Date.now()): boolean {
  return take(`${scope}:res:${resource}`, limit, windowMs, capacity, now);
}
export const publicLimiterSize = () => windows.size;
/** Test seam. */
export function resetPublicLimits() { windows.clear(); }
