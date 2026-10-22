import { object, providerRequest, ProviderHttpError, type ProviderMessages } from '@/server/platforms/provider-http';
import type { RenewedToken } from '@/server/platforms/token-connection';
import type { YoutubePolicy } from './config';

type Locale = 'en' | 'fr';
export type YoutubeChannel = { id: string; title: string; pictureUrl: string | null };

export function youtubeText(policy: YoutubePolicy, key: keyof YoutubePolicy['copy'], locale: Locale = 'en') {
  return policy.copy[key][locale];
}
export function youtubeMessages(policy: YoutubePolicy, locale: Locale = 'en'): ProviderMessages {
  return { unavailable: youtubeText(policy, 'unavailable', locale), permission: youtubeText(policy, 'permission', locale), uncertain: youtubeText(policy, 'uncertain', locale) };
}

/**
 * Google OAuth and YouTube Data API calls. Wire parameter names (`access_type=offline`, `prompt=consent`,
 * resumable upload headers, `part` lists) are protocol invariants and stay in this file.
 */
export function createYoutubeApi(policy: YoutubePolicy, options: { clientId: string; clientSecret: string; fetch?: typeof fetch; locale?: Locale }) {
  const locale = options.locale ?? 'en';
  const messages = youtubeMessages(policy, locale);
  const base = policy.apiBaseUrl.replace(/\/+$/, '');
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  function authorizationUrl(input: { redirectUri: string; state: string }) {
    const url = new URL(policy.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: options.clientId, redirect_uri: input.redirectUri, response_type: 'code', scope: policy.connectScopes.join(' '),
      // offline + consent: Google only sends a refresh token when asked this way.
      access_type: 'offline', prompt: 'consent', state: input.state,
    }).toString();
    return url.toString();
  }

  async function token(params: Record<string, string>, signal?: AbortSignal) {
    const { json } = await providerRequest({
      fetch: options.fetch, url: policy.tokenUrl, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }), timeoutMs: policy.requestTimeoutMs, signal, messages,
    });
    if (typeof json.access_token !== 'string' || !json.access_token || typeof json.expires_in !== 'number' || !(json.expires_in > 0)) throw new ProviderHttpError(messages.unavailable, 'rejected');
    return {
      accessToken: json.access_token,
      // Google keeps the same refresh token unless it sends a new one.
      refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
      accessExpiresAt: new Date(Date.now() + json.expires_in * 1000),
      scopes: typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : [],
    };
  }

  const exchange = (input: { code: string; redirectUri: string; signal?: AbortSignal }) => token({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri }, input.signal);

  async function refresh(refreshToken: string, signal?: AbortSignal): Promise<RenewedToken> {
    const renewed = await token({ grant_type: 'refresh_token', refresh_token: refreshToken }, signal);
    return { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken ?? refreshToken, accessExpiresAt: renewed.accessExpiresAt, grantExpiresAt: null };
  }

  /** Every channel the account manages; stops at the configured page bound and reports it. */
  async function channels(accessToken: string, signal?: AbortSignal): Promise<{ items: YoutubeChannel[]; truncated: boolean }> {
    const items: YoutubeChannel[] = []; let pageToken: string | undefined;
    for (let page = 0; page < policy.channelMaxPages; page++) {
      const url = new URL(`${base}/channels`);
      url.search = new URLSearchParams({ part: 'snippet', mine: 'true', maxResults: String(policy.channelPageSize), ...(pageToken ? { pageToken } : {}) }).toString();
      const { json } = await providerRequest({ fetch: options.fetch, url: url.toString(), headers: bearer(accessToken), timeoutMs: policy.requestTimeoutMs, signal, messages, allowEmpty: true });
      for (const raw of Array.isArray(json.items) ? json.items : []) {
        const item = object(raw); const snippet = object(item.snippet); const thumbnails = object(snippet.thumbnails);
        const picture = object(thumbnails.default).url;
        if (typeof item.id === 'string' && item.id && typeof snippet.title === 'string') items.push({ id: item.id, title: snippet.title, pictureUrl: typeof picture === 'string' && picture.startsWith('https://') ? picture : null });
      }
      pageToken = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : undefined;
      if (!pageToken) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  /** Start a resumable upload. Nothing exists remotely yet, so a failure here is a clean refusal. */
  async function startUpload(input: { accessToken: string; channelId: string; title: string; description: string; size: number; mimeType: string; signal?: AbortSignal }): Promise<string> {
    const url = new URL(policy.uploadUrl);
    url.search = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' }).toString();
    const { headers } = await providerRequest({
      fetch: options.fetch, url: url.toString(), method: 'POST', allowEmpty: true, timeoutMs: policy.uploadStartTimeoutMs, signal: input.signal, messages,
      headers: { ...bearer(input.accessToken), 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(input.size), 'x-upload-content-type': input.mimeType },
      body: JSON.stringify({ snippet: { title: input.title, description: input.description, channelId: input.channelId }, status: { privacyStatus: policy.privacyStatus, selfDeclaredMadeForKids: policy.selfDeclaredMadeForKids } }),
    });
    const location = headers.get('location');
    if (!location) throw new ProviderHttpError(messages.unavailable, 'rejected');
    // The session URL must stay on the configured upload origin so credentials never follow a provider-supplied host.
    if (new URL(location).origin !== new URL(policy.uploadUrl).origin) throw new ProviderHttpError(messages.unavailable, 'rejected');
    return location;
  }

  /** Send the bytes. The video may exist remotely after this starts, so a lost answer is uncertain. */
  async function sendUpload(input: { sessionUrl: string; bytes: Uint8Array; mimeType: string; signal?: AbortSignal }): Promise<string> {
    const { json } = await providerRequest({
      fetch: options.fetch, url: input.sessionUrl, method: 'PUT', headers: { 'content-type': input.mimeType }, body: input.bytes as unknown as BodyInit,
      timeoutMs: policy.uploadTimeoutMs, signal: input.signal, messages, committing: true,
    });
    if (typeof json.id !== 'string' || !json.id) throw new ProviderHttpError(messages.uncertain, 'uncertain');
    return json.id;
  }

  /** The video as the owner sees it. Null when Google has no such video. */
  async function video(accessToken: string, videoId: string, signal?: AbortSignal): Promise<{ id: string; channelId: string | null; uploadStatus: string | null; privacyStatus: string | null; publishedAt: Date | null } | null> {
    const url = new URL(`${base}/videos`);
    url.search = new URLSearchParams({ part: 'snippet,status', id: videoId }).toString();
    const { json } = await providerRequest({ fetch: options.fetch, url: url.toString(), headers: bearer(accessToken), timeoutMs: policy.requestTimeoutMs, signal, messages, allowEmpty: true });
    const item = object(Array.isArray(json.items) ? json.items[0] : null);
    if (typeof item.id !== 'string') return null;
    const snippet = object(item.snippet); const status = object(item.status);
    const published = typeof snippet.publishedAt === 'string' ? new Date(snippet.publishedAt) : null;
    return {
      id: item.id, channelId: typeof snippet.channelId === 'string' ? snippet.channelId : null,
      uploadStatus: typeof status.uploadStatus === 'string' ? status.uploadStatus : null, privacyStatus: typeof status.privacyStatus === 'string' ? status.privacyStatus : null,
      publishedAt: published && Number.isFinite(published.getTime()) ? published : null,
    };
  }

  /** Delete is idempotent: a video Google no longer has counts as removed. */
  async function remove(accessToken: string, videoId: string, signal?: AbortSignal): Promise<void> {
    const url = new URL(`${base}/videos`);
    url.search = new URLSearchParams({ id: videoId }).toString();
    try {
      await providerRequest({ fetch: options.fetch, url: url.toString(), method: 'DELETE', headers: bearer(accessToken), timeoutMs: policy.requestTimeoutMs, signal, messages, committing: true, allowEmpty: true });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 404) return;
      throw error;
    }
  }

  return { authorizationUrl, exchange, refresh, channels, startUpload, sendUpload, video, remove, messages };
}
export type YoutubeApi = ReturnType<typeof createYoutubeApi>;

/** Title from the first line (YouTube allows 100 characters and no angle brackets). */
export function youtubeTitle(text: string, maxCharacters: number, fallback: string): string {
  const first = text.split('\n').find(line => line.trim())?.trim() ?? '';
  return ([...first.replace(/[<>]/g, '')].slice(0, maxCharacters).join('').trim() || fallback);
}

export function youtubeDescription(text: string, link: string | null | undefined, maxCharacters: number): string {
  const body = !link || text.includes(link) ? text : `${text.trimEnd()}\n\n${link}`.trim();
  return [...body.replace(/[<>]/g, '')].slice(0, maxCharacters).join('');
}
