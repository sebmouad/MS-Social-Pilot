import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { env } from '../env';
import { failureFor, netJson, textWithLink, type NetworkConnector, type NetworkContext } from './types';

/**
 * YouTube: each channel the Google account manages is a destination, and a
 * post is one video. The first line of the text becomes the title, the whole
 * text the description. Google access tokens last an hour and are refreshed
 * on the way to publishing.
 */

export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';

interface Token {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function youtubeToken(options: { code: string; redirectUri: string }): Promise<Token> {
  const { data } = await netJson<Token>('YouTube', TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: env.youtubeClientId,
      client_secret: env.youtubeClientSecret,
    }),
  });
  return data;
}

export async function youtubeChannels(token: string) {
  const { data } = await netJson<{ items?: Array<{ id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }> }>(
    'YouTube',
    `${API}/channels?part=snippet&mine=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return data.items ?? [];
}

async function freshToken(context: NetworkContext): Promise<string> {
  const { credentials } = context;
  if (credentials.expiresAt && credentials.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return credentials.accessToken;
  if (!credentials.refreshToken) return credentials.accessToken;
  const { data } = await netJson<Token>('YouTube', TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: env.youtubeClientId,
      client_secret: env.youtubeClientSecret,
    }),
  });
  // Google keeps the same refresh token unless it sends a new one.
  await context.saveCredentials({
    ...credentials,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? credentials.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });
  return data.access_token;
}

/** Title from the first line (YouTube allows 100 characters and no angle brackets). */
export function youtubeTitle(text: string): string {
  const first = text.split('\n').find((line) => line.trim())?.trim() ?? '';
  return (first.replace(/[<>]/g, '').slice(0, 100) || 'Video').trim();
}

export const youtube: NetworkConnector = {
  key: 'youtube',
  label: 'YouTube',
  rules: NETWORK_RULES.youtube,
  async publish(target, post, context) {
    const video = post.media.find((item) => item.kind === 'video');
    if (!video) throw new GraphError({ message: 'YouTube: a post needs a video.', kind: 'rejected' });
    const token = await freshToken(context);
    const description = textWithLink(post).replace(/[<>]/g, '').slice(0, 5000);
    const bytes = await video.read();

    let start: Response;
    try {
      start = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-length': String(bytes.length),
          'x-upload-content-type': video.mimeType ?? 'video/mp4',
        },
        body: JSON.stringify({
          snippet: { title: youtubeTitle(post.text), description, channelId: target.providerId },
          status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new GraphError({ message: `YouTube: ${error instanceof Error ? error.message : 'network error'}`, kind: 'transient' });
    }
    const location = start.headers.get('location');
    if (!start.ok || !location) throw failureFor(start.status, (await start.text()).slice(0, 300) || 'upload refused', 'YouTube');

    const { data } = await netJson<{ id: string }>('YouTube', location, {
      method: 'PUT',
      headers: { 'content-type': video.mimeType ?? 'video/mp4' },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    return { remotePostId: data.id, remoteUrl: `https://www.youtube.com/watch?v=${data.id}` };
  },
};
