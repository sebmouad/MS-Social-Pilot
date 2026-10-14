import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { env } from '../env';
import { netJson, type NetworkConnector, type NetworkContext } from './types';

/**
 * Pinterest: each board is a destination, and a Pin is a picture with a
 * description and the link it leads to. Access tokens last thirty days and
 * are refreshed on the way to publishing when close to the end.
 */

export const PINTEREST_SCOPES = ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'];
const API = 'https://api.pinterest.com/v5';

function basic(): string {
  return `Basic ${Buffer.from(`${env.pinterestClientId}:${env.pinterestClientSecret}`).toString('base64')}`;
}

export async function pinterestToken(options: { code: string; redirectUri: string }) {
  const { data } = await netJson<{ access_token: string; refresh_token: string; expires_in: number }>('Pinterest', `${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: options.code, redirect_uri: options.redirectUri }),
  });
  return data;
}

export async function pinterestAccount(token: string) {
  const { data } = await netJson<{ username: string; profile_image?: string; business_name?: string }>('Pinterest', `${API}/user_account`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return data;
}

export async function pinterestBoards(token: string) {
  const { data } = await netJson<{ items: Array<{ id: string; name: string; media?: { image_cover_url?: string } }> }>(
    'Pinterest',
    `${API}/boards?page_size=100`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return data.items;
}

async function freshToken(context: NetworkContext): Promise<string> {
  const { credentials } = context;
  if (credentials.expiresAt && credentials.expiresAt.getTime() - Date.now() > 2 * 24 * 60 * 60 * 1000) return credentials.accessToken;
  if (!credentials.refreshToken) return credentials.accessToken;
  const { data } = await netJson<{ access_token: string; refresh_token?: string; expires_in: number }>('Pinterest', `${API}/oauth/token`, {
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

export const pinterest: NetworkConnector = {
  key: 'pinterest',
  label: 'Pinterest',
  rules: NETWORK_RULES.pinterest,
  async remove(remotePostId, context) {
    const token = await freshToken(context);
    await netJson('Pinterest', `${API}/pins/${encodeURIComponent(remotePostId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
  },
  async publish(target, post, context) {
    const images = post.media.filter((item) => item.kind === 'image').slice(0, 5);
    if (images.length === 0) throw new GraphError({ message: 'Pinterest: a Pin needs a picture.', kind: 'rejected' });
    const token = await freshToken(context);
    const firstLine = post.text.split('\n').find((line) => line.trim()) ?? '';
    const { data } = await netJson<{ id: string }>('Pinterest', `${API}/pins`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        board_id: target.providerId,
        title: (post.linkPreview?.title ?? firstLine).slice(0, 100),
        description: post.text.slice(0, 500),
        ...(post.link ? { link: post.link } : {}),
        ...(images[0]!.altText ? { alt_text: images[0]!.altText.slice(0, 500) } : {}),
        media_source:
          images.length > 1
            ? { source_type: 'multiple_image_urls', items: images.map((image) => ({ url: image.url, ...(image.altText ? { description: image.altText } : {}) })) }
            : { source_type: 'image_url', url: images[0]!.url },
      }),
    });
    return { remotePostId: data.id, remoteUrl: `https://www.pinterest.com/pin/${data.id}/` };
  },
};
