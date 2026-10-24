import { OAuthError } from './protocol';
import { oauthRuntime } from './server';

export const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

/** RFC 6749 error body. Internals never leave: unknown failures become a generic server_error. */
export function oauthFailure(error: unknown) {
  if (error instanceof OAuthError) {
    return oauthJson({ error: error.code, error_description: error.message }, error.code === 'invalid_client' ? 401 : error.status);
  }
  return oauthJson({ error: 'server_error', error_description: 'Something went wrong. Try again.' }, 500);
}

/** Discovery documents are public but only exist while connectors are enabled and the issuer is configured. */
export async function discoveryIssuer(): Promise<string | null> {
  try {
    const rt = await oauthRuntime();
    return rt.enabled && rt.issuer ? rt.issuer : null;
  } catch { return null; }
}

export const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(issuer: string) {
  return { resource: `${issuer}/api/mcp`, authorization_servers: [issuer], scopes_supported: ['read', 'write'], bearer_methods_supported: ['header'] };
}
