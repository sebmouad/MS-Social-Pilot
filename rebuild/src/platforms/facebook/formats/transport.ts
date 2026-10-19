import type { FacebookConfig } from '../config';
import { validateFacebookConfig } from '../config';
import { FacebookApiError } from '../publishing';
import { facebookAppSecretProof, graphObjectUrl } from '../protocol';
import type { FacebookNativeMedia, FacebookNativeReadTransport } from './types';

export interface FacebookNativeTransportPolicy {
  /** Exact HTTPS origins approved for Meta's resumable upload service. */
  uploadOrigins: readonly string[];
  maxUploadBytes: number;
  maxResponseBytes: number;
}

const SAFE_ERROR = 'Facebook request failed.';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function validatePolicy(policy: FacebookNativeTransportPolicy): void {
  if (!Number.isSafeInteger(policy.maxUploadBytes) || policy.maxUploadBytes < 1 ||
      !Number.isSafeInteger(policy.maxResponseBytes) || policy.maxResponseBytes < 1) throw new Error('Facebook native transport limits are invalid.');
  if (!Array.isArray(policy.uploadOrigins) || policy.uploadOrigins.length === 0) throw new Error('Facebook upload origins are required.');
  for (const raw of policy.uploadOrigins) {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('Facebook upload origin is invalid.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || raw !== url.origin && raw !== `${url.origin}/`) {
      throw new Error('Facebook upload origin must be an exact HTTPS origin.');
    }
  }
}

/** Accept only relative Graph object/edge paths. This prevents URL resolution from
 * escaping the configured graph version and prevents caller-supplied credentials. */
function safeGraphPath(path: string): string {
  if (typeof path !== 'string' || path.length < 1 || path.length > 2048 || path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('\\') || /[%\u0000-\u0020\u007f]/.test(path)) throw new FacebookApiError(SAFE_ERROR, 0);
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9_.:-]+$/.test(segment))) throw new FacebookApiError(SAFE_ERROR, 0);
  return path;
}

async function boundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new FacebookApiError(SAFE_ERROR, response.status);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new FacebookApiError(SAFE_ERROR, 0));
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await Promise.race([reader.read(), aborted]); }
      finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
      const { done, value } = next;
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new FacebookApiError(SAFE_ERROR, response.status);
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof FacebookApiError) throw error;
    throw new FacebookApiError(SAFE_ERROR, response.status);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FacebookApiError(SAFE_ERROR, response.status); }
}

/** Facebook-owned signed Graph and resumable-upload transport. Meta's Reels
 * collection documents /video-upload/{api_version}/{video_id}, OAuth auth,
 * file_url for hosted media, and offset/file_size for binary uploads:
 * https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api */
export function createFacebookNativeTransport(configInput: FacebookConfig, accessToken: string,
  transportPolicy: FacebookNativeTransportPolicy, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): FacebookNativeReadTransport {
  const config = validateFacebookConfig({ ...configInput, pageInsightMetrics: [...configInput.pageInsightMetrics], adInsightFields: [...configInput.adInsightFields], allowedImageMimeTypes: [...configInput.allowedImageMimeTypes] });
  const graphBase = new URL(config.graphBaseUrl);
  if (graphBase.search || graphBase.hash) throw new Error('Facebook native Graph endpoint cannot contain a query or fragment.');
  const stablePolicy: FacebookNativeTransportPolicy = { uploadOrigins: [...transportPolicy.uploadOrigins], maxUploadBytes: transportPolicy.maxUploadBytes, maxResponseBytes: transportPolicy.maxResponseBytes };
  validatePolicy(stablePolicy);
  const token = accessToken;
  if (typeof token !== 'string' || !token || /[\s\u0000-\u001f\u007f]/u.test(token)) throw new Error('Facebook access token is invalid.');
  const fetcher = fetchImpl;
  const proof = () => {
    if (!config.appSecretProofEnabled) return undefined;
    if (!config.appSecret) throw new FacebookApiError(SAFE_ERROR, 0);
    return facebookAppSecretProof(token, config.appSecret);
  };
  const request = async (method: 'GET' | 'POST' | 'DELETE', rawPath: string,
    values: Record<string, string> = {}): Promise<Record<string, unknown>> => {
    const path = safeGraphPath(rawPath);
    if (Object.keys(values).some(key => ['access_token', 'appsecret_proof'].includes(key.toLowerCase()))) throw new FacebookApiError(SAFE_ERROR, 0);
    const url = graphObjectUrl(config, path);
    const expectedPathPrefix = graphObjectUrl(config, '').pathname;
    if (url.origin !== new URL(config.graphBaseUrl).origin || !url.pathname.startsWith(expectedPathPrefix)) throw new FacebookApiError(SAFE_ERROR, 0);
    const signedProof = proof();
    const params = new URLSearchParams(values);
    if (method === 'POST') {
      params.set('access_token', token);
      if (signedProof) params.set('appsecret_proof', signedProof);
    } else {
      for (const [key, value] of params) url.searchParams.set(key, value);
      url.searchParams.set('access_token', token);
      if (signedProof) url.searchParams.set('appsecret_proof', signedProof);
    }
    const timeout = AbortSignal.timeout(config.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (requestSignal.aborted) throw new FacebookApiError(SAFE_ERROR, 0);
    let response: Response;
    try {
      response = await fetcher(url, { method, ...(method === 'POST' ? { body: params, headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}), signal: requestSignal, redirect: 'error' });
    } catch { throw new FacebookApiError(SAFE_ERROR, 0); }
    const payload = await boundedJson(response, stablePolicy.maxResponseBytes, requestSignal);
    if (!response.ok || Object.hasOwn(object(payload), 'error')) {
      const error = object(object(payload).error);
      throw new FacebookApiError(SAFE_ERROR, response.status, typeof error.code === 'number' ? error.code : undefined,
        typeof error.error_subcode === 'number' ? error.error_subcode : undefined, error.is_transient === true);
    }
    return object(payload);
  };
  return {
    postGraph: (path, body) => request('POST', path, body),
    getGraph: (path, fields) => {
      if (!Array.isArray(fields) || fields.some(field => !/^[A-Za-z0-9_.,:()]+$/.test(field))) throw new FacebookApiError(SAFE_ERROR, 0);
      return request('GET', path, { fields: fields.join(',') });
    },
    deleteGraph: path => request('DELETE', path),
    upload: async (rawUrl: string, media: FacebookNativeMedia): Promise<void> => {
      if (typeof rawUrl !== 'string' || /[\u0000-\u0020\u007f]/.test(rawUrl)) throw new FacebookApiError(SAFE_ERROR, 0);
      let url: URL;
      try { url = new URL(rawUrl); } catch { throw new FacebookApiError(SAFE_ERROR, 0); }
      const origins = new Set(stablePolicy.uploadOrigins.map(origin => new URL(origin).origin));
      if (url.href !== rawUrl || url.protocol !== 'https:' || !origins.has(url.origin) || url.username || url.password || url.search || url.hash || !/^\/video-upload\/v\d+\.\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new FacebookApiError(SAFE_ERROR, 0);
      const isBytes = media.bytes instanceof Uint8Array;
      if (isBytes && media.url !== undefined) throw new FacebookApiError(SAFE_ERROR, 0);
      if (isBytes && (media.bytes!.byteLength < 1 || media.bytes!.byteLength > stablePolicy.maxUploadBytes ||
          !Number.isSafeInteger(media.sizeBytes) || media.sizeBytes !== media.bytes!.byteLength)) throw new FacebookApiError(SAFE_ERROR, 0);
      if (!isBytes && (typeof media.url !== 'string' || /[\u0000-\u0020\u007f]/.test(media.url) || (() => {
        try { const remote = new URL(media.url); return remote.href !== media.url || remote.protocol !== 'https:' || !!remote.username || !!remote.password || !!remote.hash; }
        catch { return true; }
      })() || !Number.isSafeInteger(media.sizeBytes) || media.sizeBytes! < 1 || media.sizeBytes! > stablePolicy.maxUploadBytes)) throw new FacebookApiError(SAFE_ERROR, 0);
      const headers: Record<string, string> = { Authorization: `OAuth ${token}` };
      let body: BodyInit | undefined;
      if (isBytes) {
        headers.offset = '0';
        headers.file_size = String(media.bytes!.byteLength);
        headers['content-type'] = 'application/octet-stream';
        // Snapshot mutable caller storage after the size check and before dispatch.
        body = new Uint8Array(media.bytes!);
      } else {
        headers.file_url = media.url!;
      }
      const timeout = AbortSignal.timeout(config.requestTimeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      if (requestSignal.aborted) throw new FacebookApiError(SAFE_ERROR, 0);
      let response: Response;
      try { response = await fetcher(url, { method: 'POST', headers, ...(body ? { body } : {}), signal: requestSignal, redirect: 'error' }); }
      catch { throw new FacebookApiError(SAFE_ERROR, 0); }
      const payload = await boundedJson(response, stablePolicy.maxResponseBytes, requestSignal);
      if (!response.ok || object(payload).success !== true || Object.hasOwn(object(payload), 'error')) {
        const error = object(object(payload).error);
        throw new FacebookApiError(SAFE_ERROR, response.status, typeof error.code === 'number' ? error.code : undefined,
          typeof error.error_subcode === 'number' ? error.error_subcode : undefined, error.is_transient === true);
      }
    },
  };
}
