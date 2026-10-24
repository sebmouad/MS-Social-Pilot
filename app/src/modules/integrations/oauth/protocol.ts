import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { OAUTH_INPUT_DEFAULTS } from '../config';

/** Pure protocol rules for the MCP connector flow. No I/O here, so every rule is directly testable. */

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const CTRL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * Redirect URIs are matched exactly later; this decides what may be registered at all. https anywhere, or http on loopback
 * (desktop clients). No fragments, no credentials, no wildcard or relative forms, no other schemes.
 */
export function isAllowedRedirect(uri: string, maxCharacters: number = OAUTH_INPUT_DEFAULTS.redirectUriMaxCharacters): boolean {
  if (typeof uri !== 'string' || uri.length > maxCharacters || /[\s\u0000-\u001f]/.test(uri) || uri.includes('*') || uri.includes('#')) return false;
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK.includes(url.hostname);
}

export type OAuthInputLimits = { clientNameInputMaxCharacters: number; clientNameMaxCharacters: number; redirectUriMaxCharacters: number; redirectUrisMaxItems: number; authorizationStateMaxCharacters: number; scopeMaxCharacters: number };
export function registrationSchemaForLimits(limits: Pick<OAuthInputLimits, 'clientNameInputMaxCharacters' | 'redirectUriMaxCharacters' | 'redirectUrisMaxItems'>) {
  return z.object({
    client_name: z.string().max(limits.clientNameInputMaxCharacters).optional(),
    redirect_uris: z.array(z.string().max(limits.redirectUriMaxCharacters)).min(1).max(limits.redirectUrisMaxItems),
    token_endpoint_auth_method: z.literal('none').optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
  }).passthrough().superRefine((value, ctx) => {
    if (value.redirect_uris.some(uri => !isAllowedRedirect(uri, limits.redirectUriMaxCharacters))) ctx.addIssue({ code: 'custom', message: 'Redirect URIs must use https (or http on localhost) with no fragment.' });
    if (value.grant_types && value.grant_types.some(grant => grant !== 'authorization_code')) ctx.addIssue({ code: 'custom', message: 'Only the authorization_code grant is supported.' });
    if (value.response_types && value.response_types.some(type => type !== 'code')) ctx.addIssue({ code: 'custom', message: 'Only the code response type is supported.' });
  });
}
/** Compatibility schema preserves the original protocol-facing defaults. Service code uses the live-limits factory. */
export const registrationSchema = registrationSchemaForLimits({
  clientNameInputMaxCharacters: OAUTH_INPUT_DEFAULTS.clientNameInputMaxCharacters,
  redirectUriMaxCharacters: OAUTH_INPUT_DEFAULTS.redirectUriMaxCharacters,
  redirectUrisMaxItems: OAUTH_INPUT_DEFAULTS.redirectUrisMaxItems,
});

/** Display name shown on the consent screen: stripped of control and bidi characters so it cannot disguise itself. */
export function cleanClientName(raw: string | undefined, maxCharacters: number, fallback: string): string {
  const name = (raw ?? '').replace(CTRL, '').replace(/\s+/g, ' ').trim().slice(0, maxCharacters);
  return name || fallback;
}

export const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const CLIENT_ID = /^oc_[A-Za-z0-9_-]{16,64}$/;

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
export const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Constant-time string equality (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/** PKCE: S256 only, verifier shape checked, comparison constant time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return CODE_VERIFIER.test(verifier) && CODE_CHALLENGE.test(challenge) && safeEqual(s256(verifier), challenge);
}

/** Exact string match against the registered list. No normalisation, prefix or pattern matching. */
export function redirectRegistered(registered: readonly string[], candidate: string): boolean {
  return registered.reduce((found, uri) => safeEqual(uri, candidate) || found, false);
}

/** Requested OAuth scope words; unknown words are ignored and absence means the narrowest (read). */
export function requestedScopes(scope: string | null | undefined): { read: true; write: boolean } {
  const words = (scope ?? '').split(/\s+/).filter(Boolean);
  return { read: true, write: words.includes('write') };
}

/** Same-origin check for the consent POST: the Origin header must be present and equal the request or issuer origin. */
export function sameOrigin(headers: Pick<Headers, 'get'>, requestUrl: string, issuer?: string | null): boolean {
  const origin = headers.get('origin');
  if (!origin || origin === 'null') return false;
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  try {
    const actual = new URL(origin).origin;
    return actual === new URL(requestUrl).origin || (!!issuer && actual === new URL(issuer).origin);
  } catch { return false; }
}

export type OAuthErrorCode = 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_client_metadata' | 'temporarily_unavailable' | 'access_denied' | 'server_error';
export class OAuthError extends Error {
  constructor(readonly code: OAuthErrorCode, message: string, readonly status = 400) { super(message); }
}

/** Authorization request parameters, parsed once for the screen and re-parsed for the decision. */
export function authorizeParamsSchemaForLimits(limits: Pick<OAuthInputLimits, 'redirectUriMaxCharacters' | 'authorizationStateMaxCharacters' | 'scopeMaxCharacters'>) {
  return z.object({
    client_id: z.string().regex(CLIENT_ID),
    redirect_uri: z.string().min(1).max(limits.redirectUriMaxCharacters),
    response_type: z.literal('code'),
    code_challenge: z.string().regex(CODE_CHALLENGE),
    code_challenge_method: z.literal('S256'),
    state: z.string().max(limits.authorizationStateMaxCharacters).optional(),
    scope: z.string().max(limits.scopeMaxCharacters).optional(),
  });
}
/** Compatibility parser retains the former 2000/1000/200 defaults. Integrators should use the Root-limits factory. */
export const authorizeParamsSchema = authorizeParamsSchemaForLimits({
  redirectUriMaxCharacters: OAUTH_INPUT_DEFAULTS.redirectUriMaxCharacters,
  authorizationStateMaxCharacters: OAUTH_INPUT_DEFAULTS.authorizationStateMaxCharacters,
  scopeMaxCharacters: OAUTH_INPUT_DEFAULTS.scopeMaxCharacters,
});
