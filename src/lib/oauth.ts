import { createHash } from 'node:crypto';
import { z } from 'zod';

import { createApiToken, type ApiScope } from './api-tokens';
import { hashToken, randomToken } from './crypto';
import { prisma } from './prisma';

/**
 * OAuth 2.1 for remote MCP clients (the Claude web connector). Small on
 * purpose: dynamic client registration, the authorization-code grant with
 * PKCE (S256 only), and no refresh tokens — the access token is an ordinary
 * API key, listed and revoked with the others under Settings › API keys.
 */

const CODE_TTL_MS = 5 * 60 * 1000;

/** https anywhere, or http on this machine (desktop clients listen on localhost). */
export function isAllowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(100).default('MCP client'),
  redirect_uris: z.array(z.string().max(2000).refine(isAllowedRedirect, 'Redirect URIs must use https (or http on localhost).')).min(1).max(10),
});

export async function registerClient(input: z.infer<typeof registrationSchema>) {
  return prisma.oAuthClient.create({ data: { name: input.client_name, redirectUris: input.redirect_uris } });
}

export async function findClient(id: string) {
  return prisma.oAuthClient.findUnique({ where: { id } });
}

export async function issueCode(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: ApiScope;
}): Promise<string> {
  const code = randomToken(32);
  await prisma.oAuthCode.create({
    data: { ...input, codeHash: hashToken(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class OAuthError extends Error {
  constructor(readonly code: 'invalid_grant' | 'invalid_request' | 'invalid_client' | 'unsupported_grant_type', message: string) {
    super(message);
  }
}

/** Swap a code for an API key. A code works once, for the client and redirect it was made for. */
export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }) {
  // Deleted first, so two racing requests cannot both use it.
  const row = await prisma.oAuthCode.delete({ where: { codeHash: hashToken(input.code) }, include: { client: true } }).catch(() => null);
  if (!row || row.expiresAt.getTime() < Date.now()) throw new OAuthError('invalid_grant', 'The code is unknown, used or expired.');
  if (row.clientId !== input.clientId || row.redirectUri !== input.redirectUri) throw new OAuthError('invalid_grant', 'The code was made for another client.');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier) || s256(input.verifier) !== row.codeChallenge) {
    throw new OAuthError('invalid_grant', 'The code verifier does not match.');
  }
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: row.userId, workspaceId: row.workspaceId } } });
  if (!membership) throw new OAuthError('invalid_grant', 'That person is no longer in the workspace.');
  const made = await createApiToken({ workspaceId: row.workspaceId, userId: row.userId, name: `${row.client.name} (connector)`.slice(0, 60), scope: row.scope as ApiScope });
  return { access_token: made.token, token_type: 'Bearer', scope: row.scope };
}
