import { connectionStartHttp } from '@/modules/settings/server/connection-start-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Compatibility entry point; the shared service owns authorization and confirmation. */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return connectionStartHttp(request, (await params).platform);
}
