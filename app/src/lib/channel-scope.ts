/** Channel scope (design v2, 01 §5): one URL parameter, a remembered cookie and a validation step. Display filter only; services still authorize every read. */
export const SCOPE_PARAM = 'channel';
/** Older query names, still read for one release and mapped onto `channel`. */
export const LEGACY_SCOPE_PARAMS = ['channelId', 'target', 'targets', 'targetIds', 'channels'] as const;

export type ChannelScope = {
  /** Valid channel ids, in the order given. Empty means all selected channels. */
  ids: string[];
  /** Ids that were requested but are unknown, unselected or not authorized. */
  dropped: number;
  source: 'url' | 'cookie' | 'none';
};

type SearchInput = URLSearchParams | Record<string, string | string[] | undefined> | undefined;

function read(search: SearchInput, name: string): string | undefined {
  if (!search) return undefined;
  if (search instanceof URLSearchParams) return search.get(name) ?? undefined;
  const value = search[name];
  return Array.isArray(value) ? value[0] : value;
}

const split = (value: string | undefined) => (value ?? '').split(',').map(item => item.trim()).filter(Boolean);

/** Reads `channel` (then the legacy names), falls back to the cookie, and keeps only ids in `allowed`. The URL always wins. */
export function parseChannelScope(input: { search?: SearchInput; cookie?: string; allowed: readonly string[] }): ChannelScope {
  const allowed = new Set(input.allowed);
  const fromUrl = [SCOPE_PARAM, ...LEGACY_SCOPE_PARAMS].map(name => read(input.search, name)).find(value => value !== undefined);
  const source: ChannelScope['source'] = fromUrl !== undefined ? 'url' : input.cookie ? 'cookie' : 'none';
  const requested = [...new Set(split(fromUrl ?? input.cookie))];
  const ids = requested.filter(id => allowed.has(id));
  return { ids, dropped: requested.length - ids.length, source };
}

export const serializeChannelScope = (ids: readonly string[]) => ids.join(',');

/** Adds, replaces or removes `channel` on a relative URL and drops the legacy names; other parameters stay. */
export function withChannelScope(href: string, ids: readonly string[]): string {
  const url = new URL(href, 'https://scope.invalid');
  for (const name of LEGACY_SCOPE_PARAMS) url.searchParams.delete(name);
  if (ids.length) url.searchParams.set(SCOPE_PARAM, serializeChannelScope(ids));
  else url.searchParams.delete(SCOPE_PARAM);
  url.searchParams.delete('page');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Click = only this channel; Ctrl/⌘-click toggles it in the current set. Clicking the only selected channel resets to all. */
export function nextChannelScope(current: readonly string[], id: string, additive: boolean): string[] {
  if (additive) return current.includes(id) ? current.filter(item => item !== id) : [...current, id];
  return current.length === 1 && current[0] === id ? [] : [id];
}
