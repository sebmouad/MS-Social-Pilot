import type { NextRequest } from 'next/server';
import { GET as connectionCallback } from '../../connections/[platform]/callback/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Legacy Meta-registered callback path; same flow as /api/connections/facebook/callback. */
export function GET(request: NextRequest) {
  return connectionCallback(request, { params: Promise.resolve({ platform: 'facebook' }) });
}
