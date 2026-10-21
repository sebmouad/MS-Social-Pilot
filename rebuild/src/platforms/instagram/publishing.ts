import type { FirstCommentRequest, PlatformCredential, PublishRequest, PublishResult, RemoteStatusRequest, RemoteStatus } from '../types';
import type { InstagramPolicy } from './config';
import { InstagramError, type InstagramGraph } from './transport';
export const hasScopes = (credential: PlatformCredential, required: readonly string[]) => required.length > 0 && required.every(scope => credential.grantedScopes?.includes(scope));
export function requireScopes(graph: InstagramGraph, credential: PlatformCredential, required: readonly string[]) {
  if (!hasScopes(credential, required)) throw new InstagramError(graph.text('permission'), 'rejected');
}
export function createInstagramPublisher(policy: InstagramPolicy, graph: InstagramGraph, wait: (ms: number, signal?: AbortSignal) => Promise<void> = (ms, signal) => new Promise((resolve, reject) => {
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Aborted')); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
})) {
  function invalid(): never { throw new InstagramError(graph.text('invalid'), 'rejected'); }
  async function ready(id: string, request: PublishRequest) {
    for (let attempt = 0; attempt < policy.pollAttempts; attempt++) {
      const status = await graph.request(id, request.credential.accessToken, { fields: 'status_code' }, 'GET', request.signal);
      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new InstagramError(graph.text('processing'), 'rejected');
      // PUBLISHED is not permission to send media_publish again.
      if (status.status_code !== 'IN_PROGRESS') throw new InstagramError(graph.text('uncertain'), 'uncertain');
      if (attempt + 1 < policy.pollAttempts) await wait(policy.pollIntervalMs, request.signal);
    }
    throw new InstagramError(graph.text('uncertain'), 'uncertain');
  }
  async function publish(request: PublishRequest): Promise<PublishResult> {
    requireScopes(graph, request.credential, policy.publishScopes);
    const media = request.media ?? [];
    const format = request.formatId ?? 'image';
    if (request.target.kind !== 'professional' || request.scheduledAt || request.link || [...request.text].length > policy.captionLength || !media.length || media.length > policy.carouselMax) invalid();
    if (!['image', 'reel', 'carousel'].includes(format) || (format === 'image' && (media.length !== 1 || media[0]?.kind !== 'image')) || (format === 'reel' && (media.length !== 1 || media[0]?.kind !== 'video')) || (format === 'carousel' && media.length < 2)) invalid();
    for (const item of media) {
      let url: URL; try { url = new URL(item.url); } catch { invalid(); }
      if (url.protocol !== 'https:' || url.username || url.password || item.localFile || item.altText || !['image', 'video'].includes(item.kind)) invalid();
    }
    async function container(fields: Record<string, string>) {
      const result = await graph.request(`${request.target.id}/media`, request.credential.accessToken, fields, 'POST', request.signal);
      if (typeof result.id !== 'string' || !result.id) throw new InstagramError(graph.text('uncertain'), 'uncertain');
      await ready(result.id, request);
      return result.id;
    }
    let creationId: string;
    if (format === 'carousel') {
      const children: string[] = [];
      for (const item of media) children.push(await container({ ...(item.kind === 'image' ? { image_url: item.url } : { video_url: item.url, media_type: 'VIDEO' }), is_carousel_item: 'true' }));
      creationId = await container({ media_type: 'CAROUSEL', children: children.join(','), caption: request.text });
    } else {
      creationId = await container({ ...(format === 'image' ? { image_url: media[0]!.url } : { video_url: media[0]!.url, media_type: 'REELS' }), caption: request.text });
    }
    const result = await graph.request(`${request.target.id}/media_publish`, request.credential.accessToken, { creation_id: creationId }, 'POST', request.signal);
    if (typeof result.id !== 'string' || !result.id) throw new InstagramError(graph.text('uncertain'), 'uncertain');
    // A confirmed media_publish receipt survives a failed optional permalink read.
    let url: string | null = null;
    try { const post = await graph.request(result.id, request.credential.accessToken, { fields: 'permalink' }, 'GET', request.signal); url = typeof post.permalink === 'string' && post.permalink.startsWith('https://') ? post.permalink : null; } catch { /* confirmed receipt retained */ }
    return { remoteId: result.id, url, state: 'published' };
  }
  async function publishFirstComment(request: FirstCommentRequest) {
    requireScopes(graph, request.credential, policy.commentScopes);
    if (!request.text.trim() || (request.formatId && !['image', 'carousel', 'reel'].includes(request.formatId))) invalid();
    const result = await graph.request(`${request.remotePostId}/comments`, request.credential.accessToken, { message: request.text }, 'POST', request.signal);
    if (typeof result.id !== 'string' || !result.id) throw new InstagramError(graph.text('uncertain'), 'uncertain');
    return { remoteId: result.id };
  }
  async function getRemoteStatus(request: RemoteStatusRequest): Promise<RemoteStatus> {
    requireScopes(graph, request.credential, policy.readScopes);
    const result = await graph.request(request.remoteId, request.credential.accessToken, { fields: 'id,owner,timestamp,media_type' }, 'GET', request.signal);
    const owner = typeof result.owner === 'object' && result.owner ? (result.owner as { id?: unknown }).id : result.owner;
    const publishedAt = typeof result.timestamp === 'string' ? new Date(result.timestamp) : null;
    if (result.id !== request.remoteId || owner !== request.target.id || !publishedAt || !Number.isFinite(publishedAt.getTime()) || !['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'].includes(String(result.media_type))) return { state: 'unknown' };
    return { state: 'published', remoteId: request.remoteId, targetId: request.target.id, publishedAt };
  }
  return { publish, publishFirstComment, getRemoteStatus };
}
