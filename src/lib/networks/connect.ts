import { createHash } from 'node:crypto';
import { Prisma, TargetType } from '@prisma/client';

import { prisma } from '../prisma';
import { decryptSecret, encryptSecret, randomToken, safeEqual } from '../crypto';
import { env } from '../env';
import { blueskyProfile, blueskySession } from './bluesky';
import { LINKEDIN_MEMBER_SCOPES, LINKEDIN_ORG_SCOPES, linkedinMember, linkedinOrganizations, linkedinToken } from './linkedin';
import { MASTODON_SCOPES, mastodonAccount, mastodonToken, normaliseInstance, registerMastodonApp } from './mastodon';
import { PINTEREST_SCOPES, pinterestAccount, pinterestBoards, pinterestToken } from './pinterest';
import { THREADS_SCOPES, threadsProfile, threadsToken } from './threads';
import { X_SCOPES, xMe, xToken } from './x';
import { callbackUrl } from './index';
import type { NetworkKey } from './types';

/**
 * Connecting another network: the sign-in round trip and what it leaves
 * behind — one account, and the destinations it can post to.
 *
 * The OAuth state rides in an encrypted, httpOnly cookie with a ten-minute
 * life, and the callback must hand back the same random value: the same
 * defence as the Facebook login, so nobody can attach their account to
 * someone else's workspace with a crafted link.
 */

export const oauthCookie = (key: NetworkKey) => `msp_oauth_${key}`;

interface PendingAuth {
  state: string;
  workspaceId: string;
  userId: string;
  verifier?: string;
  /** Mastodon: the server, and the app it registered with us. */
  instance?: string;
  clientId?: string;
  clientSecret?: string;
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Where to send the person to sign in, and the sealed state to keep in their cookie. */
export async function startNetworkAuth(
  key: Exclude<NetworkKey, 'bluesky'>,
  options: { workspaceId: string; userId: string; instance?: string; organizations?: boolean },
): Promise<{ url: string; cookie: string }> {
  const state = randomToken(24);
  const pending: PendingAuth = { state, workspaceId: options.workspaceId, userId: options.userId };
  const redirect = callbackUrl(key);
  let url: URL;

  switch (key) {
    case 'mastodon': {
      const instance = normaliseInstance(options.instance ?? '');
      if (!instance) throw new Error('Type the address of your Mastodon server, such as mastodon.social.');
      const app = await registerMastodonApp(instance, redirect, env.appUrl);
      Object.assign(pending, { instance, clientId: app.client_id, clientSecret: app.client_secret });
      url = new URL(`${instance}/oauth/authorize`);
      url.search = new URLSearchParams({ client_id: app.client_id, response_type: 'code', redirect_uri: redirect, scope: MASTODON_SCOPES, state }).toString();
      break;
    }
    case 'linkedin': {
      url = new URL('https://www.linkedin.com/oauth/v2/authorization');
      const scopes = [...LINKEDIN_MEMBER_SCOPES, ...(options.organizations ? LINKEDIN_ORG_SCOPES : [])];
      url.search = new URLSearchParams({ response_type: 'code', client_id: env.linkedinClientId, redirect_uri: redirect, state, scope: scopes.join(' ') }).toString();
      break;
    }
    case 'threads': {
      url = new URL('https://threads.net/oauth/authorize');
      url.search = new URLSearchParams({ client_id: env.threadsClientId, redirect_uri: redirect, scope: THREADS_SCOPES.join(','), response_type: 'code', state }).toString();
      break;
    }
    case 'x': {
      const verifier = randomToken(48);
      pending.verifier = verifier;
      url = new URL('https://x.com/i/oauth2/authorize');
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: env.xClientId,
        redirect_uri: redirect,
        scope: X_SCOPES.join(' '),
        state,
        code_challenge: challengeOf(verifier),
        code_challenge_method: 'S256',
      }).toString();
      break;
    }
    case 'pinterest': {
      url = new URL('https://www.pinterest.com/oauth/');
      url.search = new URLSearchParams({ client_id: env.pinterestClientId, redirect_uri: redirect, response_type: 'code', scope: PINTEREST_SCOPES.join(','), state }).toString();
      break;
    }
  }
  return { url: url.toString(), cookie: encryptSecret(JSON.stringify(pending)) };
}

/** Open the cookie and check it belongs to this callback. Null when it does not. */
export function openPendingAuth(cookie: string | undefined, state: string | null): PendingAuth | null {
  if (!cookie || !state) return null;
  try {
    const pending = JSON.parse(decryptSecret(cookie)) as PendingAuth;
    return safeEqual(pending.state, state) ? pending : null;
  } catch {
    return null;
  }
}

interface Connected {
  providerUserId: string;
  name: string;
  pictureUrl: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string;
  meta?: Record<string, unknown>;
  targets: Array<{ providerId: string; name: string; pictureUrl: string | null; category?: string | null }>;
}

/** Trade the code for tokens and find what the account can post to. */
export async function finishNetworkAuth(key: Exclude<NetworkKey, 'bluesky'>, pending: PendingAuth, code: string): Promise<Connected> {
  const redirectUri = callbackUrl(key);
  switch (key) {
    case 'mastodon': {
      const token = await mastodonToken(pending.instance!, { clientId: pending.clientId!, clientSecret: pending.clientSecret!, code, redirectUri });
      const account = await mastodonAccount(pending.instance!, token);
      const host = new URL(pending.instance!).host;
      return {
        providerUserId: `${account.id}@${host}`,
        name: account.display_name || account.username,
        pictureUrl: account.avatar,
        accessToken: token,
        meta: { instance: pending.instance, clientId: pending.clientId, clientSecret: pending.clientSecret, acct: account.acct },
        targets: [{ providerId: `${account.id}@${host}`, name: `@${account.acct}@${host}`, pictureUrl: account.avatar, category: 'Mastodon' }],
      };
    }
    case 'linkedin': {
      const token = await linkedinToken({ clientId: env.linkedinClientId, clientSecret: env.linkedinClientSecret, code, redirectUri });
      const member = await linkedinMember(token.access_token);
      const granted = token.scope ?? '';
      const orgs = granted.includes('rw_organization_admin') ? await linkedinOrganizations(token.access_token) : [];
      return {
        providerUserId: member.sub,
        name: member.name,
        pictureUrl: member.picture ?? null,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
        scopes: granted,
        targets: [
          { providerId: `urn:li:person:${member.sub}`, name: member.name, pictureUrl: member.picture ?? null, category: 'LinkedIn profile' },
          ...orgs.map((org) => ({ providerId: org.urn, name: org.name, pictureUrl: org.logo, category: 'LinkedIn Page' })),
        ],
      };
    }
    case 'threads': {
      const token = await threadsToken({ clientId: env.threadsClientId, clientSecret: env.threadsClientSecret, code, redirectUri });
      const profile = await threadsProfile(token.accessToken);
      return {
        providerUserId: profile.id,
        name: profile.name || profile.username,
        pictureUrl: profile.threads_profile_picture_url ?? null,
        accessToken: token.accessToken,
        expiresAt: new Date(Date.now() + token.expiresIn * 1000),
        meta: { refreshedAt: Date.now() },
        targets: [{ providerId: profile.id, name: profile.username, pictureUrl: profile.threads_profile_picture_url ?? null, category: 'Threads' }],
      };
    }
    case 'x': {
      const token = await xToken({ code, redirectUri, verifier: pending.verifier! });
      const me = await xMe(token.access_token);
      return {
        providerUserId: me.id,
        name: me.name,
        pictureUrl: me.profile_image_url ?? null,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
        targets: [{ providerId: me.id, name: `@${me.username}`, pictureUrl: me.profile_image_url ?? null, category: 'X' }],
      };
    }
    case 'pinterest': {
      const token = await pinterestToken({ code, redirectUri });
      const account = await pinterestAccount(token.access_token);
      const boards = await pinterestBoards(token.access_token);
      return {
        providerUserId: account.username,
        name: account.business_name || account.username,
        pictureUrl: account.profile_image ?? null,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
        targets: boards.map((board) => ({
          providerId: board.id,
          name: `${account.username} / ${board.name}`,
          pictureUrl: board.media?.image_cover_url ?? account.profile_image ?? null,
          category: 'Pinterest board',
        })),
      };
    }
  }
}

/** Bluesky: no redirect, an app password typed by the account's owner. */
export async function connectBluesky(identifier: string, appPassword: string): Promise<Connected> {
  const session = await blueskySession(identifier, appPassword);
  const profile = await blueskyProfile(session).catch(() => ({ handle: session.handle, displayName: undefined, avatar: undefined }));
  return {
    providerUserId: session.did,
    name: profile.displayName || session.handle,
    pictureUrl: profile.avatar ?? null,
    // The app password is the credential Bluesky intends a tool to keep.
    accessToken: appPassword.trim(),
    meta: { identifier: session.did, handle: session.handle, pds: session.pds },
    targets: [{ providerId: session.did, name: `@${session.handle}`, pictureUrl: profile.avatar ?? null, category: 'Bluesky' }],
  };
}

/**
 * Keep the account and its destinations. Connecting again refreshes the
 * tokens and names; destinations that disappeared are left switched off
 * rather than deleted, so their history stays.
 */
export async function saveNetworkAccount(options: { workspaceId: string; key: NetworkKey; connected: Connected }) {
  const { connected, workspaceId, key } = options;
  const data = {
    name: connected.name,
    pictureUrl: connected.pictureUrl,
    accessToken: encryptSecret(connected.accessToken),
    refreshToken: connected.refreshToken ? encryptSecret(connected.refreshToken) : null,
    tokenExpiresAt: connected.expiresAt ?? null,
    scopes: connected.scopes ?? '',
    meta: (connected.meta ?? {}) as Prisma.InputJsonValue,
    invalidatedAt: null,
    invalidReason: null,
    lastSyncedAt: new Date(),
  };
  const account = await prisma.socialAccount.upsert({
    where: { workspaceId_provider_providerUserId: { workspaceId, provider: key, providerUserId: connected.providerUserId } },
    create: { workspaceId, provider: key, providerUserId: connected.providerUserId, ...data },
    update: data,
  });
  const type = key as TargetType;
  for (const target of connected.targets) {
    const existing = await prisma.target.findFirst({ where: { workspaceId, type, providerId: target.providerId } });
    if (existing) {
      await prisma.target.update({
        where: { id: existing.id },
        data: { name: target.name, pictureUrl: target.pictureUrl, category: target.category ?? null, socialAccountId: account.id, canPublish: true, publishBlocker: null },
      });
    } else {
      await prisma.target.create({
        data: { workspaceId, type, providerId: target.providerId, name: target.name, pictureUrl: target.pictureUrl, category: target.category ?? null, socialAccountId: account.id, accessToken: null },
      });
    }
  }
  return { accountId: account.id, targets: connected.targets.length };
}
