import { oauthFailure, oauthJson } from '@/modules/integrations/oauth/http';
import { OAuthError } from '@/modules/integrations/oauth/protocol';
import { registerClient } from '@/modules/integrations/oauth/server';
import { clientIp } from '@/server/client-ip';

export const runtime = 'nodejs';
const MAX_BYTES = 8192;

/** Dynamic client registration (RFC 7591): public clients only, PKCE required later. */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) throw new OAuthError('invalid_client_metadata', 'The registration is too large.');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new OAuthError('invalid_client_metadata', 'Send JSON with redirect_uris.'); }
    return oauthJson(await registerClient(body, clientIp(request)), 201);
  } catch (error) { return oauthFailure(error); }
}
