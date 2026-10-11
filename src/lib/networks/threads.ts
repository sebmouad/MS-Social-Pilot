import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { netJson, type NetworkConnector, type NetworkContext } from './types';

/**
 * Threads, through Meta's Threads API.
 *
 * A post is made in two steps, as on Instagram: a container, then a publish
 * of it. Long-lived tokens last sixty days and are refreshed here on the way
 * to publishing once they are more than a day old, so a Threads profile that
 * posts at least every two months never has to reconnect.
 */

const GRAPH = 'https://graph.threads.net/v1.0';
export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'];

export async function threadsToken(options: { clientId: string; clientSecret: string; code: string; redirectUri: string }) {
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: options.redirectUri,
    code: options.code,
  });
  const short = await netJson<{ access_token: string; user_id: string | number }>('Threads', 'https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const long = await netJson<{ access_token: string; expires_in: number }>(
    'Threads',
    `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(options.clientSecret)}&access_token=${encodeURIComponent(short.data.access_token)}`,
  );
  return { accessToken: long.data.access_token, expiresIn: long.data.expires_in, userId: String(short.data.user_id) };
}

export async function threadsProfile(token: string) {
  const { data } = await netJson<{ id: string; username: string; name?: string; threads_profile_picture_url?: string }>(
    'Threads',
    `${GRAPH}/me?fields=id,username,name,threads_profile_picture_url&access_token=${encodeURIComponent(token)}`,
  );
  return data;
}

async function freshToken(context: NetworkContext): Promise<string> {
  const { credentials } = context;
  const refreshedAt = Number((credentials.meta as { refreshedAt?: number }).refreshedAt ?? 0);
  if (Date.now() - refreshedAt < 24 * 60 * 60 * 1000) return credentials.accessToken;
  try {
    const { data } = await netJson<{ access_token: string; expires_in: number }>(
      'Threads',
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(credentials.accessToken)}`,
    );
    await context.saveCredentials({
      ...credentials,
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      meta: { ...credentials.meta, refreshedAt: Date.now() },
    });
    return data.access_token;
  } catch {
    // The old token still works until it expires; try with it.
    return credentials.accessToken;
  }
}

async function waitUntilReady(id: string, token: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { data } = await netJson<{ status?: string; error_message?: string }>(
      'Threads',
      `${GRAPH}/${id}?fields=status,error_message&access_token=${encodeURIComponent(token)}`,
    );
    if (data.status === 'FINISHED' || data.status === 'PUBLISHED') return;
    if (data.status === 'ERROR' || data.status === 'EXPIRED') {
      throw new GraphError({ message: `Threads: ${data.error_message ?? 'the media could not be processed'}`, kind: 'rejected' });
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new GraphError({ message: 'Threads: the video is still processing. It will be tried again.', kind: 'transient' });
}

async function container(user: string, token: string, params: Record<string, string>) {
  const { data } = await netJson<{ id: string }>('Threads', `${GRAPH}/${user}/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  return data.id;
}

export const threads: NetworkConnector = {
  key: 'threads',
  label: 'Threads',
  rules: NETWORK_RULES.threads,
  async publish(target, post, context) {
    const token = await freshToken(context);
    const user = target.providerId;
    const media = post.media.slice(0, 20);
    let creation: string;
    if (media.length > 1) {
      const children = [];
      for (const item of media) {
        children.push(
          await container(user, token, {
            is_carousel_item: 'true',
            media_type: item.kind === 'video' ? 'VIDEO' : 'IMAGE',
            [item.kind === 'video' ? 'video_url' : 'image_url']: item.url,
          }),
        );
      }
      for (const child of children) await waitUntilReady(child, token);
      creation = await container(user, token, { media_type: 'CAROUSEL', children: children.join(','), text: post.text });
    } else if (media.length === 1) {
      const item = media[0]!;
      creation = await container(user, token, {
        media_type: item.kind === 'video' ? 'VIDEO' : 'IMAGE',
        [item.kind === 'video' ? 'video_url' : 'image_url']: item.url,
        text: post.text,
      });
    } else {
      creation = await container(user, token, {
        media_type: 'TEXT',
        text: post.text,
        ...(post.link ? { link_attachment: post.link } : {}),
      });
    }
    await waitUntilReady(creation, token);
    const { data } = await netJson<{ id: string }>('Threads', `${GRAPH}/${user}/threads_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: creation, access_token: token }),
    });
    const link = await netJson<{ permalink?: string }>('Threads', `${GRAPH}/${data.id}?fields=permalink&access_token=${encodeURIComponent(token)}`).catch(() => null);
    return { remotePostId: data.id, remoteUrl: link?.data.permalink ?? `https://www.threads.net/@${target.name}` };
  },
};
