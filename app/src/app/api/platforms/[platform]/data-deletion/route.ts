import { handleDataCallback } from '@/server/platforms/data-callbacks-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Provider data-deletion request callback, authenticated by the provider's signature. Answers with a status URL and confirmation code. */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return handleDataCallback(request, (await params).platform, 'dataDeletion');
}
