/**
 * Redirect table skeleton for the design v2 route move (`/publishing/*`, `/analytics/*`, `/ads/*` to `/content/*`, `/create`, `/insights/*`).
 * Each area batch declares its `redirects` in the owning module manifest; this file only collects and applies them.
 * HTTP 308 keeps the method, the query string and every unknown parameter; renamed parameters are mapped.
 */
import { moduleManifests } from '@/modules';
import type { RouteRedirect } from '@/modules/types';
import { LEGACY_SCOPE_PARAMS, SCOPE_PARAM } from './channel-scope';

export const ROUTE_REDIRECTS: readonly RouteRedirect[] = moduleManifests.flatMap((manifest) => ('redirects' in manifest ? (manifest.redirects as readonly RouteRedirect[]) : []));

/** Old channel parameter names become `channel` on every redirected route unless the entry maps them itself. */
function mapParams(source: URLSearchParams, rename: Record<string, string> = {}): URLSearchParams {
  const target = new URLSearchParams();
  for (const [name, value] of source) {
    const mapped = rename[name] ?? ((LEGACY_SCOPE_PARAMS as readonly string[]).includes(name) ? SCOPE_PARAM : name);
    if (mapped === SCOPE_PARAM && target.has(SCOPE_PARAM)) continue;
    target.append(mapped, value);
  }
  return target;
}

/** Where a request for `pathname` should go, or null when no entry matches. Exact path or a `/*` prefix entry. */
export function resolveRedirect(pathname: string, search: string, table: readonly RouteRedirect[] = ROUTE_REDIRECTS): string | null {
  for (const entry of table) {
    const prefix = entry.from.endsWith('/*') ? entry.from.slice(0, -2) : null;
    const hit = prefix === null ? pathname === entry.from : pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (!hit) continue;
    const tail = prefix !== null && entry.to.endsWith('/*') ? pathname.slice(prefix.length) : '';
    const base = entry.to.endsWith('/*') ? entry.to.slice(0, -2) : entry.to;
    const query = mapParams(new URLSearchParams(search), entry.params).toString();
    return `${base}${tail}${query ? `?${query}` : ''}`;
  }
  return null;
}
