import { env, assertOAuthReady } from '../env';
import { hmacHex, randomToken, safeEqual } from '../crypto';
import { GraphError, graphRequest } from './graph';

/**
 * Facebook Login (server-side OAuth), plus the token lifecycle that follows it.
 *
 * The flow, and why each step exists:
 *
 *   1. Redirect to the OAuth dialog with a signed `state` (CSRF defence).
 *   2. Exchange `code` for a *short-lived* user token (~1 hour).
 *   3. Immediately exchange that for a *long-lived* user token (~60 days).
 *   4. Read `/me/accounts` with the long-lived token — the page tokens it
 *      returns do not expire while the user token is valid, which is what makes
 *      unattended scheduled publishing possible.
 *
 * Skipping step 3 is the classic bug: everything works during testing and then
 * every scheduled post fails an hour after the user connects.
 */

export const OAUTH_REDIRECT_PATH = '/api/facebook/callback';

/** Cookie holding the CSRF nonce between the dialog redirect and the callback. */
export const OAUTH_NONCE_COOKIE = 'msp_oauth_nonce';

export function redirectUri(): string {
  return `${env.appUrl}${OAUTH_REDIRECT_PATH}`;
}

/**
 * Build an opaque, tamper-evident state value: `<nonce>.<signature>`.
 * The nonce is also stored in a short-lived cookie and compared on return, so
 * a forged callback cannot complete a connection into someone else's account.
 */
export function createOAuthState(): { state: string; nonce: string } {
  const nonce = randomToken(24);
  return { state: `${nonce}.${hmacHex(env.sessionSecret, nonce)}`, nonce };
}

export function verifyOAuthState(state: string, expectedNonce: string): boolean {
  const separator = state.lastIndexOf('.');
  if (separator <= 0) return false;

  const nonce = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  if (!safeEqual(nonce, expectedNonce)) return false;
  return safeEqual(signature, hmacHex(env.sessionSecret, nonce));
}

export function authorizationUrl(state: string): string {
  assertOAuthReady();
  const url = new URL(`https://www.facebook.com/${env.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', env.facebookAppId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', env.facebookScopes.join(','));
  // Force the account picker so a user managing several profiles can choose,
  // and so re-connecting after a permission change actually re-prompts.
  url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
}

export interface AccessToken {
  token: string;
  /** Absolute expiry, or null when Facebook reports the token as non-expiring. */
  expiresAt: Date | null;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

function toAccessToken(response: TokenResponse): AccessToken {
  // expires_in of 0 means "never expires" (typical for page tokens).
  const seconds = response.expires_in;
  const expiresAt =
    seconds && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
  return { token: response.access_token, expiresAt };
}

/** Step 2: authorization code → short-lived user token. */
export async function exchangeCodeForToken(code: string): Promise<AccessToken> {
  const url = new URL(`${env.graphBaseUrl}/${env.graphVersion}/oauth/access_token`);
  url.searchParams.set('client_id', env.facebookAppId);
  url.searchParams.set('client_secret', env.facebookAppSecret);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('code', code);

  const response = await fetch(url, { method: 'GET' });
  const payload = (await response.json()) as TokenResponse & { error?: { message?: string; code?: number } };

  if (!response.ok || !payload.access_token) {
    throw new GraphError({
      message: payload.error?.message ?? 'Facebook rejected the authorization code.',
      kind: payload.error?.code === 100 ? 'invalid_request' : 'permission',
      code: payload.error?.code ?? null,
      httpStatus: response.status,
    });
  }
  return toAccessToken(payload);
}

/** Step 3: short-lived user token → long-lived user token (~60 days). */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<AccessToken> {
  const url = new URL(`${env.graphBaseUrl}/${env.graphVersion}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', env.facebookAppId);
  url.searchParams.set('client_secret', env.facebookAppSecret);
  url.searchParams.set('fb_exchange_token', shortLivedToken);

  const response = await fetch(url, { method: 'GET' });
  const payload = (await response.json()) as TokenResponse & { error?: { message?: string; code?: number } };

  if (!response.ok || !payload.access_token) {
    throw new GraphError({
      message: payload.error?.message ?? 'Could not upgrade to a long-lived token.',
      kind: 'permission',
      code: payload.error?.code ?? null,
      httpStatus: response.status,
    });
  }
  return toAccessToken(payload);
}

export interface FacebookProfile {
  id: string;
  name: string;
  pictureUrl: string | null;
}

export async function fetchProfile(accessToken: string): Promise<FacebookProfile> {
  const { data } = await graphRequest<{
    id: string;
    name: string;
    picture?: { data?: { url?: string } };
  }>('me', {
    accessToken,
    params: { fields: 'id,name,picture.type(large)' },
  });

  return { id: data.id, name: data.name, pictureUrl: data.picture?.data?.url ?? null };
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  category: string | null;
  pictureUrl: string | null;
  /** Page-level permissions the current user holds, e.g. CREATE_CONTENT. */
  tasks: string[];
}

/**
 * List the Pages this user manages, with a page access token for each.
 *
 * Paginated deliberately: an agency account can manage hundreds of Pages and
 * the default page size is 25.
 */
export async function fetchPages(userAccessToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let after: string | undefined;

  do {
    const { data } = await graphRequest<{
      data: Array<{
        id: string;
        name: string;
        access_token: string;
        category?: string;
        tasks?: string[];
        picture?: { data?: { url?: string } };
      }>;
      paging?: { cursors?: { after?: string }; next?: string };
    }>('me/accounts', {
      accessToken: userAccessToken,
      params: {
        fields: 'id,name,access_token,category,tasks,picture.type(large)',
        limit: 100,
        after,
      },
    });

    for (const page of data.data ?? []) {
      pages.push({
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        category: page.category ?? null,
        pictureUrl: page.picture?.data?.url ?? null,
        tasks: page.tasks ?? [],
      });
    }

    after = data.paging?.next ? data.paging.cursors?.after : undefined;
  } while (after);

  return pages;
}

export interface FacebookGroup {
  id: string;
  name: string;
  pictureUrl: string | null;
  /** True when our app is installed in the group — required to publish. */
  appInstalled: boolean;
}

/**
 * List Groups the user administers.
 *
 * Meta restricted the Groups API in April 2024: `/me/groups` now returns only
 * groups where this specific app is installed, and publishing additionally
 * requires an approved `publish_to_groups` permission. A permission error here
 * is expected for most apps, so it is reported as "no groups" rather than
 * failing the whole connect flow.
 */
export async function fetchGroups(userAccessToken: string): Promise<FacebookGroup[]> {
  try {
    const { data } = await graphRequest<{
      data: Array<{
        id: string;
        name: string;
        administrator?: boolean;
        picture?: { data?: { url?: string } };
      }>;
    }>('me/groups', {
      accessToken: userAccessToken,
      params: { fields: 'id,name,administrator,picture', admin_only: true, limit: 100 },
    });

    return (data.data ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      pictureUrl: group.picture?.data?.url ?? null,
      // Presence in this list means the app is installed in the group.
      appInstalled: true,
    }));
  } catch (error) {
    if (error instanceof GraphError && (error.kind === 'permission' || error.kind === 'invalid_request')) {
      return [];
    }
    throw error;
  }
}

export interface TokenDebugInfo {
  isValid: boolean;
  scopes: string[];
  /**
   * Which assets each permission actually covers.
   *
   * The part people are surprised by: someone can grant `pages_manage_posts`
   * and then tick only three of their eight Pages in the second dialog. The
   * token then carries the permission, `scopes` lists it, and publishing to the
   * other five fails anyway. This is the only place Graph admits that, so it is
   * what the connection screen needs in order to tell somebody *which* Page is
   * the problem rather than that something, somewhere, is wrong.
   */
  granularScopes: Record<string, string[]>;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  appId: string | null;
  userId: string | null;
}

/**
 * Inspect a token via /debug_token, authenticated with an app access token.
 * Used on the Accounts screen to show real expiry and granted scopes instead of
 * waiting for a scheduled post to fail.
 */
export async function debugToken(inputToken: string): Promise<TokenDebugInfo> {
  const appToken = `${env.facebookAppId}|${env.facebookAppSecret}`;
  const { data } = await graphRequest<{
    data: {
      is_valid: boolean;
      scopes?: string[];
      granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
      expires_at?: number;
      data_access_expires_at?: number;
      app_id?: string;
      user_id?: string;
    };
  }>('debug_token', {
    accessToken: appToken,
    params: { input_token: inputToken },
  });

  const info = data.data;

  // A permission with no target_ids applies to everything the user has, which
  // is the common case; an empty list would wrongly read as "no Pages".
  const granularScopes: Record<string, string[]> = {};
  for (const entry of info?.granular_scopes ?? []) {
    if (entry.target_ids && entry.target_ids.length > 0) {
      granularScopes[entry.scope] = entry.target_ids;
    }
  }

  return {
    isValid: Boolean(info?.is_valid),
    scopes: info?.scopes ?? [],
    granularScopes,
    // A zero timestamp is Facebook's way of saying "does not expire".
    expiresAt: info?.expires_at ? new Date(info.expires_at * 1000) : null,
    dataAccessExpiresAt: info?.data_access_expires_at
      ? new Date(info.data_access_expires_at * 1000)
      : null,
    appId: info?.app_id ?? null,
    userId: info?.user_id ?? null,
  };
}

/**
 * Verify the `signed_request` Facebook posts to the deauthorize and data
 * deletion callbacks. Format is `<base64url signature>.<base64url payload>`.
 */
export function parseSignedRequest(signedRequest: string): { user_id?: string; algorithm?: string } | null {
  const [encodedSignature, encodedPayload] = signedRequest.split('.');
  if (!encodedSignature || !encodedPayload) return null;

  const expected = hmacHex(env.facebookAppSecret, encodedPayload);
  const actual = Buffer.from(encodedSignature, 'base64url').toString('hex');
  if (!safeEqual(expected, actual)) return null;

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      user_id?: string;
      algorithm?: string;
    };
  } catch {
    return null;
  }
}
