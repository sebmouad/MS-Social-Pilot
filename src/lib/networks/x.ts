import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { env } from '../env';
import { failureFor, netJson, textWithLink, type NetworkConnector, type NetworkContext } from './types';

/**
 * X, through its v2 API with OAuth 2.0 (PKCE).
 *
 * Access tokens last two hours and refresh tokens are single-use: each
 * refresh hands back a new pair, which is stored before the post goes out so
 * a failure afterwards cannot leave the account holding a spent token.
 */

export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
const API = 'https://api.x.com/2';

function basic(): string {
  return `Basic ${Buffer.from(`${env.xClientId}:${env.xClientSecret}`).toString('base64')}`;
}

export async function xToken(options: { code: string; redirectUri: string; verifier: string }) {
  const { data } = await netJson<{ access_token: string; refresh_token?: string; expires_in: number }>('X', `${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic() },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.verifier,
    }),
  });
  return data;
}

export async function xMe(token: string) {
  const { data } = await netJson<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(
    'X',
    `${API}/users/me?user.fields=profile_image_url`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return data.data;
}

async function freshToken(context: NetworkContext): Promise<string> {
  const { credentials } = context;
  if (credentials.expiresAt && credentials.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return credentials.accessToken;
  if (!credentials.refreshToken) throw new GraphError({ message: 'X: reconnect the account.', kind: 'auth' });
  const { data } = await netJson<{ access_token: string; refresh_token?: string; expires_in: number }>('X', `${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken }),
  });
  await context.saveCredentials({
    ...credentials,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? credentials.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });
  return data.access_token;
}

export const x: NetworkConnector = {
  key: 'x',
  label: 'X',
  rules: NETWORK_RULES.x,
  async remove(remotePostId, context) {
    const token = await freshToken(context);
    const { data } = await netJson<{ data?: { deleted?: boolean } }>('X', `${API}/tweets/${encodeURIComponent(remotePostId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (data.data?.deleted !== true) throw new GraphError({ message: 'X did not confirm deletion. The post record was kept.', kind: 'rejected' });
  },
  async publish(target, post, context) {
    const token = await freshToken(context);
    const mediaIds: string[] = [];
    for (const image of post.media.filter((item) => item.kind === 'image').slice(0, 4)) {
      const form = new FormData();
      form.append('media', new Blob([new Uint8Array(await image.read())], { type: image.mimeType ?? 'image/jpeg' }), 'image');
      form.append('media_category', 'tweet_image');
      const { data } = await netJson<{ data: { id: string } }>('X', `${API}/media/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      mediaIds.push(data.data.id);
    }
    const { data } = await netJson<{ data: { id: string } }>('X', `${API}/tweets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: textWithLink(post), ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
    });
    return { remotePostId: data.data.id, remoteUrl: `https://x.com/${target.name.replace(/^@/, '')}/status/${data.data.id}` };
  },
  async stats(remotePostId, context) {
    const token = await freshToken(context);
    const { data } = await netJson<{ data?: { public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number; impression_count?: number } } }>(
      'X',
      `${API}/tweets/${encodeURIComponent(remotePostId)}?tweet.fields=public_metrics`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const metrics = data.data?.public_metrics;
    if (!metrics) throw failureFor(404, 'the post is gone', 'X');
    return {
      likes: metrics.like_count ?? 0,
      reposts: metrics.retweet_count ?? 0,
      replies: metrics.reply_count ?? 0,
      quotes: metrics.quote_count ?? 0,
      views: metrics.impression_count ?? null,
    };
  },
};
