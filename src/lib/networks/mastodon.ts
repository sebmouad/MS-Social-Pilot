import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { netJson, textWithLink, type NetworkConnector } from './types';
import { stripHtml } from '../rss/parse';

/**
 * Mastodon, and the servers that speak its API.
 *
 * Every server is its own world, so there is no app to create in advance:
 * connecting registers MS Social Pilot with the server the person names, then
 * runs that server's OAuth. The server's address and the app's keys are kept
 * with the account.
 */

export const MASTODON_SCOPES = 'read:accounts write:statuses write:media';

/** `mastodon.social`, `https://mastodon.social/`, `@me@mastodon.social` → `https://mastodon.social`. */
export function normaliseInstance(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (/^https?:\/\//.test(value)) {
    value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  } else {
    const handle = /^@?[^@\s/]+@([^@\s/]+)$/.exec(value);
    if (handle) value = handle[1]!;
    value = value.replace(/\/.*$/, '');
  }
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) ? `https://${value}` : null;
}

export async function registerMastodonApp(instance: string, redirectUri: string, website: string) {
  const { data } = await netJson<{ client_id: string; client_secret: string }>('Mastodon', `${instance}/api/v1/apps`, {
    method: 'POST',
    untrustedHost: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'MS Social Pilot', redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website }),
  });
  return data;
}

export async function mastodonToken(instance: string, options: { clientId: string; clientSecret: string; code: string; redirectUri: string }) {
  const { data } = await netJson<{ access_token: string }>('Mastodon', `${instance}/oauth/token`, {
    method: 'POST',
    untrustedHost: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      code: options.code,
      scope: MASTODON_SCOPES,
    }),
  });
  return data.access_token;
}

export async function mastodonAccount(instance: string, token: string) {
  const { data } = await netJson<{ id: string; acct: string; username: string; display_name: string; avatar: string; url: string }>(
    'Mastodon',
    `${instance}/api/v1/accounts/verify_credentials`,
    { untrustedHost: true, headers: { authorization: `Bearer ${token}` } },
  );
  return data;
}

async function uploadMedia(instance: string, token: string, item: { read: () => Promise<Buffer>; mimeType?: string; altText?: string; kind: string }) {
  const bytes = await item.read();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: item.mimeType ?? (item.kind === 'video' ? 'video/mp4' : 'image/jpeg') }), item.kind === 'video' ? 'video.mp4' : 'image');
  if (item.altText) form.append('description', item.altText.slice(0, 1500));
  const { data } = await netJson<{ id: string; url: string | null }>('Mastodon', `${instance}/api/v2/media`, {
    method: 'POST',
    untrustedHost: true,
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  // Large files are processed after the answer: wait until the server has a URL for it.
  for (let attempt = 0; attempt < 30 && !data.url; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const check = await netJson<{ url: string | null }>('Mastodon', `${instance}/api/v1/media/${data.id}`, {
      untrustedHost: true,
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (check?.data.url) return data.id;
  }
  return data.id;
}

export const mastodon: NetworkConnector = {
  key: 'mastodon',
  label: 'Mastodon',
  rules: NETWORK_RULES.mastodon,
  async publish(_target, post, { credentials }) {
    const instance = (credentials.meta as { instance?: string }).instance;
    if (!instance) throw new GraphError({ message: 'Mastodon: reconnect the account.', kind: 'auth' });
    const mediaIds: string[] = [];
    const items = post.media.some((item) => item.kind === 'video')
      ? post.media.filter((item) => item.kind === 'video').slice(0, 1)
      : post.media.slice(0, 4);
    for (const item of items) mediaIds.push(await uploadMedia(instance, credentials.accessToken, item));
    const { data } = await netJson<{ id: string; url: string }>('Mastodon', `${instance}/api/v1/statuses`, {
      method: 'POST',
      untrustedHost: true,
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        'content-type': 'application/json',
        // A retry after a lost answer must not post twice.
        'idempotency-key': post.idempotencyKey,
      },
      body: JSON.stringify({ status: textWithLink(post), media_ids: mediaIds, visibility: 'public' }),
    });
    return { remotePostId: data.id, remoteUrl: data.url };
  },
  async stats(remotePostId, { credentials }) {
    const instance = (credentials.meta as { instance?: string }).instance;
    if (!instance) throw new GraphError({ message: 'Mastodon: reconnect the account.', kind: 'auth' });
    const { data } = await netJson<{ favourites_count?: number; reblogs_count?: number; replies_count?: number }>(
      'Mastodon',
      `${instance}/api/v1/statuses/${encodeURIComponent(remotePostId)}`,
      { untrustedHost: true, headers: { authorization: `Bearer ${credentials.accessToken}` } },
    );
    return { likes: data.favourites_count ?? 0, reposts: data.reblogs_count ?? 0, replies: data.replies_count ?? 0 };
  },
  async replies(remotePostId, { credentials }) {
    const instance = (credentials.meta as { instance?: string }).instance;
    if (!instance) throw new GraphError({ message: 'Mastodon: reconnect the account.', kind: 'auth' });
    const { data } = await netJson<{ descendants: Array<{
      id: string;
      in_reply_to_id: string | null;
      content: string;
      created_at: string;
      favourites_count?: number;
      replies_count?: number;
      account: { id: string; acct: string; display_name?: string };
    }> }>(
      'Mastodon',
      `${instance}/api/v1/statuses/${encodeURIComponent(remotePostId)}/context`,
      { untrustedHost: true, headers: { authorization: `Bearer ${credentials.accessToken}` } },
    );
    // Ids are local to this server; the account's own target id is `id@host`.
    const host = new URL(instance).host;
    return data.descendants.map((status) => ({
      remoteId: status.id,
      // A direct answer to the post is a top-level comment.
      parentRemoteId: status.in_reply_to_id === remotePostId ? null : status.in_reply_to_id,
      message: stripHtml(status.content),
      fromName: status.account.display_name || status.account.acct,
      fromId: `${status.account.id}@${host}`,
      likeCount: status.favourites_count ?? 0,
      replyCount: status.replies_count ?? 0,
      isHidden: false,
      createdTime: new Date(status.created_at),
    }));
  },
};
