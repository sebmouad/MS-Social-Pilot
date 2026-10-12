import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { env } from '../env';
import { failureFor, netJson, type NetworkConnector, type NetworkContext } from './types';

/**
 * TikTok, through the Content Posting API (direct post). One destination per
 * account; a post is one video, sent as a single-chunk upload, with the text
 * as its caption. Until TikTok audits the app, posts can only be private
 * (SELF_ONLY) — the most open privacy level the creator allows is used.
 * Access tokens last a day and are refreshed on the way to publishing.
 */

export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'];
const API = 'https://open.tiktokapis.com/v2';
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;

interface Token {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
}

async function tokenCall(body: Record<string, string>): Promise<Token> {
  const { data } = await netJson<Token>('TikTok', `${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: env.tiktokClientKey, client_secret: env.tiktokClientSecret, ...body }),
  });
  return data;
}

export function tiktokToken(options: { code: string; redirectUri: string; verifier: string }) {
  return tokenCall({ grant_type: 'authorization_code', code: options.code, redirect_uri: options.redirectUri, code_verifier: options.verifier });
}

export async function tiktokUser(token: string) {
  const { data } = await netJson<{ data: { user: { open_id: string; display_name: string; avatar_url?: string } } }>(
    'TikTok',
    `${API}/user/info/?fields=open_id,display_name,avatar_url`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return data.data.user;
}

async function freshToken(context: NetworkContext): Promise<string> {
  const { credentials } = context;
  if (credentials.expiresAt && credentials.expiresAt.getTime() - Date.now() > 10 * 60 * 1000) return credentials.accessToken;
  if (!credentials.refreshToken) return credentials.accessToken;
  const data = await tokenCall({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken });
  await context.saveCredentials({
    ...credentials,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  });
  return data.access_token;
}

/** The most public privacy level this creator may post with. */
export function pickPrivacy(options: string[]): string {
  for (const level of ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']) {
    if (options.includes(level)) return level;
  }
  return 'SELF_ONLY';
}

export const tiktok: NetworkConnector = {
  key: 'tiktok',
  label: 'TikTok',
  rules: NETWORK_RULES.tiktok,
  async publish(_target, post, context) {
    const video = post.media.find((item) => item.kind === 'video');
    if (!video) throw new GraphError({ message: 'TikTok: a post needs a video.', kind: 'rejected' });
    const token = await freshToken(context);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' };
    const bytes = await video.read();
    if (bytes.length > MAX_SINGLE_CHUNK) throw new GraphError({ message: 'TikTok: videos up to 64 MB are supported.', kind: 'rejected' });

    const creator = await netJson<{ data: { privacy_level_options: string[] } }>('TikTok', `${API}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: auth,
    });
    const init = await netJson<{ data: { publish_id: string; upload_url: string } }>('TikTok', `${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        post_info: { title: post.text.slice(0, 2200), privacy_level: pickPrivacy(creator.data.data.privacy_level_options) },
        source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
      }),
    });

    let upload: Response;
    try {
      upload = await fetch(init.data.data.upload_url, {
        method: 'PUT',
        headers: {
          'content-type': video.mimeType ?? 'video/mp4',
          'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}`,
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(15 * 60_000),
      });
    } catch (error) {
      throw new GraphError({ message: `TikTok: ${error instanceof Error ? error.message : 'network error'}`, kind: 'transient' });
    }
    if (!upload.ok) throw failureFor(upload.status, (await upload.text()).slice(0, 300) || 'upload refused', 'TikTok');

    // TikTok processes the video after this; the profile is the stable link.
    return { remotePostId: init.data.data.publish_id, remoteUrl: 'https://www.tiktok.com/' };
  },
};
