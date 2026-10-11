import { Prisma } from '@prisma/client';

import { prisma } from '../prisma';
import { decryptSecret, encryptSecret } from '../crypto';
import { env } from '../env';
import { readStoredFile } from '../media';
import type { PostMedia } from '../json';
import { bluesky } from './bluesky';
import { linkedin } from './linkedin';
import { mastodon } from './mastodon';
import { pinterest } from './pinterest';
import { threads } from './threads';
import { x } from './x';
import {
  isNetworkKey,
  NETWORK_KEYS,
  type NetworkConnector,
  type NetworkCredentials,
  type NetworkKey,
  type NetworkMedia,
  type NetworkPublishResult,
} from './types';

export { NETWORK_KEYS, isNetworkKey, type NetworkKey };

export const CONNECTORS: Record<NetworkKey, NetworkConnector> = { bluesky, mastodon, linkedin, threads, x, pinterest };

/** Networks that sign in through an app this installation registered, and whether its keys are set. */
export function networkAvailable(key: NetworkKey): boolean {
  switch (key) {
    case 'bluesky':
    case 'mastodon':
      return true;
    case 'linkedin':
      return Boolean(env.linkedinClientId && env.linkedinClientSecret);
    case 'threads':
      return Boolean(env.threadsClientId && env.threadsClientSecret);
    case 'x':
      return Boolean(env.xClientId && env.xClientSecret);
    case 'pinterest':
      return Boolean(env.pinterestClientId && env.pinterestClientSecret);
  }
}

export function callbackUrl(key: NetworkKey): string {
  return `${env.appUrl.replace(/\/$/, '')}/api/networks/${key}/callback`;
}

/** Attachments as the networks take them: a fetchable https URL and the bytes on demand. */
export async function networkMediaOf(media: PostMedia[]): Promise<NetworkMedia[]> {
  const { signMediaUrl } = await import('../media-links');
  return media.map((item) => ({
    kind: item.kind,
    url: item.storageKey ? signMediaUrl(item.id).url : item.url,
    mimeType: item.mimeType,
    altText: item.altText,
    read: async () => {
      if (item.storageKey) return readStoredFile(item.storageKey);
      const response = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Could not fetch ${item.url}`);
      return Buffer.from(await response.arrayBuffer());
    },
  }));
}

function credentialsOf(account: {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  meta: Prisma.JsonValue | null;
}): NetworkCredentials {
  return {
    accessToken: decryptSecret(account.accessToken),
    refreshToken: account.refreshToken ? decryptSecret(account.refreshToken) : null,
    expiresAt: account.tokenExpiresAt,
    meta: (account.meta && typeof account.meta === 'object' && !Array.isArray(account.meta) ? account.meta : {}) as Record<string, unknown>,
  };
}

/** Publish one destination on a network other than Facebook. */
export async function publishToNetwork(options: {
  key: NetworkKey;
  target: { providerId: string; name: string };
  account: { id: string; accessToken: string; refreshToken: string | null; tokenExpiresAt: Date | null; meta: Prisma.JsonValue | null };
  text: string;
  link: string | null;
  media: PostMedia[];
  linkPreview?: { title?: string | null; description?: string | null; image?: string | null } | null;
  idempotencyKey: string;
}): Promise<NetworkPublishResult> {
  const connector = CONNECTORS[options.key];
  const media = await networkMediaOf(options.media);
  // A network without link cards, or a post whose pictures take the card's
  // place, carries the link in its text instead.
  const linkInText = options.link && (!connector.rules.linkCard || media.length > 0) && !options.text.includes(options.link);
  return connector.publish(
    options.target,
    {
      text: linkInText ? `${options.text.trimEnd()}\n\n${options.link}`.trim() : options.text,
      link: options.link,
      media,
      linkPreview: options.linkPreview ?? null,
      idempotencyKey: options.idempotencyKey,
    },
    {
      credentials: credentialsOf(options.account),
      saveCredentials: async (next) => {
        await prisma.socialAccount.update({
          where: { id: options.account.id },
          data: {
            accessToken: encryptSecret(next.accessToken),
            refreshToken: next.refreshToken ? encryptSecret(next.refreshToken) : null,
            tokenExpiresAt: next.expiresAt,
            meta: next.meta as Prisma.InputJsonValue,
          },
        });
      },
    },
  );
}

export { networkProblems, type NetworkProblem } from '../network-rules';

export const NETWORK_LABELS: Record<NetworkKey, string> = Object.fromEntries(
  NETWORK_KEYS.map((key) => [key, CONNECTORS[key].label]),
) as Record<NetworkKey, string>;
