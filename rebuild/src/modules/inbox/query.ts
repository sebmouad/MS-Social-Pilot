import { inboxManifest } from './manifest';
export type InboxSearchParams = Record<string, string | string[] | undefined>;
/** URL transport conversion only; the application service validates every value. */
export function inboxListInput(params: InboxSearchParams): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [source, key] of [['channel', 'channelId'], ['type', 'kind'], ['status', 'state'], ['hidden', 'hidden'], ['q', 'q'], ['cursor', 'cursor']] as const) {
    if (params[source] !== undefined && !(source === 'channel' && params[source] === 'all')) input[key] = params[source];
  }
  if (params.limit !== undefined) input.limit = typeof params.limit === 'string' && /^\d+$/.test(params.limit) ? Number(params.limit) : params.limit;
  return input;
}
export type InboxLocation = { channel?: string; type?: string; status?: string; hidden?: string; q?: string; cursor?: string; limit?: string; thread?: string; historyCursor?: string };
export function inboxHref(location: InboxLocation = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(location)) if (value && !(key === 'channel' && value === 'all')) search.set(key, value);
  return search.size ? `${inboxManifest.href}?${search}` : inboxManifest.href;
}
