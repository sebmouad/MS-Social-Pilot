/**
 * The one profile selection the whole app follows (NEXT_PHASES Phase A).
 *
 * The address is the source of truth — `group`, `pages` (comma ids) and `net`
 * (a network) — so a filtered screen can be bookmarked or sent. When a screen
 * is opened without them, the last selection made in this workspace comes
 * back from a cookie, which is what keeps it while moving around the app.
 * The server always clamps what it reads to the member's own Pages
 * (src/lib/page-filter.ts); this module only names and carries it.
 *
 * Plain module: client components write the cookie with it.
 */

export const SELECTION_KEYS = ['group', 'pages', 'net'] as const;

/** Networks the selection can narrow to, as `net` values. Facebook covers Pages and Groups. */
export const SELECTION_NETWORKS = ['facebook', 'instagram', 'bluesky', 'mastodon', 'linkedin', 'threads', 'x', 'pinterest'] as const;
export type SelectionNetwork = (typeof SELECTION_NETWORKS)[number];

/** Platforms as the sidebar groups them: one company's networks together. */
export const PLATFORMS: ReadonlyArray<{ key: string; networks: readonly SelectionNetwork[] }> = [
  { key: 'meta', networks: ['facebook', 'instagram', 'threads'] },
  { key: 'linkedin', networks: ['linkedin'] },
  { key: 'x', networks: ['x'] },
  { key: 'pinterest', networks: ['pinterest'] },
  { key: 'bluesky', networks: ['bluesky'] },
  { key: 'mastodon', networks: ['mastodon'] },
];

/** The platform a network belongs to: Meta for Facebook, Instagram and Threads, else the network itself. */
export function platformOf(network: string): string {
  return PLATFORMS.find((platform) => (platform.networks as readonly string[]).includes(network))?.key ?? network;
}

/** The networks a platform key stands for. */
export function networksOfPlatform(key: string): string[] {
  return [...(PLATFORMS.find((platform) => platform.key === key)?.networks ?? [key])];
}

/** Target types each network value stands for. */
export function typesOfNetwork(net: SelectionNetwork): string[] {
  return net === 'facebook' ? ['page', 'group'] : [net];
}

export function networkOfType(type: string): SelectionNetwork {
  return type === 'page' || type === 'group' ? 'facebook' : (type as SelectionNetwork);
}

/** Items split by network, in the order of SELECTION_NETWORKS; each keeps its own order. */
export function groupByNetwork<T extends { type: string }>(items: T[]): Array<{ network: SelectionNetwork; items: T[] }> {
  return SELECTION_NETWORKS.map((network) => ({ network, items: items.filter((item) => networkOfType(item.type) === network) })).filter(
    (group) => group.items.length > 0,
  );
}

export function selectionCookieName(workspaceId: string): string {
  return `msp_sel_${workspaceId}`;
}

/** Only the selection's own keys, in a fixed order, from any query. */
export function selectionQuery(params: URLSearchParams | Record<string, string | string[] | undefined>): string {
  const read = (key: string) => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };
  const out = new URLSearchParams();
  for (const key of SELECTION_KEYS) {
    const value = read(key);
    if (value) out.set(key, value);
  }
  return out.toString();
}

/** Remember the selection for this workspace (a year; ids only, re-checked by the server). */
export function rememberSelection(workspaceId: string, query: string): void {
  if (typeof document === 'undefined') return;
  const name = selectionCookieName(workspaceId);
  document.cookie = query
    ? `${name}=${encodeURIComponent(query)}; path=/; max-age=31536000; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}
