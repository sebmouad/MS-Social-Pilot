import { discoveryIssuer, notFound, oauthJson, protectedResourceMetadata } from '@/modules/integrations/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Protected resource metadata (RFC 9728) for the MCP endpoint; only /api/mcp is described. */
export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = (await params).path ?? [];
  const issuer = await discoveryIssuer();
  if (!issuer || (path.length && path.join('/') !== 'api/mcp')) return notFound();
  return oauthJson(protectedResourceMetadata(issuer));
}
