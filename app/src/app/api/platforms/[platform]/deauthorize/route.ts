import { handleDataCallback } from '@/server/platforms/data-callbacks-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Provider "app removed" callback, authenticated by the provider's signature. Set this URL in the provider's app dashboard. */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return handleDataCallback(request, (await params).platform, 'deauthorize');
}
