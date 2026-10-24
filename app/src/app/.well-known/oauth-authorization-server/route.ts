import { authorizationServerMetadata, discoveryIssuer, notFound, oauthJson } from '@/modules/integrations/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** OAuth server metadata (RFC 8414), read by MCP clients before they connect. */
export async function GET() {
  const issuer = await discoveryIssuer();
  return issuer ? oauthJson(authorizationServerMetadata(issuer)) : notFound();
}
