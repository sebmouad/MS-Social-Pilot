import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

/** Protected resource metadata (RFC 9728): the MCP server and who signs people in for it. */
export function GET() {
  return NextResponse.json({
    resource: `${env.appUrl}/api/mcp`,
    authorization_servers: [env.appUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
  });
}
