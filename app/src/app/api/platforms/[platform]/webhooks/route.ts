import { handleWebhookDelivery, handleWebhookVerification } from '@/server/platforms/webhooks-http';

export const dynamic = 'force-dynamic';

/** Provider endpoint-verification handshake; the module checks its own token. */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return handleWebhookVerification(request, (await params).platform);
}

/** Provider-signed event delivery; the module verifies the signature and ingests idempotently. */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  return handleWebhookDelivery(request, (await params).platform);
}
