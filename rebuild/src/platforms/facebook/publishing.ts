import type { FacebookConfig } from './config';
import { validateFacebookConfig } from './config';
import { graphObjectUrl } from './protocol';
import type { AdCampaignCreateRequest, AdMutationRequest, AdObjectReadRequest, AdObjectSnapshot, OAuthExchangeRequest, OAuthStartRequest, PlatformAdapter, PublishRequest, PublishResult } from '../types';

export type FacebookFetch = typeof fetch;

export class FacebookApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number, readonly subcode?: number) {
    super(message);
    this.name = 'FacebookApiError';
  }
}

export interface FacebookPage { id: string; name: string; category: string | null; accessToken: string }
export interface FacebookCurrentUser { id: string; name: string; pictureUrl: string | null }
export interface FacebookGrantedPermission { permission: string; status: 'granted' | 'declined' | string }
export interface FacebookTokenExchangeInput { accessToken: string; appId: string; appSecret: string }
export interface FacebookLongLivedToken { accessToken: string; expiresAt: Date }
export interface FacebookAdAccount { id: string; name: string; currency: string | null; status: number | null }
export type FacebookMedia = { kind: 'image' | 'video'; url: string; altText?: string; localFile?: { bytes: Uint8Array; mimeType: string; fileName: string } };
export interface FacebookPublishInput {
  targetId: string; accessToken: string; text?: string; link?: string | null;
  media?: readonly FacebookMedia[]; firstComment?: string | null;
}
export interface FacebookPublished { remoteId: string; url: string | null }
export interface FacebookPageInsightObservation { metric: string; period: string; endTime: Date; value: unknown; numeric: number | null }
export type FacebookPageInsightObservations = FacebookPageInsightObservation[] & { failedMetrics?: Array<{ metric: string; message: string }> };
export interface FacebookInboxMessage { id: string; text: string | null; createdAt: Date; fromName: string | null; fromId: string | null }
export interface FacebookConversation { id: string; snippet: string | null; updatedAt: Date; unreadCount: number; messageCount: number; messages: FacebookInboxMessage[] }
export interface FacebookComment { id: string; message: string; fromName: string | null; fromId: string | null; createdAt: Date; parentId: string | null; likeCount: number; replyCount: number; isHidden: boolean }
export interface FacebookEngine {
  getAuthorizationUrl(input: OAuthStartRequest): string;
  exchangeCode(input: OAuthExchangeRequest): Promise<{ accessToken: string; expiresAt: Date | null }>;
  exchangeForLongLivedToken(input: FacebookTokenExchangeInput): Promise<FacebookLongLivedToken>;
  getCurrentUser(accessToken: string): Promise<FacebookCurrentUser>;
  getGrantedPermissions(accessToken: string): Promise<string[]>;
  discoverPages(accessToken: string): Promise<FacebookPage[]>;
  discoverAdAccounts(accessToken: string): Promise<FacebookAdAccount[]>;
  publish(input: FacebookPublishInput): Promise<FacebookPublished>;
  getStatus(accessToken: string, remoteId: string): Promise<{ state: 'published' | 'scheduled' | 'unknown'; publishedAt: Date | null }>;
  deletePost(accessToken: string, remoteId: string): Promise<void>;
  listInbox(accessToken: string, pageId: string): Promise<FacebookConversation[]>;
  listComments(accessToken: string, postId: string): Promise<FacebookComment[]>;
  getPageAnalytics(accessToken: string, pageId: string, since?: Date, until?: Date): Promise<Record<string, number | null>>;
  getPageInsightObservations(accessToken: string, pageId: string, since?: Date, until?: Date): Promise<FacebookPageInsightObservations>;
  getAdInsights(accessToken: string, accountId: string, since: Date, until: Date): Promise<Array<Record<string, unknown>>>;
  readAdObject(input: AdObjectReadRequest): Promise<AdObjectSnapshot>;
  updateAd(input: AdMutationRequest): Promise<void>;
  createCampaign(input: AdCampaignCreateRequest): Promise<{ remoteId: string }>;
  replyToConversation(accessToken: string, conversationId: string, text: string): Promise<string>;
  replyToComment(accessToken: string, commentId: string, text: string): Promise<string>;
  moderateComment(accessToken: string, commentId: string, hidden: boolean): Promise<void>;
  deleteComment(accessToken: string, commentId: string): Promise<void>;
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function date(value: unknown): Date | null { if (typeof value !== 'string') return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
const AD_OBJECT_FIELDS = 'id,name,account_id,configured_status,effective_status';
function normalizeAdAccountId(value: string): string { return value.replace(/^act_/, ''); }
function graphError(payload: unknown, status: number): FacebookApiError {
  const err = object(object(payload).error);
  return new FacebookApiError(typeof err.message === 'string' ? err.message : `Facebook answered ${status}.`, status,
    typeof err.code === 'number' ? err.code : undefined, typeof err.error_subcode === 'number' ? err.error_subcode : undefined);
}

/** Create a bounded Graph client. Tokens are sent in form/query parameters and never logged. */
export function createFacebookEngine(rawConfig: FacebookConfig, fetchImpl: FacebookFetch = fetch): FacebookEngine {
  const config = validateFacebookConfig(rawConfig);
  async function request<T = unknown>(path: string, options: { method?: string; token: string; params?: Record<string, string | number | undefined>; body?: Record<string, string | undefined>; file?: { bytes: Uint8Array; mimeType: string; fileName: string } } ): Promise<T> {
    const url = graphObjectUrl(config, path);
    if (options.method !== 'POST') {
      url.searchParams.set('access_token', options.token);
      for (const [key, value] of Object.entries(options.params ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const form = options.method === 'POST' && options.file ? new FormData() : undefined;
    if (form) {
      form.set('access_token', options.token);
      for (const [key, value] of Object.entries(options.body ?? {})) if (value !== undefined) form.set(key, value);
      const { bytes, mimeType, fileName } = options.file!;
      form.set('source', new Blob([bytes], { type: mimeType }), fileName);
    }
    const body = options.method === 'POST' ? form ?? new URLSearchParams({ access_token: options.token, ...(options.body ?? {}) }) : undefined;
    const headers = body instanceof URLSearchParams ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined;
    let response: Response;
    try {
      response = await fetchImpl(url, { method: options.method ?? 'GET', headers,
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
      const paging = object(object(payload).paging);
      const link = typeof paging.next === 'string' ? paging.next : undefined;
      if (!link) { next = undefined; break; }
      if (seen.has(link)) throw new FacebookApiError('Facebook pagination returned a repeated next URL.', 0);
      const nextUrl = new URL(link);
      const configuredBase = new URL(config.graphBaseUrl);
      if (nextUrl.protocol !== 'https:' || nextUrl.origin !== configuredBase.origin || !nextUrl.pathname.startsWith(`/${config.graphVersion}/`)) {
        throw new FacebookApiError('Facebook returned a pagination URL outside the configured Graph endpoint.', 0);
      }
      seen.add(link); next = link;
      if (page === config.maxPages - 1) throw new FacebookApiError('Facebook pagination exceeded the configured page limit.', 0);
    }
    return results;
  }
  function collectionUrl(path: string, token: string, fields: string): string {
    const url = graphObjectUrl(config, path); url.searchParams.set('access_token', token); url.searchParams.set('fields', fields); url.searchParams.set('limit', String(config.pageSize)); return url.toString();
  }
  async function pageInsightRows(token: string, pageId: string, metricNames: readonly string[], since?: Date, until?: Date): Promise<JsonObject[]> {
    const url = graphObjectUrl(config, `${encodeURIComponent(pageId)}/insights`);
    url.searchParams.set('access_token', token);
    url.searchParams.set('metric', metricNames.join(','));
    url.searchParams.set('limit', String(config.pageSize));
    if (since) url.searchParams.set('since', String(Math.floor(since.getTime() / 1000)));
    if (until) url.searchParams.set('until', String(Math.floor(until.getTime() / 1000)));
    return pages<JsonObject>(url.toString(), token);
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
    async getGrantedPermissions(token) {
      const rows = await pages<FacebookGrantedPermission>(collectionUrl('me/permissions', token, 'permission,status'), token);
      return [...new Set(rows.filter(row => typeof row.permission === 'string' && row.status === 'granted').map(row => row.permission))];
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
      for (const image of images) {
        if (!image.localFile) continue;
        const file = image.localFile;
        if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength < 1 || file.bytes.byteLength > config.maxImageUploadBytes) throw new FacebookApiError('Local image exceeds the configured Facebook upload size limit.', 0);
        if (!config.allowedImageMimeTypes.includes(file.mimeType)) throw new FacebookApiError('Local image MIME type is not allowed by Root configuration.', 0);
        const bytes = file.bytes;
        const signatureMatches = file.mimeType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          : file.mimeType === 'image/png' ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
            : file.mimeType === 'image/gif' ? String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a' : false;
        if (!signatureMatches) throw new FacebookApiError('Local image content does not match its allowed MIME type.', 0);
        if (!/^[A-Za-z0-9._-]{1,120}$/.test(file.fileName)) throw new FacebookApiError('Local image filename is invalid.', 0);
      }
      let payload: JsonObject;
      if (videos.length) {
        payload = await request(`${encodeURIComponent(input.targetId)}/videos`, { method: 'POST', token: input.accessToken,
          body: { file_url: videos[0].url, description: input.text?.trim() || undefined } });
      } else if (images.length === 1) {
        payload = await request(`${encodeURIComponent(input.targetId)}/photos`, { method: 'POST', token: input.accessToken,
          body: { url: images[0].localFile ? undefined : images[0].url, caption: input.text?.trim() || undefined, alt_text_custom: images[0].altText }, file: images[0].localFile });
      } else if (images.length > 1) {
        const attached: string[] = [];
        for (const image of images) {
          const photo = object(await request(`${encodeURIComponent(input.targetId)}/photos`, { method: 'POST', token: input.accessToken,
            body: { url: image.localFile ? undefined : image.url, published: 'false', temporary: 'true', alt_text_custom: image.altText }, file: image.localFile }));
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
      const data: JsonObject[] = []; let firstError: unknown;
      for (const metric of config.pageInsightMetrics) {
        try { data.push(...await pageInsightRows(token, pageId, [metric], since, until)); }
        catch (error) { firstError ??= error; }
      }
      if (!data.length && firstError) throw firstError;
      const metrics: Record<string, number | null> = {};
      const latest = new Map<string, number>();
      for (const item of data) {
        const x = object(item); if (typeof x.name !== 'string') continue;
        const values = Array.isArray(x.values) ? x.values : [];
        for (const entry of values) {
          const point = object(entry); const timestamp = date(point.end_time)?.getTime() ?? 0;
          if (latest.has(x.name) && timestamp <= latest.get(x.name)!) continue;
          const value = point.value;
          metrics[x.name] = typeof value === 'number' ? value : typeof value === 'string' && Number.isFinite(Number(value)) ? Number(value) : null;
          latest.set(x.name, timestamp);
        }
      }
      return metrics;
    },
    async getPageInsightObservations(token, pageId, since, until) {
      if (!config.pageInsightMetrics.length) return [];
      const data: JsonObject[] = []; const failedMetrics: Array<{ metric: string; message: string }> = [];
      for (const metric of config.pageInsightMetrics) {
        try { data.push(...await pageInsightRows(token, pageId, [metric], since, until)); }
        catch (error) { failedMetrics.push({ metric, message: error instanceof Error ? error.message : 'Facebook insight request failed.' }); }
      }
      if (!data.length && failedMetrics.length) throw new FacebookApiError(failedMetrics[0].message, 0);
      const observations: FacebookPageInsightObservations = [];
      if (failedMetrics.length) Object.defineProperty(observations, 'failedMetrics', { value: failedMetrics, enumerable: false });
      for (const item of data) {
        const metric = object(item);
        if (typeof metric.name !== 'string' || !metric.name.trim()) continue;
        const period = typeof metric.period === 'string' && metric.period.trim() ? metric.period : 'day';
        const values = Array.isArray(metric.values) ? metric.values : [];
        for (const entry of values) {
          const point = object(entry); const endTime = date(point.end_time);
          if (!endTime || !Object.hasOwn(point, 'value')) continue;
          const value = point.value;
          const numeric = typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
          observations.push({ metric: metric.name, period, endTime, value, numeric });
        }
      }
      return observations;
    },
    async getAdInsights(token, accountId, since, until) {
      const params = new URLSearchParams({ access_token: token, fields: config.adInsightFields.join(','), level: 'account', time_increment: '1',
        time_range: JSON.stringify({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }), limit: String(config.pageSize) });
      const raw = await pages<JsonObject>(`${graphObjectUrl(config, `${encodeURIComponent(accountId)}/insights`)}?${params}`, token);
      return raw;
    },
    async readAdObject(input) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.objectId) || !/^(act_)?[A-Za-z0-9_-]{1,100}$/.test(input.accountId)) {
        throw new FacebookApiError('Invalid Facebook ad object or account id.', 0);
      }
      const raw = object(await request(encodeURIComponent(input.objectId), { token: input.credential.accessToken, params: { fields: AD_OBJECT_FIELDS } }));
      if (typeof raw.id !== 'string' || raw.id !== input.objectId || typeof raw.account_id !== 'string' ||
          normalizeAdAccountId(raw.account_id) !== normalizeAdAccountId(input.accountId)) {
        throw new FacebookApiError('Facebook returned an ad object outside the selected account.', 200);
      }
      return {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : null,
        accountId: raw.account_id,
        configuredStatus: typeof raw.configured_status === 'string' ? raw.configured_status : null,
        effectiveStatus: typeof raw.effective_status === 'string' ? raw.effective_status : null,
      };
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
    async createCampaign(input) {
      const name = input.name.trim();
      if (!name || name.length > 100) throw new FacebookApiError('Campaign name must contain 1 to 100 characters.', 0);
      const objectives = new Set(['OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION']);
      if (!objectives.has(input.objective)) throw new FacebookApiError('Choose a supported campaign objective.', 0);
      const payload = object(await request(`${encodeURIComponent(input.accountId)}/campaigns`, { method: 'POST', token: input.credential.accessToken,
        body: { name, objective: input.objective, status: 'PAUSED', special_ad_categories: '[]' } }));
      if (typeof payload.id !== 'string' || !payload.id) throw new FacebookApiError('Facebook did not return a campaign id.', 200);
      return { remoteId: payload.id };
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
    localImageUpload: { maxBytes: config.maxImageUploadBytes, mimeTypes: config.allowedImageMimeTypes },
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
      return conversations.flatMap(conversation => conversation.messages.map(message => ({
        id: message.id, text: message.text ?? '', createdAt: message.createdAt,
        targetId: request.targetId, conversationId: conversation.id,
        authorId: message.fromId, authorName: message.fromName, kind: 'message' as const,
      })));
    },
    async listComments(request) {
      const comments = await engine.listComments(request.credential.accessToken, request.remotePostId);
      return comments.map(comment => ({
        id: comment.id, text: comment.message, createdAt: comment.createdAt,
        targetId: request.targetId, parentId: comment.parentId,
        authorId: comment.fromId, authorName: comment.fromName, kind: 'comment' as const,
      }));
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
    async readAdObject(request) { return engine.readAdObject(request); },
    async updateAd(request) { await engine.updateAd(request); },
    async createCampaign(request) { return engine.createCampaign(request); },
  };
}
