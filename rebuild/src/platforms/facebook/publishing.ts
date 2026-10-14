import type { FacebookConfig } from './config';
import { FACEBOOK_PROTOCOL, graphObjectUrl } from './protocol';
import type { PlatformAdapter, PublishRequest, PublishResult } from '../types';

export type FacebookFetch = typeof fetch;

export class FacebookApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FacebookApiError';
  }
}

/** Publish a text/link Page feed item. Media and scheduling are outside this slice. */
export function createFacebookPublisher(config: FacebookConfig, fetchImpl: FacebookFetch = fetch) {
  return async function publish(request: PublishRequest): Promise<PublishResult> {
    if (request.target.kind !== 'page') throw new Error('Facebook publishing currently supports Page targets only.');
    if (!request.text.trim() && !request.link) throw new Error('A post needs text or a link.');

    const url = graphObjectUrl(config, `${encodeURIComponent(request.target.id)}/${FACEBOOK_PROTOCOL.pageFeedEdge}`);
    const body = new URLSearchParams({
      [FACEBOOK_PROTOCOL.accessTokenField]: request.credential.accessToken,
    });
    if (request.text.trim()) body.set(FACEBOOK_PROTOCOL.messageField, request.text.trim());
    if (request.link) body.set(FACEBOOK_PROTOCOL.linkField, request.link);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      throw new FacebookApiError(error instanceof Error ? error.message : 'Facebook request failed.', 0);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const graphError = payload && typeof payload === 'object' ? (payload as { error?: { message?: string } }).error : undefined;
      throw new FacebookApiError(graphError?.message ?? `Facebook answered ${response.status}.`, response.status);
    }
    const id = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[FACEBOOK_PROTOCOL.responseIdField] : null;
    if (typeof id !== 'string' || !id) throw new FacebookApiError('Facebook did not return a post id.', response.status);
    return { remoteId: id, url: null };
  };
}

export function createFacebookAdapter(config: FacebookConfig, fetchImpl: FacebookFetch = fetch): PlatformAdapter {
  const publish = createFacebookPublisher(config, fetchImpl);
  return {
    id: 'facebook',
    capabilities: {
      connection: 'unsupported',
      discovery: 'unsupported',
      publishing: 'supported',
      remoteStatus: 'unsupported',
      remoteDelete: 'unsupported',
      inbox: 'unsupported',
      analytics: 'unsupported',
      ads: 'unsupported',
    },
    publish,
  };
}
