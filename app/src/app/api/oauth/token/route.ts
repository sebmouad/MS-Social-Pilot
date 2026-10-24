import { oauthFailure, oauthJson } from '@/modules/integrations/oauth/http';
import { OAuthError } from '@/modules/integrations/oauth/protocol';
import { exchangeCode } from '@/modules/integrations/oauth/server';
import { clientIp } from '@/server/client-ip';

export const runtime = 'nodejs';

/** The token endpoint: a code and its PKCE verifier in, a scoped, revocable key out. Public clients, no secrets, no refresh tokens. */
export async function POST(request: Request) {
  try {
    if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get('content-type') ?? '')) throw new OAuthError('invalid_request', 'Send application/x-www-form-urlencoded.');
    const text = await request.text();
    if (text.length > 8192) throw new OAuthError('invalid_request', 'The request is too large.');
    const form = new URLSearchParams(text);
    const field = (name: string) => (form.getAll(name).length === 1 ? form.get(name) ?? '' : '');
    if (field('grant_type') !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
    const input = { code: field('code'), clientId: field('client_id'), redirectUri: field('redirect_uri'), verifier: field('code_verifier') };
    if (!input.code || !input.clientId || !input.redirectUri || !input.verifier) throw new OAuthError('invalid_request', 'code, client_id, redirect_uri and code_verifier are required.');
    return oauthJson(await exchangeCode(input, clientIp(request)));
  } catch (error) { return oauthFailure(error); }
}
