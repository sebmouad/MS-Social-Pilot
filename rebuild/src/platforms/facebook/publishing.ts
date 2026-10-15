import type { FacebookConfig } from './config';
import { validateFacebookConfig } from './config';
import { graphObjectUrl } from './protocol';
import type { AdMutationRequest, OAuthExchangeRequest, OAuthStartRequest, PlatformAdapter, PublishRequest, PublishResult } from '../types';

export type FacebookFetch = typeof fetch;

export class FacebookApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number, readonly subcode?: number) {
    super(message);
    this.name = 'FacebookApiError';
  }
}

export interface FacebookPage { id: string; name: string; category: string | null; accessToken: string }
export interface FacebookCurrentUser { id: string; name: string; pictureUrl: string | null }
export interface FacebookTokenExchangeInput { accessToken: string; appId: string; appSecret: string }
export interface FacebookLongLivedToken { accessToken: string; expiresAt: Date }
export interface FacebookAdAccount { id: string; name: string; currency: string | null; status: number | null }
export type FacebookMedia = { kind: 'image' | 'video'; url: string; altText?: string };
export interface FacebookPublishInput {
  targetId: string; accessToken: string; text?: string; link?: string | null;
  media?: readonly FacebookMedia[]; firstComment?: string | null;
}
export interface FacebookPublished { remoteId: string; url: string | null }
export interface FacebookInboxMessage { id: string; text: string | null; createdAt: Date; fromName: string | null; fromId: string | null }
export interface FacebookConversation { id: string; snippet: string | null; updatedAt: Date; unreadCount: number; messageCount: number; messages: FacebookInboxMessage[] }
export interface FacebookComment { id: string; message: string; fromName: string | null; fromId: string | null; createdAt: Date; parentId: string | null; likeCount: number; replyCount: number; isHidden: boolean }
export interface FacebookEngine {
  getAuthorizationUrl(input: OAuthStartRequest): string;
  exchangeCode(input: OAuthExchangeRequest): Promise<{ accessToken: string; expiresAt: Date | null }>;
  exchangeForLongLivedToken(input: FacebookTokenExchangeInput): Promise<FacebookLongLivedToken>;
  getCurrentUser(accessToken: string): Promise<FacebookCurrentUser>;
  discoverPages(accessToken: string): Promise<FacebookPage[]>;
  discoverAdAccounts(accessToken: string): Promise<FacebookAdAccount[]>;
  publish(input: FacebookPublishInput): Promise<FacebookPublished>;
  getStatus(accessToken: string, remoteId: string): Promise<{ state: 'published' | 'scheduled' | 'unknown'; publishedAt: Date | null }>;
  deletePost(accessToken: string, remoteId: string): Promise<void>;
  listInbox(accessToken: string, pageId: string): Promise<FacebookConversation[]>;
  listComments(accessToken: string, postId: string): Promise<FacebookComment[]>;
  getPageAnalytics(accessToken: string, pageId: string, since?: Date, until?: Date): Promise<Record<string, number | null>>;
  getAdInsights(accessToken: string, accountId: string, since: Date, until: Date): Promise<Array<Record<string, unknown>>>;
  updateAd(input: AdMutationRequest): Promise<void>;
  replyToConversation(accessToken: string, conversationId: string, text: string): Promise<string>;
  replyToComment(accessToken: string, commentId: string, text: string): Promise<string>;
  moderateComment(accessToken: string, commentId: string, hidden: boolean): Promise<void>;
  deleteComment(accessToken: string, commentId: string): Promise<void>;
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function date(value: unknown): Date | null { if (typeof value !== 'string') return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function graphError(payload: unknown, status: number): FacebookApiError {
  const err = object(object(payload).error);
  return new FacebookApiError(typeof err.message === 'string' ? err.message : `Facebook answered ${status}.`, status,
    typeof err.code === 'number' ? err.code : undefined, typeof err.error_subcode === 'number' ? err.error_subcode : undefined);
}

/** Create a bounded Graph client. Tokens are sent in form/query parameters and never logged. */
export function createFacebookEngine(rawConfig: FacebookConfig, fetchImpl: FacebookFetch = fetch): FacebookEngine {
  const config = validateFacebookConfig(rawConfig);
  async function request<T = unknown>(path: string, options: { method?: string; token: string; params?: Record<string, string | number | undefined>; body?: Record<string, string | undefined> } ): Promise<T> {
    const url = graphObjectUrl(config, path);
    if (options.method !== 'POST') {
      url.searchParams.set('access_token', options.token);
      for (const [key, value] of Object.entries(options.params ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const body = options.method === 'POST' ? new URLSearchParams({ access_token: options.token, ...(options.body ?? {}) }) : undefined;
    let response: Response;
    try {
      response = await fetchImpl(url, { method: options.method ?? 'GET', headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
        body, redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) });
    } catch (error) { throw new FacebookApiError(error instanceof Error ? error.message : 'Facebook request failed.', 0); }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || object(payload).error) throw graphError(payload, response.status);
    return payload as T;
  }

  async function pages<T>(first: string, token: string): Promise<T[]> {
    const results: T[] = []; let next: string | undefined = first; const seen = new Set<string>();
    for (let page = 0; page < config.maxPages && next; page++) {
      const response = await fetchImpl(next, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) }).catch((error: unknown) => {
        throw new FacebookApiError(error instanceof Error ? error.message : 'Facebook request failed.', 0);
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || object(payload).error) throw graphError(payload, response.status);
      const data = object(payload).data;
      if (!Array.isArray(data)) throw new FacebookApiError('Facebook returned an invalid paginated response.', response.status);
      results.push(...data as T[]);
      const paging = object(object(payload).paging); const cursors = object(paging.cursors);
      const after = typeof cursors.after === 'string' ? cursors.after : undefined;
      const link = typeof paging.next === 'string' ? paging.next : undefined;
      if (!link || !after || seen.has(after)) { next = undefined; break; }
      const nextUrl = new URL(link);
      const configuredBase = new URL(config.graphBaseUrl);
      if (nextUrl.protocol !== 'https:' || nextUrl.origin !== configuredBase.origin || !nextUrl.pathname.startsWith(`/${config.graphVersion}/`)) {
        throw new FacebookApiError('Facebook returned a pagination URL outside the configured Graph endpoint.', 0);
      }
      seen.add(after); next = link;
      if (page === config.maxPages - 1) throw new FacebookApiError('Facebook pagination exceeded the configured page limit.', 0);
    }
    return results;
  }
  function collectionUrl(path: string, token: string, fields: string): string {
    const url = graphObjectUrl(config, path); url.searchParams.set('access_token', token); url.searchParams.set('fields', fields); url.searchParams.set('limit', String(config.pageSize)); return url.toString();
  }
  const toPage = (raw: unknown): FacebookPage | null => {
    const p = object(raw); if (typeof p.id !== 'string' || typeof p.access_token !== 'string') return null;
    return { id: p.id, name: typeof p.name === 'string' ? p.name : p.id, category: typeof p.category === 'string' ? p.category : null, accessToken: p.access_token };
  };

  return {
    getAuthorizationUrl(input) {
      const url = new URL(`${config.oauthBaseUrl.replace(/\/+$/, '')}/dialog/oauth`);
      url.searchParams.set('client_id', input.appId); url.searchParams.set('redirect_uri', input.redirectUri);
      url.searchParams.set('state', input.state); url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', input.scopes.join(','));
      return url.toString();
    },
    async exchangeCode(input) {
      const url = graphObjectUrl(config, 'oauth/access_token');
      url.searchParams.set('client_id', input.appId); url.searchParams.set('client_secret', input.appSecret);
      url.searchParams.set('redirect_uri', input.redirectUri); url.searchParams.set('code', input.code);
      let response: Response;
      try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) }); }
      catch (error) { throw new FacebookApiError(error instanceof Error ? error.message : 'Facebook token exchange failed.', 0); }
      const payload: unknown = await response.json().catch(() => null); const data = object(payload);
      if (!response.ok || data.error) throw graphError(payload, response.status);
      if (typeof data.access_token !== 'string' || !data.access_token) throw new FacebookApiError('Facebook did not return an access token.', response.status);
      const expiresAt = typeof data.expires_in === 'number' ? new Date(Date.now() + data.expires_in * 1000) : null;
      return { accessToken: data.access_token, expiresAt };
    },
    async exchangeForLongLivedToken(input) {
      if (!input.accessToken || !input.appId || !input.appSecret) throw new FacebookApiError('A user token and app credentials are required.', 0);
      const url = graphObjectUrl(config, 'oauth/access_token');
      url.searchParams.set('grant_type', 'fb_exchange_token');
      url.searchParams.set('client_id', input.appId);
      url.searchParams.set('client_secret', input.appSecret);
      url.searchParams.set('fb_exchange_token', input.accessToken);
      let response: Response;
      try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) }); }
      catch (error) { throw new FacebookApiError(error instanceof Error ? error.message : 'Facebook token exchange failed.', 0); }
      const payload: unknown = await response.json().catch(() => null); const data = object(payload);
      if (!response.ok || data.error) throw graphError(payload, response.status);
      if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
        throw new FacebookApiError('Facebook returned an invalid long-lived token or expiry.', response.status);
      }
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);
      if (!Number.isFinite(expiresAt.getTime())) throw new FacebookApiError('Facebook returned an invalid token expiry.', response.status);
      return { accessToken: data.access_token, expiresAt };
    },
    async getCurrentUser(token) {
      const raw = object(await request('me', { token, params: { fields: 'id,name,picture.type(large)' } }));
      if (typeof raw.id !== 'string' || typeof raw.name !== 'string') throw new FacebookApiError('Facebook did not return the current user identity.', 200);
      const picture = object(raw.picture);
      const pictureData = object(picture.data);
      return { id: raw.id, name: raw.name, pictureUrl: typeof pictureData.url === 'string' ? pictureData.url : null };
    },
    async discoverPages(token) {
      const raw = await pages<JsonObject>(collectionUrl('me/accounts', token, 'id,name,category,access_token'), token);
      return raw.map(toPage).filter((p): p is FacebookPage => p !== null);
    },
    async discoverAdAccounts(token) {
      const raw = await pages<JsonObject>(collectionUrl('me/adaccounts', token, 'id,name,currency,account_status'), token);
      return raw.filter(x => typeof x.id === 'string').map(x => ({ id: x.id as string, name: typeof x.name === 'string' ? x.name : x.id as string,
        currency: typeof x.currency === 'string' ? x.currency : null, status: typeof x.account_status === 'number' ? x.account_status : null }));
    },
    async publish(input) {
      const media = input.media ?? []; const images = media.filter(m => m.kind === 'image'); const videos = media.filter(m => m.kind === 'video');
      if (videos.length > 1 || (videos.length && images.length)) throw new FacebookApiError('A Facebook post can contain one video or images, not both.', 0);
      if (!input.text?.trim() && !input.link && media.length === 0) throw new FacebookApiError('A Facebook post needs text, a link, or media.', 0);
      let payload: JsonObject;
      if (videos.length) {
        payload = await request(`${encodeURIComponent(input.targetId)}/videos`, { method: 'POST', token: input.accessToken,
          body: { file_url: videos[0].url, description: input.text?.trim() || undefined } });
      } else if (images.length === 1) {
        payload = await request(`${encodeURIComponent(input.targetId)}/photos`, { method: 'POST', token: input.accessToken,
          body: { url: images[0].url, caption: input.text?.trim() || undefined, alt_text_custom: images[0].altText } });
      } else if (images.length > 1) {
        const attached: string[] = [];
        for (const image of images) {
          const photo = object(await request(`${encodeURIComponent(input.targetId)}/photos`, { method: 'POST', token: input.accessToken,
            body: { url: image.url, published: 'false', temporary: 'true', alt_text_custom: image.altText } }));
          if (typeof photo.id !== 'string') throw new FacebookApiError('Facebook did not return a photo id.', 200);
          attached.push(JSON.stringify({ media_fbid: photo.id }));
        }
        const body: Record<string, string | undefined> = { message: input.text?.trim() || undefined, link: input.link || undefined };
        attached.forEach((value, i) => { body[`attached_media[${i}]`] = value; });
        payload = await request(`${encodeURIComponent(input.targetId)}/feed`, { method: 'POST', token: input.accessToken, body });
      } else {
        payload = await request(`${encodeURIComponent(input.targetId)}/feed`, { method: 'POST', token: input.accessToken,
          body: { message: input.text?.trim() || undefined, link: input.link || undefined } });
      }
      const id = payload.id;
      if (typeof id !== 'string' || !id) throw new FacebookApiError('Facebook did not return a post id.', 200);
      if (input.firstComment?.trim()) await request(`${encodeURIComponent(id)}/comments`, { method: 'POST', token: input.accessToken, body: { message: input.firstComment.trim() } });
      return { remoteId: id, url: null };
    },
    async getStatus(token, remoteId) {
      const raw = object(await request(encodeURIComponent(remoteId), { token, params: { fields: 'is_published,created_time' } }));
      const publishedAt = date(raw.created_time);
      return { state: raw.is_published === true ? 'published' : raw.is_published === false ? 'scheduled' : 'unknown', publishedAt };
    },
    async deletePost(token, remoteId) {
      const result = object(await request(encodeURIComponent(remoteId), { method: 'DELETE', token }));
      if (result.success !== true) throw new FacebookApiError('Facebook did not confirm post deletion.', 200);
    },
    async replyToConversation(token, conversationId, text) {
      const result = object(await request(`${encodeURIComponent(conversationId)}/messages`, { method: 'POST', token, body: { message: text } }));
      if (typeof result.id !== 'string') throw new FacebookApiError('Facebook did not return a reply id.', 200);
      return result.id;
    },
    async replyToComment(token, commentId, text) {
      const result = object(await request(`${encodeURIComponent(commentId)}/comments`, { method: 'POST', token, body: { message: text } }));
      if (typeof result.id !== 'string') throw new FacebookApiError('Facebook did not return a reply id.', 200);
      return result.id;
    },
    async moderateComment(token, commentId, hidden) {
      await request(encodeURIComponent(commentId), { method: 'POST', token, body: { is_hidden: String(hidden) } });
    },
    async deleteComment(token, commentId) { await request(encodeURIComponent(commentId), { method: 'DELETE', token }); },
    async listInbox(token, pageId) {
      const raw = await pages<JsonObject>(collectionUrl(`${encodeURIComponent(pageId)}/conversations`, token, 'id,snippet,updated_time,unread_count,message_count,messages.limit(20){id,message,created_time,from{id,name}}'), token);
      return raw.flatMap(c => {
        if (typeof c.id !== 'string') return [];
        const data = object(c.messages).data;
        const messages = Array.isArray(data) ? data.flatMap(m => { const x = object(m); const createdAt = date(x.created_time); const from = object(x.from); return typeof x.id === 'string' && createdAt ? [{ id: x.id, text: typeof x.message === 'string' ? x.message : null, createdAt, fromName: typeof from.name === 'string' ? from.name : null, fromId: typeof from.id === 'string' ? from.id : null }] : []; }) : [];
        return [{ id: c.id, snippet: typeof c.snippet === 'string' ? c.snippet : null, updatedAt: date(c.updated_time) ?? new Date(0),
          unreadCount: typeof c.unread_count === 'number' ? c.unread_count : 0, messageCount: typeof c.message_count === 'number' ? c.message_count : messages.length, messages }];
      });
    },
    async listComments(token, postId) {
      const raw = await pages<JsonObject>(collectionUrl(`${encodeURIComponent(postId)}/comments`, token, 'id,message,from{id,name},created_time,parent{id},like_count,comment_count,is_hidden'), token);
      return raw.flatMap(item => {
        const from = object(item.from); const parent = object(item.parent); const createdAt = date(item.created_time);
        if (typeof item.id !== 'string' || typeof item.message !== 'string' || !createdAt) return [];
        return [{ id: item.id, message: item.message, fromName: typeof from.name === 'string' ? from.name : null, fromId: typeof from.id === 'string' ? from.id : null,
          createdAt, parentId: typeof parent.id === 'string' ? parent.id : null, likeCount: typeof item.like_count === 'number' ? item.like_count : 0,
          replyCount: typeof item.comment_count === 'number' ? item.comment_count : 0, isHidden: item.is_hidden === true }];
      });
    },
    async getPageAnalytics(token, pageId, since, until) {
      if (!config.pageInsightMetrics.length) return {};
      const raw = object(await request(`${encodeURIComponent(pageId)}/insights`, { token, params: { metric: config.pageInsightMetrics.join(','),
        since: since ? Math.floor(since.getTime() / 1000) : undefined, until: until ? Math.floor(until.getTime() / 1000) : undefined } }));
      const data = Array.isArray(raw.data) ? raw.data : []; const metrics: Record<string, number | null> = {};
      for (const item of data) { const x = object(item); if (typeof x.name !== 'string') continue; const values = Array.isArray(x.values) ? x.values : []; const value = object(values[values.length - 1]).value;
        metrics[x.name] = typeof value === 'number' ? value : typeof value === 'string' && Number.isFinite(Number(value)) ? Number(value) : null; }
      return metrics;
    },
    async getAdInsights(token, accountId, since, until) {
      const params = new URLSearchParams({ access_token: token, fields: config.adInsightFields.join(','), level: 'account', time_increment: '1',
        time_range: JSON.stringify({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }), limit: String(config.pageSize) });
      const raw = await pages<JsonObject>(`${graphObjectUrl(config, `${encodeURIComponent(accountId)}/insights`)}?${params}`, token);
      return raw;
    },
    async updateAd(input) {
      if (!input.status && input.dailyBudgetMinor === undefined && input.lifetimeBudgetMinor === undefined) throw new FacebookApiError('An ad update needs a status or budget change.', 0);
      if (input.dailyBudgetMinor !== undefined && input.lifetimeBudgetMinor !== undefined) throw new FacebookApiError('Choose daily or lifetime budget for one update.', 0);
      for (const budget of [input.dailyBudgetMinor, input.lifetimeBudgetMinor]) if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 1)) throw new FacebookApiError('Ad budgets must be positive whole minor currency units.', 0);
      const body: Record<string, string> = {};
      if (input.status) body.status = input.status.toUpperCase();
      if (input.dailyBudgetMinor !== undefined) body.daily_budget = String(input.dailyBudgetMinor);
      if (input.lifetimeBudgetMinor !== undefined) body.lifetime_budget = String(input.lifetimeBudgetMinor);
      await request(encodeURIComponent(input.objectId), { method: 'POST', token: input.credential.accessToken, body });
    },
  };
}

/** Backward-compatible thin publisher used by the current neutral contract. */
export function createFacebookPublisher(config: FacebookConfig, fetchImpl: FacebookFetch = fetch) {
  const engine = createFacebookEngine(config, fetchImpl);
  return async (request: PublishRequest): Promise<PublishResult> => {
    if (request.target.kind !== 'page') throw new FacebookApiError('Facebook publishing currently supports Page targets only.', 0);
    const result = await engine.publish({ targetId: request.target.id, accessToken: request.credential.accessToken, text: request.text, link: request.link, media: request.media, firstComment: request.firstComment });
    return result;
  };
}

export function createFacebookAdapter(config: FacebookConfig, fetchImpl: FacebookFetch = fetch): PlatformAdapter {
  const engine = createFacebookEngine(config, fetchImpl);
  return {
    id: 'facebook',
    capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'supported', analytics: 'supported', ads: 'supported' },
    supportsTargetKind: (kind, capability) => kind === 'page' && ['publishing', 'inbox', 'analytics'].includes(capability),
    getAuthorizationUrl: input => engine.getAuthorizationUrl(input),
    async exchangeCode(input) { return engine.exchangeCode(input); },
    async discover(request) {
      const [pages, accounts] = await Promise.all([engine.discoverPages(request.credential.accessToken), engine.discoverAdAccounts(request.credential.accessToken)]);
      return { targets: pages.map(p => ({ id: p.id, name: p.name, kind: 'page' })), adAccounts: accounts.map(a => ({ id: a.id, name: a.name, currency: a.currency, status: a.status === null ? null : String(a.status) })) };
    },
    publish: createFacebookPublisher(config, fetchImpl),
    async getRemoteStatus(request) { return engine.getStatus(request.credential.accessToken, request.remoteId); },
    async deleteRemote(request) { await engine.deletePost(request.credential.accessToken, request.remoteId); },
    async listInbox(request) {
      const conversations = await engine.listInbox(request.credential.accessToken, request.targetId);
      return conversations.map(c => ({ id: c.id, text: c.snippet ?? '', createdAt: c.updatedAt, targetId: request.targetId, kind: 'message' as const }));
    },
    async replyToInbox(request) {
      if (!request.text?.trim()) throw new FacebookApiError('A reply needs text.', 0);
      const remoteId = await engine.replyToConversation(request.credential.accessToken, request.remoteId, request.text.trim());
      return { remoteId };
    },
    async hideInboxItem(request) { await engine.moderateComment(request.credential.accessToken, request.remoteId, request.hidden); },
    async deleteInboxItem(request) { await engine.deleteComment(request.credential.accessToken, request.remoteId); },
    async getAnalytics(request) { return { metrics: await engine.getPageAnalytics(request.credential.accessToken, request.targetId, request.since, request.until) }; },
    async listAds(request) {
      if (!request.since || !request.until) throw new FacebookApiError('Facebook Ads Insights requires an explicit start and end date.', 0);
      return { items: await engine.getAdInsights(request.credential.accessToken, request.accountId, request.since, request.until) };
    },
    async updateAd(request) { await engine.updateAd(request); },
  };
}
