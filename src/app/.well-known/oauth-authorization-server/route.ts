import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

/** OAuth server metadata (RFC 8414), read by MCP clients before they connect. */
export function GET() {
  const base = env.appUrl;
  return NextResponse.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
  });
}
