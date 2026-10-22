/**
 * Reduces a page's address to the input of the analytics read services. The sidebar's channel scope (`channel=a,b`)
 * becomes the services' explicit channel filter; names the pages used before the shell (`filter`, `channel` lists)
 * are replaced, never merged. The services still authorize every channel.
 */
export function insightsReadInput(params: Record<string, string | string[] | undefined>, scopeIds: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { channel: _channel, channelId: _channelId, filter: _filter, ...rest } = params;
  return { ...rest, ...extra, ...(scopeIds.length ? { filter: '1', channel: [...scopeIds] } : {}) };
}

/** Query string (without `?`) with the given keys replaced; empty values remove the key. The channel scope stays. */
export function withParams(params: Record<string, string | string[] | undefined>, patch: Record<string, string | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key in patch) continue;
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  for (const [key, value] of Object.entries(patch)) if (value) query.set(key, value);
  return query.toString();
}
