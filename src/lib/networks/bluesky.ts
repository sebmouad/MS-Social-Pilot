import { GraphError } from '../facebook/graph';
import { NETWORK_RULES } from '../network-rules';
import { failureFor, netJson, type NetworkConnector, type NetworkPost, type NetworkReply } from './types';

/**
 * Bluesky, over the AT Protocol.
 *
 * Connected with an app password — Bluesky's own answer for third-party
 * tools, made in Settings → Privacy and security → App passwords and revocable
 * there — never the account's real password. A session is opened for each
 * publish rather than kept: sessions last two hours, publishing is rare, and
 * a stored app password is what Bluesky intends a tool to hold.
 */

const ENTRYWAY = 'https://bsky.social';
const MAX_IMAGE_BYTES = 1_000_000;

interface Session {
  accessJwt: string;
  did: string;
  handle: string;
  didDoc?: { service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }> };
}

/** The server the account lives on, from its DID document. */
function pdsOf(session: Session): string {
  const service = session.didDoc?.service?.find((entry) => entry.id === '#atproto_pds' || entry.type === 'AtprotoPersonalDataServer');
  const endpoint = service?.serviceEndpoint;
  return endpoint && /^https:\/\//.test(endpoint) ? endpoint.replace(/\/$/, '') : ENTRYWAY;
}

export async function blueskySession(identifier: string, appPassword: string, pds = ENTRYWAY): Promise<Session & { pds: string }> {
  const { data } = await netJson<Session>('Bluesky', `${pds}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: identifier.replace(/^@/, '').trim(), password: appPassword.trim() }),
  });
  return { ...data, pds: pdsOf(data) };
}

export async function blueskyProfile(session: { accessJwt: string; did: string; pds: string }) {
  const { data } = await netJson<{ handle: string; displayName?: string; avatar?: string }>(
    'Bluesky',
    `${session.pds}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.did)}`,
    { headers: { authorization: `Bearer ${session.accessJwt}` } },
  );
  return data;
}

/** UTF-8 byte offsets, which is what Bluesky's facets count in. */
function byteRange(text: string, start: number, end: number) {
  const encoder = new TextEncoder();
  return { byteStart: encoder.encode(text.slice(0, start)).length, byteEnd: encoder.encode(text.slice(0, end)).length };
}

/** Links and hashtags made clickable: Bluesky does not find them by itself. */
export function blueskyFacets(text: string) {
  const facets: Array<{ index: { byteStart: number; byteEnd: number }; features: Array<Record<string, string>> }> = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)]+[^\s).,!?:;"']/g)) {
    facets.push({
      index: byteRange(text, match.index!, match.index! + match[0].length),
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    });
  }
  for (const match of text.matchAll(/(^|\s)(#[\p{L}\p{N}_]{1,64})/gu)) {
    const start = match.index! + match[1]!.length;
    facets.push({
      index: byteRange(text, start, start + match[2]!.length),
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[2]!.slice(1) }],
    });
  }
  return facets;
}

async function uploadBlob(pds: string, token: string, bytes: Buffer, mimeType: string) {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new GraphError({ message: 'Bluesky takes pictures of up to 1 MB. Use a smaller image.', kind: 'rejected' });
  }
  const { data } = await netJson<{ blob: unknown }>('Bluesky', `${pds}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': mimeType },
    body: new Uint8Array(bytes),
  });
  return data.blob;
}

async function embedFor(post: NetworkPost, pds: string, token: string) {
  const images = post.media.filter((item) => item.kind === 'image').slice(0, 4);
  if (images.length > 0) {
    const uploaded = [];
    for (const image of images) {
      const bytes = await image.read();
      uploaded.push({ alt: image.altText ?? '', image: await uploadBlob(pds, token, bytes, image.mimeType ?? 'image/jpeg') });
    }
    return { $type: 'app.bsky.embed.images', images: uploaded };
  }
  if (post.link) {
    let thumb: unknown;
    if (post.linkPreview?.image && /^https:\/\//.test(post.linkPreview.image)) {
      try {
        const response = await fetch(post.linkPreview.image, { signal: AbortSignal.timeout(10_000) });
        if (response.ok) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length <= MAX_IMAGE_BYTES) thumb = await uploadBlob(pds, token, bytes, response.headers.get('content-type') ?? 'image/jpeg');
        }
      } catch {
        // A card without its picture is still a card.
      }
    }
    return {
      $type: 'app.bsky.embed.external',
      external: {
        uri: post.link,
        title: post.linkPreview?.title ?? post.link,
        description: post.linkPreview?.description ?? '',
        ...(thumb ? { thumb } : {}),
      },
    };
  }
  return undefined;
}

/** Bluesky's public read-only service. */
const PUBLIC_APPVIEW = 'https://public.api.bsky.app';

export const bluesky: NetworkConnector = {
  key: 'bluesky',
  label: 'Bluesky',
  rules: NETWORK_RULES.bluesky,
  async remove(remotePostId, { credentials }) {
    const meta = credentials.meta as { identifier?: string; pds?: string };
    if (!meta.identifier) throw new GraphError({ message: 'Bluesky: reconnect the account.', kind: 'auth' });
    const session = await blueskySession(meta.identifier, credentials.accessToken, meta.pds ?? ENTRYWAY);
    const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(remotePostId);
    if (!match || match[1] !== session.did) throw new GraphError({ message: 'Bluesky: this post does not belong to the connected account.', kind: 'permission' });
    await netJson('Bluesky', `${session.pds}/xrpc/com.atproto.repo.deleteRecord`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', rkey: match[2] }),
    });
  },
  async publish(_target, post, { credentials }) {
    const meta = credentials.meta as { identifier?: string; pds?: string };
    if (!meta.identifier) throw new GraphError({ message: 'Bluesky: reconnect the account.', kind: 'auth' });
    const session = await blueskySession(meta.identifier, credentials.accessToken, meta.pds ?? ENTRYWAY).catch((error) => {
      // A revoked app password answers 401: the account must be reconnected.
      throw error instanceof GraphError ? error : failureFor(401, 'sign-in failed', 'Bluesky');
    });
    const text = post.text.trim();
    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      facets: blueskyFacets(text),
      embed: await embedFor(post, session.pds, session.accessJwt),
    };
    const { data } = await netJson<{ uri: string; cid: string }>('Bluesky', `${session.pds}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.accessJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
    });
    const rkey = data.uri.split('/').pop();
    return { remotePostId: data.uri, remoteUrl: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  },
  async stats(remotePostId) {
    // Counters are public: the AppView answers without signing in.
    const { data } = await netJson<{ posts: Array<{ likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }> }>(
      'Bluesky',
      `${PUBLIC_APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(remotePostId)}`,
    );
    const post = data.posts[0];
    if (!post) throw failureFor(404, 'the post is gone', 'Bluesky');
    return { likes: post.likeCount ?? 0, reposts: post.repostCount ?? 0, replies: post.replyCount ?? 0, quotes: post.quoteCount ?? 0 };
  },
  async replies(remotePostId) {
    // The thread is public too: no sign-in, no app password spent.
    const { data } = await netJson<{ thread: ThreadNode }>(
      'Bluesky',
      `${PUBLIC_APPVIEW}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(remotePostId)}&depth=6&parentHeight=0`,
    );
    const out: NetworkReply[] = [];
    const walk = (node: ThreadNode, parent: string | null) => {
      for (const child of node.replies ?? []) {
        // Blocked or deleted replies come back without a post.
        if (!child.post) continue;
        out.push({
          remoteId: child.post.uri,
          parentRemoteId: parent,
          message: child.post.record?.text ?? '',
          fromName: child.post.author.displayName || child.post.author.handle,
          fromId: child.post.author.did,
          likeCount: child.post.likeCount ?? 0,
          replyCount: child.post.replyCount ?? 0,
          isHidden: false,
          createdTime: new Date(child.post.record?.createdAt ?? child.post.indexedAt ?? Date.now()),
        });
        walk(child, child.post.uri);
      }
    };
    walk(data.thread, null);
    return out;
  },
};

interface ThreadNode {
  post?: {
    uri: string;
    author: { did: string; handle: string; displayName?: string };
    record?: { text?: string; createdAt?: string };
    indexedAt?: string;
    likeCount?: number;
    replyCount?: number;
  };
  replies?: ThreadNode[];
}
